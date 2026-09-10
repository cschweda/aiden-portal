import { defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { getConfig } from '../utils/config'
import { isAllowedOrigin } from '../utils/hosts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * With no login, every tab in the owner's browser is the owner, so the API only serves requests that come from
 * this site. Browsers label every request with Sec-Fetch-* headers and cannot forge them:
 *   - a cross-site or same-site *subresource* request to /api (an <img>, a fetch, an iframe) is refused, GET
 *     included, so a page elsewhere cannot make this server call Fellow. CORS would only hide the answer.
 *   - a cross-site *top-level navigation* is the user visibly going somewhere (a link, a bookmark) and is allowed;
 *     Nuxt's server-side render forwards those navigation headers into its own API calls, so this is also what
 *     lets the page render when the visitor arrives via a link.
 *   - a mutation must additionally carry `same-origin`, or an Origin naming an allowed host for non-browser
 *     clients, which send neither header by default. A cross-site form post has a foreign Origin and fails here.
 */
export default defineEventHandler((event) => {
  const site = getHeader(event, 'sec-fetch-site')
  const mode = getHeader(event, 'sec-fetch-mode')
  const dest = getHeader(event, 'sec-fetch-dest')
  const isApi = event.path.startsWith('/api/')
  const fromElsewhere = site === 'cross-site' || site === 'same-site'
  const topLevelNavigation = mode === 'navigate' && dest === 'document'
  if (isApi && fromElsewhere && !topLevelNavigation) {
    return refuse(event, site, mode, dest)
  }
  if (!MUTATING_METHODS.has(event.method)) return
  if (site === 'same-origin') return
  const origin = getHeader(event, 'origin')
  if (isAllowedOrigin(origin, getConfig().allowedHosts)) return
  return refuse(event, site, mode, dest, origin)
})

function refuse(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0], site?: string, mode?: string, dest?: string, origin?: string) {
  event.context.logger?.warn({ site: site ?? null, mode: mode ?? null, dest: dest ?? null, origin: origin ?? null, method: event.method, path: event.path }, 'Rejected a cross-site request')
  setResponseStatus(event, 403)
  return { error: 'cross_site_request' }
}
