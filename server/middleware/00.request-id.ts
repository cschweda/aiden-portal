import { defineEventHandler, setHeader, getHeader } from 'h3'
import { useLogger } from '../utils/logger'

/** Every request gets an id, a child logger carrying it, and the id echoed in a response header. API answers are never cached. */
export default defineEventHandler((event) => {
  const requestId = crypto.randomUUID()
  event.context.requestId = requestId
  const tailnetUser = getHeader(event, 'tailscale-user-login')?.trim().toLowerCase() || undefined
  event.context.tailnetUser = tailnetUser
  event.context.logger = useLogger().child(tailnetUser ? { requestId, tailnetUser } : { requestId })
  setHeader(event, 'x-request-id', requestId)
  if (event.path.startsWith('/api/')) {
    setHeader(event, 'cache-control', 'no-store')
    // One line per API request at debug, so "Detailed" on the Logs page shows who asked for what, from where.
    event.context.logger.debug({ method: event.method, path: event.path, host: getHeader(event, 'host') ?? null }, 'API request')
  }
})
