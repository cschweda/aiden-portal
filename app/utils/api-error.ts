export interface ApiIssue { path: string, message: string }

export interface ApiFailure {
  /** The server's error code (`validation_failed`, `fellow_auth_failed`, …), `http_<status>`, `network_error`, or `unknown_error`. */
  code: string
  message: string
  issues?: ApiIssue[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Turns whatever `$fetch` threw into something a toast can show. Never throws. */
export function describeApiError(error: unknown): ApiFailure {
  if (error instanceof TypeError) return { code: 'network_error', message: error.message }
  if (typeof error === 'string') return { code: 'unknown_error', message: error }
  if (isRecord(error)) {
    const data = error.data
    if (isRecord(data) && typeof data.error === 'string') {
      const issues = Array.isArray(data.issues) ? (data.issues as ApiIssue[]) : undefined
      const blockers = Array.isArray(data.blockers) ? (data.blockers as string[]) : undefined
      const message = typeof data.message === 'string'
        ? data.message
        : blockers?.length
          ? blockers.join('; ')
          : issues?.map(issue => `${issue.path || 'body'}: ${issue.message}`).join('; ') ?? data.error
      return issues ? { code: data.error, message, issues } : { code: data.error, message }
    }
    const message = typeof error.message === 'string' ? error.message : 'Request failed'
    if (typeof error.statusCode === 'number') return { code: `http_${error.statusCode}`, message }
    if ('request' in error && !error.response) return { code: 'network_error', message }
    if (error instanceof Error) return { code: 'unknown_error', message: error.message }
  }
  return { code: 'unknown_error', message: 'Something went wrong' }
}
