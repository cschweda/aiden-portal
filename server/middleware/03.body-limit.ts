import { defineEventHandler, getHeader, setResponseStatus } from 'h3'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** A brew profile is a few hundred bytes; nothing legitimate comes close. */
export const MAX_BODY_BYTES = 1_000_000

/** Refuses oversized mutation bodies before any route buffers them. nuxt-security's limiter skips PATCH; this covers every method. */
export default defineEventHandler((event) => {
  if (!MUTATING_METHODS.has(event.method)) return
  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (!Number.isFinite(declared) || declared <= MAX_BODY_BYTES) return
  event.context.logger?.warn({ declared, path: event.path }, 'Rejected an oversized request body')
  setResponseStatus(event, 413)
  return { error: 'payload_too_large' }
})
