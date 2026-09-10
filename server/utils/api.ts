import { type EventHandler, type H3Event, defineEventHandler, getQuery, isError, setResponseStatus } from 'h3'
import { z, ZodError } from 'zod'
import { FellowError } from '../lib/fellow'
import { useLogger } from './logger'

export interface ApiErrorBody {
  error: string
  message?: string
  issues?: Array<{ path: string, message: string }>
}

/** Wraps a route so every failure becomes one of three well-defined JSON responses. */
export function defineApiRoute<T>(handler: (event: H3Event) => T | Promise<T>): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    }
    catch (error) {
      return respondWithError(event, error)
    }
  })
}

export function respondWithError(event: H3Event, error: unknown): ApiErrorBody {
  const logger = event.context.logger ?? useLogger()
  if (error instanceof ZodError) {
    const issues = error.issues.map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message }))
    logger.warn({ paths: issues.map(issue => issue.path) }, 'Request failed validation')
    setResponseStatus(event, 400)
    return { error: 'validation_failed', issues }
  }
  if (error instanceof FellowError) {
    // The message is ours; the body is Fellow's and stays on the server.
    logger.error({ code: error.code, status: error.status }, error.message)
    setResponseStatus(event, 502)
    return { error: error.code, message: error.message }
  }
  if (isError(error) && error.statusCode >= 400 && error.statusCode < 500) {
    // h3's own client errors (malformed JSON, a __proto__ key): its message, never its data.
    logger.warn({ status: error.statusCode }, error.statusMessage ?? error.message)
    setResponseStatus(event, error.statusCode)
    return { error: error.statusCode === 400 ? 'bad_request' : 'http_error', message: error.statusMessage ?? error.message }
  }
  logger.error({ err: error }, 'Unhandled error in an API route')
  setResponseStatus(event, 500)
  return { error: 'internal_error' }
}

export function parseFresh(event: H3Event): boolean {
  const value = getQuery(event).fresh
  return value === '1' || value === 'true'
}

const JsonObject = z.record(z.string(), z.unknown(), { error: 'Request body must be a JSON object' })

/** Bodies must be JSON objects; the schemas do the rest. Anything else is a validation failure, not a crash. */
export function asObject(body: unknown): Record<string, unknown> {
  return JsonObject.parse(body)
}
