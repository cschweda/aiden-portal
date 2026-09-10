import { defineEventHandler } from 'h3'

/** Unauthenticated liveness probe. No Fellow call, no secrets. */
export default defineEventHandler(() => ({ ok: true }))
