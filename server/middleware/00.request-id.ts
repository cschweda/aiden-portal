import { defineEventHandler, setHeader } from 'h3'
import { useLogger } from '../utils/logger'

/** Every request gets an id, a child logger carrying it, and the id echoed in a response header. API answers are never cached. */
export default defineEventHandler((event) => {
  const requestId = crypto.randomUUID()
  event.context.requestId = requestId
  event.context.logger = useLogger().child({ requestId })
  setHeader(event, 'x-request-id', requestId)
  if (event.path.startsWith('/api/')) setHeader(event, 'cache-control', 'no-store')
})
