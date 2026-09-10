import { defineEventHandler, getRequestHost, setResponseStatus } from 'h3'
import { getConfig } from '../utils/config'
import { hostnameOf } from '../utils/hosts'

/** Closes DNS rebinding: a request whose Host header is not ours is answered with 400 before any route runs. */
export default defineEventHandler((event) => {
  const host = hostnameOf(getRequestHost(event))
  if (getConfig().allowedHosts.includes(host)) return
  event.context.logger?.warn({ host }, 'Rejected a request for a host that is not allowed')
  setResponseStatus(event, 400)
  return { error: 'host_not_allowed' }
})
