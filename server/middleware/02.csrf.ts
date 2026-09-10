import { defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { getConfig } from '../utils/config'
import { isAllowedOrigin } from '../utils/hosts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * With no login, every tab in the owner's browser is the owner, so the API only serves requests that come from
 * this site. Browsers label every request with Sec-Fetch-Site and cannot forge it:
 *   - any /api request labelled cross-site or same-site is refused, GET included, whatever its mode, so a page
 *     elsewhere cannot make this server call Fellow (CORS would only hide the answer, not stop the call);
 *   - speculative loads (prefetch, prerender) of /api are refused for the same reason;
 *   - a mutation must additionally carry `same-origin`, or an Origin naming an allowed host for non-browser
 *     clients, which send neither header by default.
 * The app's own API reads are client-only, so the server never forwards a page navigation's headers into
 * requests to itself; `Sec-Fetch-Site: none` (a URL typed by the owner) stays allowed.
 */
export default defineEventHandler((event) => {
  const site = getHeader(event, 'sec-fetch-site')
  const isApi = event.path.startsWith('/api/')
  if (isApi && (site === 'cross-site' || site === 'same-site')) return refuse(event, site)
  if (isApi && isSpeculative(event)) return refuse(event, site)
  if (!MUTATING_METHODS.has(event.method)) return
  if (site === 'same-origin') return
  const origin = getHeader(event, 'origin')
  if (isAllowedOrigin(origin, getConfig().allowedHosts)) return
  return refuse(event, site, origin)
})

type Event = Parameters<Parameters<typeof defineEventHandler>[0]>[0]

function isSpeculative(event: Event): boolean {
  const purpose = (getHeader(event, 'sec-purpose') ?? getHeader(event, 'purpose') ?? '').toLowerCase()
  return purpose.includes('prefetch') || purpose.includes('prerender')
}

function refuse(event: Event, site?: string, origin?: string) {
  event.context.logger?.warn({ site: site ?? null, origin: origin ?? null, method: event.method, path: event.path }, 'Rejected a cross-site request')
  setResponseStatus(event, 403)
  return { error: 'cross_site_request' }
}
