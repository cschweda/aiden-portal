import { defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { getConfig } from '../utils/config'
import { isAllowedOrigin } from '../utils/hosts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * With no login, every tab in the owner's browser is the owner, so a mutation must prove it came from
 * this site: Sec-Fetch-Site: same-origin, or an Origin naming an allowed host. Non-browser clients send
 * an Origin header explicitly.
 */
export default defineEventHandler((event) => {
  if (!MUTATING_METHODS.has(event.method)) return
  if (getHeader(event, 'sec-fetch-site') === 'same-origin') return
  const origin = getHeader(event, 'origin')
  if (isAllowedOrigin(origin, getConfig().allowedHosts)) return
  event.context.logger?.warn({ origin: origin ?? null, method: event.method, path: event.path }, 'Rejected a cross-site mutation')
  setResponseStatus(event, 403)
  return { error: 'cross_site_request' }
})
