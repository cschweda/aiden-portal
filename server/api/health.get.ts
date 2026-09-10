/** Unauthenticated liveness probe. No Fellow call, no secrets. */
export default defineEventHandler(() => ({ ok: true }))
