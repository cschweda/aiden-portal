import { defineEventHandler, setResponseStatus } from 'h3'

/** Anything under /api that no route claimed, including wrong methods, is a JSON 404, never the app shell. */
export default defineEventHandler((event) => {
  setResponseStatus(event, 404)
  return { error: 'not_found' }
})
