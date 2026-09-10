export type FellowErrorCode =
  | 'fellow_auth_failed'
  | 'fellow_http_error'
  | 'fellow_network_error'
  | 'fellow_invalid_link'
  | 'fellow_bad_response'

export interface FellowErrorOptions {
  status?: number
  body?: unknown
  cause?: unknown
}

/** Every failure the Fellow client raises. `code` is stable and safe to show to the UI; `body` is not. */
export class FellowError extends Error {
  readonly code: FellowErrorCode
  readonly status: number | undefined
  readonly body: unknown

  constructor(code: FellowErrorCode, message: string, options: FellowErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'FellowError'
    this.code = code
    this.status = options.status
    this.body = options.body
  }
}
