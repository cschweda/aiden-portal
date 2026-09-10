import { FellowError } from './errors'
import { type FellowLogger, noopLogger } from './logger'

export const FELLOW_BASE_URL = 'https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v2'
export const FELLOW_USER_AGENT = 'Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface FellowHttpOptions {
  email: string
  password: string
  /** IANA zone sent with the login, as the mobile app does. Defaults to this machine's zone. */
  timezone?: string
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

const BAD_CREDENTIAL_STATUSES: ReadonlySet<number> = new Set([400, 401, 403])

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

interface TokenResponse { accessToken?: unknown, refreshToken?: unknown }

/**
 * Talks HTTP to Fellow: lazy login, bearer token, refresh-then-relogin on 401, JSON in and out.
 * The 401 sequence mirrors the maintained Home Assistant client: refresh the token and retry; if the
 * refresh fails or the refreshed token is rejected, log in with the password and retry; a further 401
 * means the credentials are bad.
 */
export class FellowHttp {
  private readonly email: string
  private readonly password: string
  private readonly timezone: string
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
  private refreshToken: string | null = null
  /** How the current access token was obtained; decides whether a rejected token deserves a password login. */
  private tokenSource: 'login' | 'refresh' | null = null
  private authInFlight: Promise<string> | null = null

  constructor(options: FellowHttpOptions) {
    this.email = options.email
    this.password = options.password
    this.timezone = options.timezone ?? defaultTimezone()
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

  /** Exchanges the stored refresh token for a new access token. Rejects with fellow_auth_failed if that is not possible. */
  refreshAccessToken(): Promise<string> {
    return this.singleFlight(async () => {
      const token = await this.tryRefresh()
      if (!token) throw new FellowError('fellow_auth_failed', 'Fellow did not issue a new access token for the refresh token')
      return token
    })
  }

  protected async sendAuthenticated(method: HttpMethod, path: string, body: unknown): Promise<Response> {
    const token = await this.ensureToken()
    let response = await this.send(method, path, body, token)
    if (response.status !== 401) return response

    this.logger.warn({ method, path }, 'Fellow returned 401; re-authenticating')
    const secondToken = await this.reauthenticate(token)
    response = await this.send(method, path, body, secondToken)
    if (response.status !== 401) return response

    if (this.tokenSource === 'refresh') {
      this.logger.warn({ method, path }, 'Refreshed token was rejected; logging in with the password')
      const thirdToken = await this.loginAgain(secondToken)
      response = await this.send(method, path, body, thirdToken)
      if (response.status !== 401) return response
    }
    throw new FellowError('fellow_auth_failed', 'Fellow rejected the request even after re-authenticating', { status: 401 })
  }

  private ensureToken(): Promise<string> {
    return this.accessToken ? Promise.resolve(this.accessToken) : this.singleFlight(() => this.performLogin())
  }

  /** Refresh if possible, else log in. If another request already replaced the stale token, reuse it. */
  private reauthenticate(staleToken: string): Promise<string> {
    if (this.accessToken && this.accessToken !== staleToken) return Promise.resolve(this.accessToken)
    return this.singleFlight(async () => (await this.tryRefresh()) ?? this.performLogin())
  }

  /** Password login, skipping refresh. Reuses a token another request obtained by login in the meantime. */
  private loginAgain(staleToken: string): Promise<string> {
    if (this.accessToken && this.accessToken !== staleToken && this.tokenSource === 'login') {
      return Promise.resolve(this.accessToken)
    }
    return this.singleFlight(() => this.performLogin())
  }

  private singleFlight(run: () => Promise<string>): Promise<string> {
    if (!this.authInFlight) {
      this.authInFlight = run().finally(() => {
        this.authInFlight = null
      })
    }
    return this.authInFlight
  }

  private async performLogin(): Promise<string> {
    this.logger.debug({}, 'Authenticating with Fellow')
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'User-Agent': this.userAgent, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password, timezone: this.timezone }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    }
    catch (error) {
      throw new FellowError('fellow_network_error', 'Could not reach Fellow to log in', { cause: error })
    }
    const data = (await parseBody(response)) as TokenResponse | undefined
    if (BAD_CREDENTIAL_STATUSES.has(response.status)) {
      throw new FellowError('fellow_auth_failed', 'Fellow rejected the email or password', { status: response.status, body: data })
    }
    if (!response.ok) {
      throw new FellowError('fellow_http_error', `Fellow responded ${response.status} to the login`, { status: response.status, body: data })
    }
    if (typeof data?.accessToken !== 'string') {
      throw new FellowError('fellow_auth_failed', 'Fellow login response had no access token', { status: response.status, body: data })
    }
    this.accessToken = data.accessToken
    this.refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : null
    this.tokenSource = 'login'
    this.logger.info({}, 'Authenticated with Fellow')
    return this.accessToken
  }

  /** Returns the new access token, or null when there is no refresh token or Fellow declines it. Never throws. */
  private async tryRefresh(): Promise<string | null> {
    if (!this.refreshToken) return null
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/auth/refresh-token`, {
        method: 'POST',
        headers: { 'User-Agent': this.userAgent, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    }
    catch (error) {
      this.logger.debug({ reason: error instanceof Error ? error.message : String(error) }, 'Token refresh request failed')
      return null
    }
    const data = (await parseBody(response)) as TokenResponse | undefined
    if (!response.ok || typeof data?.accessToken !== 'string') {
      this.logger.debug({ status: response.status }, 'Token refresh was declined')
      return null
    }
    this.accessToken = data.accessToken
    if (typeof data.refreshToken === 'string') this.refreshToken = data.refreshToken
    this.tokenSource = 'refresh'
    this.logger.info({}, 'Refreshed the Fellow access token')
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
