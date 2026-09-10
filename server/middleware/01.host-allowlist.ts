import { defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { getConfig } from '../utils/config'
import { hostnameOf } from '../utils/hosts'

/**
 * Closes DNS rebinding: a request whose Host header is not ours is answered with 400 before any route runs.
 * The header is read directly (h3's helper substitutes "localhost" when it is missing) so a missing Host fails closed.
 */
export default defineEventHandler((event) => {
  const host = hostnameOf(getHeader(event, 'host'))
  if (host && getConfig().allowedHosts.includes(host)) return
  event.context.logger?.warn({ host }, 'Rejected a request for a host that is not allowed')
  setResponseStatus(event, 400)
  return { error: 'host_not_allowed' }
})
