import { FellowError } from './errors'
import { type FellowLogger, noopLogger } from './logger'

export const FELLOW_BASE_URL = 'https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1'
export const FELLOW_USER_AGENT = 'Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface FellowHttpOptions {
  email: string
  password: string
  baseUrl?: string
  userAgent?: string
  logger?: FellowLogger
  fetch?: typeof globalThis.fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Attempts for GET and DELETE on 408/5xx/network errors. POST and PATCH always get exactly one. */
  maxAttempts?: number
  backoffBaseMs?: number
  timeoutMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const RETRYABLE_METHODS: ReadonlySet<HttpMethod> = new Set(['GET', 'DELETE'])

/** Talks HTTP to Fellow: lazy login, bearer token, one re-login on 401, JSON in and out. */
export class FellowHttp {
  private readonly email: string
  private readonly password: string
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly logger: FellowLogger
  private readonly fetchImpl: typeof globalThis.fetch
  protected readonly sleep: (ms: number) => Promise<void>
  protected readonly random: () => number
  protected readonly maxAttempts: number
  protected readonly backoffBaseMs: number
  private readonly timeoutMs: number

  private accessToken: string | null = null
  /** Fellow returns this at login. It is never sent because no refresh endpoint is known. */
  private refreshToken: string | null = null
  private loginInFlight: Promise<string> | null = null

  constructor(options: FellowHttpOptions) {
    this.email = options.email
    this.password = options.password
    this.baseUrl = options.baseUrl ?? FELLOW_BASE_URL
    this.userAgent = options.userAgent ?? FELLOW_USER_AGENT
    this.logger = options.logger ?? noopLogger
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.sleep = options.sleep ?? defaultSleep
    this.random = options.random ?? Math.random
    this.maxAttempts = options.maxAttempts ?? 3
    this.backoffBaseMs = options.backoffBaseMs ?? 250
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null
  }

  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    // Only idempotent methods are retried. A retried POST could create a duplicate profile after a 503 that
    // Fellow had in fact processed. This matches the reference client's urllib3 policy.
    const maxAttempts = RETRYABLE_METHODS.has(method) ? this.maxAttempts : 1
    for (let attempt = 1; ; attempt++) {
      let response: Response
      try {
        response = await this.sendAuthenticated(method, path, body)
      }
      catch (error) {
        if (error instanceof FellowError) throw error
        if (attempt >= maxAttempts) {
          throw new FellowError('fellow_network_error', `Fellow request failed: ${method} ${path}`, { cause: error })
        }
        await this.backoff(attempt, method, path, `network error: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (response.ok) return (await parseBody(response)) as T

      const retryable = response.status === 408 || response.status >= 500
      if (retryable && attempt < maxAttempts) {
        await this.backoff(attempt, method, path, `status ${response.status}`)
        continue
      }
      throw new FellowError('fellow_http_error', `Fellow responded ${response.status} to ${method} ${path}`, {
        status: response.status,
        body: await parseBody(response),
      })
    }
  }

  private async backoff(attempt: number, method: HttpMethod, path: string, reason: string): Promise<void> {
    const delayMs = this.backoffBaseMs * 2 ** (attempt - 1) + Math.floor(this.random() * 100)
    this.logger.warn({ method, path, attempt, delayMs, reason }, 'Retrying Fellow request')
    await this.sleep(delayMs)
  }

  // UNVERIFIED: the login response carries a refreshToken, but the reference client never uses it and no
  // refresh endpoint appears anywhere in its code. Implement this once the endpoint is known.
  async refreshAccessToken(): Promise<never> {
    throw new FellowError('fellow_not_implemented', 'Fellow token refresh is not implemented: the refresh endpoint is unknown')
  }

  protected async sendAuthenticated(method: HttpMethod, path: string, body: unknown): Promise<Response> {
    const token = await this.ensureToken()
    let response = await this.send(method, path, body, token)
    if (response.status !== 401) return response

    this.logger.warn({ method, path }, 'Fellow returned 401; re-authenticating')
    const freshToken = await this.reauthenticate(token)
    response = await this.send(method, path, body, freshToken)
    if (response.status === 401) {
      throw new FellowError('fellow_auth_failed', 'Fellow rejected the request even after re-authenticating', { status: 401 })
    }
    return response
  }

  private ensureToken(): Promise<string> {
    return this.accessToken ? Promise.resolve(this.accessToken) : this.login()
  }

  /** If another request already replaced the stale token, reuse it instead of logging in again. */
  private reauthenticate(staleToken: string): Promise<string> {
    if (this.accessToken && this.accessToken !== staleToken) return Promise.resolve(this.accessToken)
    return this.login()
  }

  private login(): Promise<string> {
    if (!this.loginInFlight) {
      this.loginInFlight = this.performLogin().finally(() => {
        this.loginInFlight = null
      })
    }
    return this.loginInFlight
  }

  private async performLogin(): Promise<string> {
    this.logger.debug({}, 'Authenticating with Fellow')
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'User-Agent': this.userAgent, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    }
    catch (error) {
      throw new FellowError('fellow_network_error', 'Could not reach Fellow to log in', { cause: error })
    }
    const data = (await parseBody(response)) as { accessToken?: unknown, refreshToken?: unknown } | undefined
    if (!response.ok || typeof data?.accessToken !== 'string') {
      throw new FellowError('fellow_auth_failed', 'Fellow rejected the email or password', { status: response.status, body: data })
    }
    this.accessToken = data.accessToken
    this.refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : null
    this.logger.info({}, 'Authenticated with Fellow')
    return this.accessToken
  }

  private async send(method: HttpMethod, path: string, body: unknown, token: string): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const started = performance.now()
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    this.logger.debug({ method, path, status: response.status, durationMs: Math.round(performance.now() - started) }, 'Fellow API call')
    return response
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}
