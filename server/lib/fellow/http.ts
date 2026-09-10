import { FellowError, type FellowErrorCode } from './errors'
import { type FellowLogger, noopLogger } from './logger'

export const FELLOW_BASE_URL = 'https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v2'
export const FELLOW_USER_AGENT = 'Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export type FellowOutcome = 'ok' | FellowErrorCode | 'unknown'

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

type TokenSource = 'login' | 'refresh'

interface AuthResult { token: string, source: TokenSource }

/** One authentication operation at a time. `refresh` may be satisfied by a refresh; `login` must be a password login. */
interface AuthInFlight { kind: 'refresh' | 'login', promise: Promise<AuthResult> }

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

  /** Result of the most recent request: 'ok', the FellowError code, or 'unknown' before any request. */
  lastOutcome: FellowOutcome = 'unknown'

  private accessToken: string | null = null
  private refreshToken: string | null = null
  /** How the current access token was obtained. */
  private tokenSource: TokenSource | null = null
  private authInFlight: AuthInFlight | null = null

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
    try {
      const result = await this.requestOnce<T>(method, path, body)
      this.lastOutcome = 'ok'
      return result
    }
    catch (error) {
      if (error instanceof FellowError) this.lastOutcome = error.code
      throw error
    }
  }

  private async requestOnce<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
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
        await this.backoff(attempt, method, path, `network error: ${describeError(error)}`)
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
  async refreshAccessToken(): Promise<string> {
    const result = await this.singleFlight('refresh', async () => {
      const refreshed = await this.tryRefresh()
      if (!refreshed) throw new FellowError('fellow_auth_failed', 'Fellow did not issue a new access token for the refresh token')
      return refreshed
    })
    return result.token
  }

  protected async sendAuthenticated(method: HttpMethod, path: string, body: unknown): Promise<Response> {
    const token = await this.ensureToken()
    let response = await this.send(method, path, body, token)
    if (response.status !== 401) return response

    this.logger.warn({ method, path }, 'Fellow returned 401; re-authenticating')
    const second = await this.reauthenticate(token)
    response = await this.send(method, path, body, second.token)
    if (response.status !== 401) return response

    let lastToken = second.token
    if (second.source === 'refresh') {
      this.logger.warn({ method, path }, 'Refreshed token was rejected; logging in with the password')
      const third = await this.loginAgain(second.token)
      response = await this.send(method, path, body, third.token)
      if (response.status !== 401) return response
      lastToken = third.token
    }

    // Another request may have obtained a newer token while ours was being rejected. Use it before giving up.
    if (this.accessToken && this.accessToken !== lastToken) {
      response = await this.send(method, path, body, this.accessToken)
      if (response.status !== 401) return response
    }
    throw new FellowError('fellow_auth_failed', 'Fellow rejected the request even after re-authenticating', { status: 401 })
  }

  private async ensureToken(): Promise<string> {
    if (this.accessToken) return this.accessToken
    return (await this.singleFlight('login', () => this.performLogin())).token
  }

  /** Refresh if possible, else log in. If another request already replaced the stale token, reuse it. */
  private reauthenticate(staleToken: string): Promise<AuthResult> {
    if (this.accessToken && this.accessToken !== staleToken && this.tokenSource) {
      return Promise.resolve({ token: this.accessToken, source: this.tokenSource })
    }
    return this.singleFlight('refresh', async () => (await this.tryRefresh()) ?? this.performLogin())
  }

  /** Password login, skipping refresh. Reuses a token another request obtained by login in the meantime. */
  private loginAgain(staleToken: string): Promise<AuthResult> {
    if (this.accessToken && this.accessToken !== staleToken && this.tokenSource === 'login') {
      return Promise.resolve({ token: this.accessToken, source: 'login' })
    }
    return this.singleFlight('login', () => this.performLogin())
  }

  private singleFlight(kind: AuthInFlight['kind'], run: () => Promise<AuthResult>): Promise<AuthResult> {
    const current = this.authInFlight
    if (current) {
      if (kind === 'login' && current.kind !== 'login') {
        // A refresh is in progress but the caller needs a password login. Let the refresh finish, then
        // run the login unless the refresh turned out to be a login itself.
        return current.promise.then(
          result => (result.source === 'login' ? result : this.singleFlight('login', run)),
          () => this.singleFlight('login', run),
        )
      }
      return current.promise
    }
    const promise: Promise<AuthResult> = run().finally(() => {
      if (this.authInFlight?.promise === promise) this.authInFlight = null
    })
    this.authInFlight = { kind, promise }
    return promise
  }

  /** Password login. Retried on 408/5xx and network errors like any idempotent call; 400/401/403 mean bad credentials. */
  private async performLogin(): Promise<AuthResult> {
    for (let attempt = 1; ; attempt++) {
      this.logger.debug({ attempt }, 'Authenticating with Fellow')
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
        if (attempt >= this.maxAttempts) {
          throw new FellowError('fellow_network_error', 'Could not reach Fellow to log in', { cause: error })
        }
        await this.backoff(attempt, 'POST', '/auth/login', `network error: ${describeError(error)}`)
        continue
      }
      const data = (await parseBody(response)) as TokenResponse | undefined
      if (BAD_CREDENTIAL_STATUSES.has(response.status)) {
        throw new FellowError('fellow_auth_failed', 'Fellow rejected the email or password', { status: response.status, body: data })
      }
      if (!response.ok) {
        const retryable = response.status === 408 || response.status >= 500
        if (retryable && attempt < this.maxAttempts) {
          await this.backoff(attempt, 'POST', '/auth/login', `status ${response.status}`)
          continue
        }
        throw new FellowError('fellow_http_error', `Fellow responded ${response.status} to the login`, { status: response.status, body: data })
      }
      if (typeof data?.accessToken !== 'string') {
        throw new FellowError('fellow_auth_failed', 'Fellow login response had no access token', { status: response.status, body: data })
      }
      this.accessToken = data.accessToken
      this.refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : null
      this.tokenSource = 'login'
      this.logger.info({}, 'Authenticated with Fellow')
      return { token: this.accessToken, source: 'login' }
    }
  }

  /** Returns the new access token, or null when there is no refresh token or Fellow declines it. Never throws. */
  private async tryRefresh(): Promise<AuthResult | null> {
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
      this.logger.debug({ reason: describeError(error) }, 'Token refresh request failed')
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
    return { token: this.accessToken, source: 'refresh' }
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
