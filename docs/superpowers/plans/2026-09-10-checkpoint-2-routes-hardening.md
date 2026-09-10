# Checkpoint 2: Server Routes, Hardening, Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Fellow client through validated Nuxt server routes with one shared error mapping, refuse to start off loopback, reject foreign-host and cross-site requests, and log to a rotating file with secrets redacted.

**Architecture:** Route files under `server/api/` import from `h3` explicitly (not Nitro auto-imports) so tests can mount the very same handlers on a plain h3 app in-process, with msw standing in for Fellow. Three ordered `server/middleware/` files add a request id, the Host allowlist, and the CSRF check. A Nitro plugin holds the startup guard. `server/utils/api.ts` owns the error mapping. `server/utils/logger.ts` builds pino with redaction and, in production, a pino-roll transport.

**Tech Stack:** h3 1.15 (direct dependency now), pino 10 + pino-roll 4 + pino-pretty, nuxt-security 2.6, Zod 4, Vitest 5, msw 2.

**Spec:** `docs/aiden-studio-build-prompt.md` §3b, §5, §6, §8 (routes, guard, logging lines), §9 checkpoint 2.

## Global Constraints

- Every route validates input with the input schemas; mutations are POST/PATCH/DELETE only.
- Error mapping in one place: Zod → 400 with the issue list; `FellowError` → 502 with `{ error: <code> }` and never Fellow's response body; anything else → 500 generic with a logged stack.
- Startup guard: refuse to start when `HOST` is unset or not loopback, or when credentials are missing. Guard sees the bind address only.
- Host allowlist on every request (400); CSRF via `Sec-Fetch-Site: same-origin` else `Origin` hostname in `ALLOWED_HOSTS` (403) on every mutating request.
- Logging: `requestId` on every line; secrets redacted (`password`, `accessToken`, `refreshToken`, `authorization`, `cookie`); production writes only to pino-roll (daily, keep 14, `mkdir`, `symlink` → `logs/current.log`); one plain startup line to stdout; no per-request access log at info.
- The browser never sees Fellow credentials or Fellow response bodies from errors.
- No auth, no database, no rate limiter in Phase 1.
- Commit messages carry no AI co-author trailer.

## File Structure

| Path | Responsibility |
|---|---|
| `server/utils/version.ts` | `APP_VERSION` from package.json |
| `server/utils/hosts.ts` | `hostnameOf(hostHeader)`, `isAllowedOrigin(origin, allowlist)` |
| `server/utils/startup.ts` | `checkStartupSafety(config): string[]` |
| `server/utils/logger.ts` | `buildLoggerOptions`, `createLogger`, `useLogger`, `resetLoggerForTests` |
| `server/utils/api.ts` | `defineApiRoute`, `respondWithError`, `parseFresh` |
| `server/utils/fellow-client.ts` | + `resetFellowClientForTests` |
| `server/lib/fellow/http.ts`, `client.ts` | + `lastOutcome` |
| `server/lib/fellow/device.ts` | + `brewStartBlockers` |
| `server/types/h3.d.ts` | `H3EventContext` gains `requestId`, `logger` |
| `server/middleware/00.request-id.ts`, `01.host-allowlist.ts`, `02.csrf.ts` | Ordered request pipeline |
| `server/plugins/startup.ts` | Guard, startup line, Fellow probe |
| `server/api/**` | Routes (see Task 6) |
| `nuxt.config.ts` | nuxt-security |
| `tests/helpers/app.ts` | In-process h3 app mirroring the Nitro routes; env + singleton reset |
| `tests/unit/*.test.ts`, `tests/routes/*.test.ts` | Tests |

---

### Task 1: Foundations — version, host helpers, startup check, `silent` level

**Files:**
- Create: `server/utils/version.ts`, `server/utils/hosts.ts`, `server/utils/startup.ts`
- Modify: `server/utils/config.ts` (add `silent` to `LOG_LEVELS`), `tests/tsconfig.json` (include all of `server/` except plugins; `resolveJsonModule`)
- Test: `tests/unit/hosts.test.ts`, `tests/unit/startup.test.ts`, `tests/unit/config.test.ts` (one case)

**Interfaces:**
- Produces: `APP_VERSION: string`; `hostnameOf(host: string | undefined): string` (lower-cased, port stripped, `[::1]:3000` → `[::1]`); `isAllowedOrigin(origin: string | undefined, allowedHosts: readonly string[]): boolean`; `checkStartupSafety(config: AppConfig): string[]` (empty means safe).

- [ ] **Step 1: Failing tests**

`tests/unit/hosts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { hostnameOf, isAllowedOrigin } from '../../server/utils/hosts'

describe('hostnameOf', () => {
  it.each([
    ['localhost:3000', 'localhost'],
    ['LOCALHOST', 'localhost'],
    ['127.0.0.1:3000', '127.0.0.1'],
    ['[::1]:3000', '[::1]'],
    ['[::1]', '[::1]'],
    ['aiden.example.com', 'aiden.example.com'],
    ['', ''],
    [undefined, ''],
  ])('%j → %j', (host, expected) => {
    expect(hostnameOf(host)).toBe(expected)
  })
})

describe('isAllowedOrigin', () => {
  const allowed = ['localhost', '127.0.0.1', '[::1]']
  it.each([
    ['http://localhost:3000', true],
    ['http://LOCALHOST', true],
    ['http://127.0.0.1:3000', true],
    ['http://[::1]:3000', true],
    ['https://localhost', true],
    ['http://evil.example', false],
    ['http://localhost.evil.example', false],
    ['null', false],
    ['not a url', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (origin, expected) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(expected)
  })
})
```

`tests/unit/startup.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseEnv } from '../../server/utils/config'
import { checkStartupSafety } from '../../server/utils/startup'

const base = { FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2' }

describe('checkStartupSafety', () => {
  it('is quiet for a loopback bind', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(checkStartupSafety(parseEnv({ ...base, HOST: host }))).toEqual([])
    }
  })
  it('refuses when HOST is unset, naming the fix', () => {
    const problems = checkStartupSafety(parseEnv(base))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/HOST/)
    expect(problems[0]).toMatch(/127\.0\.0\.1/)
  })
  it.each(['0.0.0.0', '::', '192.168.1.20'])('refuses a non-loopback bind %s', (host) => {
    const problems = checkStartupSafety(parseEnv({ ...base, HOST: host }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(new RegExp(host.replace(/\./g, '\\.')))
  })
})
```

Append to `tests/unit/config.test.ts` inside `describe('parseEnv')`:
```ts
  it('accepts silent as a log level for tests', () => {
    expect(parseEnv({ ...MINIMAL, LOG_LEVEL: 'silent' }).logLevel).toBe('silent')
  })
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run tests/unit/hosts.test.ts tests/unit/startup.test.ts tests/unit/config.test.ts` → modules not found / `silent` rejected.

- [ ] **Step 3: Implement**

`server/utils/version.ts`:
```ts
import pkg from '../../package.json' with { type: 'json' }

export const APP_VERSION: string = pkg.version
```

`server/utils/hosts.ts`:
```ts
/** Lower-cased hostname from a Host header value: the port is dropped, IPv6 brackets are kept. */
export function hostnameOf(host: string | undefined): string {
  if (!host) return ''
  const trimmed = host.trim().toLowerCase()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed : trimmed.slice(0, end + 1)
  }
  const colon = trimmed.indexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/** Whether an Origin header names one of the allowed hosts. Anything unparseable, including `null`, is not allowed. */
export function isAllowedOrigin(origin: string | undefined, allowedHosts: readonly string[]): boolean {
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  }
  catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return allowedHosts.includes(url.hostname.toLowerCase())
}
```

`server/utils/startup.ts`:
```ts
import { type AppConfig, isLoopbackHost } from './config'

/** Reasons the server must not start. Empty means go. The guard sees the bind address only, never proxies. */
export function checkStartupSafety(config: AppConfig): string[] {
  const problems: string[] = []
  if (config.host === undefined) {
    problems.push('HOST is not set, so Nitro would listen on every interface. Set HOST=127.0.0.1 in .env.')
  }
  else if (!isLoopbackHost(config.host)) {
    problems.push(`HOST=${config.host} is not a loopback address. Phase 1 has no login, so the app may only listen on 127.0.0.1, ::1, or localhost.`)
  }
  return problems
}
```

In `server/utils/config.ts` change `LOG_LEVELS` to `['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const`.

`tests/tsconfig.json`: add `"resolveJsonModule": true` to `compilerOptions` and set `"include": ["./**/*.ts", "../server/lib/**/*.ts", "../server/utils/**/*.ts", "../server/api/**/*.ts", "../server/middleware/**/*.ts", "../server/types/**/*.d.ts"]`.

- [ ] **Step 4: Run to verify pass**, then `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): version constant, host helpers, and startup safety check"`

---

### Task 2: Logger with redaction and rotation

**Files:**
- Modify: `server/utils/logger.ts`
- Test: `tests/unit/logger.test.ts`

**Interfaces:**
- Produces: `buildLoggerOptions(config: AppConfig): pino.LoggerOptions`; `createLogger(config: AppConfig, destination?: pino.DestinationStream): pino.Logger` (production without `destination` → pino-roll transport; dev → pino-pretty); `useLogger(): pino.Logger` (singleton from `getConfig()`); `resetLoggerForTests(): void`.

- [ ] **Step 1: Failing tests**

`tests/unit/logger.test.ts`:
```ts
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { parseEnv } from '../../server/utils/config'
import { buildLoggerOptions, createLogger } from '../../server/utils/logger'

function capture() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString())
      callback()
    },
  })
  return { stream, records: () => lines.filter(l => l.trim()).map(l => JSON.parse(l) as Record<string, unknown>) }
}

const config = parseEnv({ FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2', LOG_LEVEL: 'debug', HOST: '127.0.0.1' })

describe('logger', () => {
  it('redacts secrets at the top level and up to two levels down', () => {
    const { stream, records } = capture()
    const logger = createLogger(config, stream)
    logger.info({
      password: 'hunter2',
      accessToken: 'tok',
      body: { refreshToken: 'ref', nested: { authorization: 'Bearer x', cookie: 'c=1' } },
      keep: 'visible',
    }, 'hello')
    const [record] = records()
    expect(record).toMatchObject({
      msg: 'hello',
      password: '[redacted]',
      accessToken: '[redacted]',
      body: { refreshToken: '[redacted]', nested: { authorization: '[redacted]', cookie: '[redacted]' } },
      keep: 'visible',
    })
    expect(JSON.stringify(record)).not.toMatch(/hunter2|tok|ref|Bearer x|c=1/)
  })

  it('honours the configured level', () => {
    const { stream, records } = capture()
    const logger = createLogger(parseEnv({ FELLOW_EMAIL: 'a@b.co', FELLOW_PASSWORD: 'x', LOG_LEVEL: 'warn' }), stream)
    logger.info({}, 'dropped')
    logger.warn({}, 'kept')
    expect(records().map(r => r.msg)).toEqual(['kept'])
  })

  it('carries a child requestId on every line', () => {
    const { stream, records } = capture()
    const child = createLogger(config, stream).child({ requestId: 'req-1' })
    child.debug({ a: 1 }, 'one')
    child.error({ b: 2 }, 'two')
    expect(records().map(r => r.requestId)).toEqual(['req-1', 'req-1'])
  })

  it('exposes options with the redaction paths for reuse', () => {
    const options = buildLoggerOptions(config)
    expect(options.level).toBe('debug')
    expect((options.redact as { paths: string[] }).paths).toEqual(expect.arrayContaining(['password', '*.password', '*.*.password']))
  })
})
```

- [ ] **Step 2: Run to verify failure** — `buildLoggerOptions`/`createLogger` do not exist.

- [ ] **Step 3: Implement** `server/utils/logger.ts`:
```ts
import pino from 'pino'
import pretty from 'pino-pretty'
// Imported for its side effect on the build only: Nitro's dependency tracing copies the package into
// .output because of this line, and the pino transport below then resolves it by name at runtime.
import 'pino-roll'
import { type AppConfig, getConfig } from './config'

const SECRET_KEYS = ['password', 'accessToken', 'refreshToken', 'authorization', 'cookie']
/** Top-level and up to two levels deep, which covers request bodies, headers, and config dumps. */
const REDACTED_PATHS = SECRET_KEYS.flatMap(key => [key, `*.${key}`, `*.*.${key}`])

export const LOG_DIRECTORY = 'logs'
/** pino-roll keeps this symlink pointing at the active file; the /logs page tails it. */
export const CURRENT_LOG_FILE = `${LOG_DIRECTORY}/current.log`

export function buildLoggerOptions(config: AppConfig): pino.LoggerOptions {
  return {
    level: config.logLevel,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  }
}

/** Production: rotating file only. Development: pretty stdout. Tests pass their own destination. */
export function createLogger(config: AppConfig, destination?: pino.DestinationStream): pino.Logger {
  const options = buildLoggerOptions(config)
  if (destination) return pino(options, destination)
  if (config.isProduction) {
    return pino(options, pino.transport({
      target: 'pino-roll',
      options: {
        file: `${LOG_DIRECTORY}/aiden`,
        extension: '.log',
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        limit: { count: 14, removeOtherLogFiles: true },
        symlink: true,
        mkdir: true,
      },
    }))
  }
  return pino(options, pretty({ colorize: true, translateTime: 'HH:MM:ss' }))
}

let instance: pino.Logger | undefined

export function useLogger(): pino.Logger {
  instance ??= createLogger(getConfig())
  return instance
}

export function resetLoggerForTests(): void {
  instance = undefined
}
```

- [ ] **Step 4: Run to verify pass**, lint, typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(logging): redaction, configurable level, pino-roll rotation in production"`

---

### Task 3: Client additions — last outcome, start blockers, test reset

**Files:**
- Modify: `server/lib/fellow/http.ts`, `server/lib/fellow/client.ts`, `server/lib/fellow/device.ts`, `server/lib/fellow/index.ts`, `server/utils/fellow-client.ts`
- Test: `tests/unit/fellow/client.test.ts`, `tests/unit/fellow/device.test.ts` (append)

**Interfaces:**
- Produces: `type FellowOutcome = 'ok' | FellowErrorCode | 'unknown'`; `FellowHttp.lastOutcome` and `FellowClient.lastOutcome` getters; `brewStartBlockers(device: Device): string[]` (human-readable, empty when ready; `canStartBrew` becomes `brewStartBlockers(device).length === 0`); `resetFellowClientForTests(): void`.

- [ ] **Step 1: Failing tests**

Append to `tests/unit/fellow/client.test.ts`:
```ts
describe('FellowClient last outcome', () => {
  it('starts unknown, becomes ok after a success, and records the error code after a failure', async () => {
    server.use(...happyHandlers(newCalls()), http.get(`${BASE}/shared/aiden/nope`, () => new HttpResponse(null, { status: 404 })))
    const client = makeClient()
    expect(client.lastOutcome).toBe('unknown')
    await client.getDevice()
    expect(client.lastOutcome).toBe('ok')
    await expect(client.fetchSharedProfile('nope')).rejects.toBeInstanceOf(FellowError)
    expect(client.lastOutcome).toBe('fellow_http_error')
  })

  it('reports auth failures', async () => {
    server.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({ message: 'no' }, { status: 401 })))
    const client = makeClient()
    await expect(client.getDevice()).rejects.toMatchObject({ code: 'fellow_auth_failed' })
    expect(client.lastOutcome).toBe('fellow_auth_failed')
  })
})
```
(add `FellowError` to the imports from `../../../server/lib/fellow/errors`.)

Append to `tests/unit/fellow/device.test.ts`:
```ts
describe('brewStartBlockers', () => {
  it('is empty for a ready brewer', () => {
    expect(brewStartBlockers(READY)).toEqual([])
  })
  it('names every problem, in a stable order', () => {
    expect(brewStartBlockers({
      ...READY,
      firmwareVersion: '1.0.0',
      isConnected: false,
      brewing: true,
      lidClosed: false,
      missingWater: true,
      cleaning: true,
      rinsing: true,
      singleBrewBasketPresent: false,
    })).toEqual([
      'firmware 1.0.0 is older than 1.5.16',
      'brewer is offline',
      'a brew is in progress',
      'lid is open',
      'water tank is empty',
      'cleaning cycle is running',
      'rinse cycle is running',
      'no basket detected (batch basket also needs the carafe)',
    ])
  })
  it('treats unknown state as a blocker', () => {
    expect(brewStartBlockers({ ...READY, brewing: undefined })).toEqual(['brew state is unknown'])
    expect(brewStartBlockers({ ...READY, missingWater: undefined })).toEqual(['water level is unknown'])
    expect(brewStartBlockers({ ...READY, firmwareVersion: undefined })).toEqual(['firmware version is unknown'])
  })
})
```
(import `brewStartBlockers` alongside the others.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

In `server/lib/fellow/http.ts`: add after the class fields
```ts
  /** Result of the most recent request: 'ok', the FellowError code, or 'unknown' before any request. */
  lastOutcome: FellowOutcome = 'unknown'
```
export the type near `HttpMethod`:
```ts
export type FellowOutcome = 'ok' | FellowErrorCode | 'unknown'
```
(import `type FellowErrorCode` from `./errors`.) In `request()`, wrap the loop: on a successful return set `this.lastOutcome = 'ok'`; in every `throw new FellowError(...)` path inside `request()` and in the `catch` that rethrows a `FellowError`, set `this.lastOutcome = error.code` first. The cleanest form is to rename the existing method to `private async requestOnce(...)` and add:
```ts
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
```
(where `requestOnce` is the previous `request` body, unchanged.)

In `server/lib/fellow/client.ts` add:
```ts
  get lastOutcome(): FellowOutcome {
    return this.http.lastOutcome
  }
```
(import `type FellowOutcome` from `./http`.)

In `server/lib/fellow/device.ts` replace `canStartBrew` with:
```ts
/** Human-readable reasons an Instant Brew must not be started now. Every unknown counts as a reason. */
export function brewStartBlockers(device: Device): string[] {
  const blockers: string[] = []
  if (typeof device.firmwareVersion !== 'string') blockers.push('firmware version is unknown')
  else if (!supportsRemoteStart(device)) blockers.push(`firmware ${device.firmwareVersion} is older than ${MIN_REMOTE_START_FIRMWARE.join('.')}`)
  if (device.isConnected !== true) blockers.push('brewer is offline')
  const brewing = isBrewing(device)
  if (brewing === undefined) blockers.push('brew state is unknown')
  else if (brewing) blockers.push('a brew is in progress')
  if (device.lidClosed !== true) blockers.push('lid is open')
  const missingWater = isMissingWater(device)
  if (missingWater === undefined) blockers.push('water level is unknown')
  else if (missingWater) blockers.push('water tank is empty')
  if (device.cleaning !== false) blockers.push('cleaning cycle is running')
  if (device.rinsing !== false) blockers.push('rinse cycle is running')
  const singleBasket = device.singleBrewBasketPresent === true
  const batchReady = device.batchBrewBasketPresent === true && device.carafePresent === true
  if (!singleBasket && !batchReady) blockers.push('no basket detected (batch basket also needs the carafe)')
  return blockers
}

/** Whether the reported state is safe for an Instant Brew start. */
export function canStartBrew(device: Device): boolean {
  return brewStartBlockers(device).length === 0
}
```
Note: `cleaning !== false` and `rinsing !== false` treat unknown as blocking, matching the previous `=== false` requirement. The existing `canStartBrew` truth-table tests must still pass unchanged.

Export `brewStartBlockers` and `type FellowOutcome` from `server/lib/fellow/index.ts`.

In `server/utils/fellow-client.ts` add:
```ts
export function resetFellowClientForTests(): void {
  instance = undefined
}
```

- [ ] **Step 4: Run** `pnpm vitest run tests/unit/fellow` → pass; lint; typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(fellow): expose last outcome and human-readable brew start blockers"`

---

### Task 4: API route helpers and event context types

**Files:**
- Create: `server/utils/api.ts`, `server/types/h3.d.ts`
- Test: `tests/unit/api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ApiErrorBody { error: string; message?: string; issues?: Array<{ path: string; message: string }> }
  function defineApiRoute<T>(handler: (event: H3Event) => T | Promise<T>): EventHandler
  function respondWithError(event: H3Event, error: unknown): ApiErrorBody   // sets the status, returns the body
  function parseFresh(event: H3Event): boolean                                // ?fresh=1 or ?fresh=true
  ```
  `H3EventContext` gains `requestId?: string` and `logger?: pino.Logger`.

- [ ] **Step 1: Failing test**

`tests/unit/api.test.ts`:
```ts
import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FellowError } from '../../server/lib/fellow/errors'
import { defineApiRoute, parseFresh } from '../../server/utils/api'

function appWith(routes: Record<string, () => unknown>) {
  const app = createApp()
  const router = createRouter()
  for (const [path, fn] of Object.entries(routes)) router.get(path, defineApiRoute(fn))
  router.get('/fresh', defineApiRoute(event => ({ fresh: parseFresh(event) })))
  app.use(router)
  return toWebHandler(app)
}

describe('defineApiRoute', () => {
  const handler = appWith({
    '/ok': () => ({ hello: 'world' }),
    '/zod': () => z.object({ ratio: z.number().min(14) }).parse({ ratio: 3 }),
    '/fellow': () => {
      throw new FellowError('fellow_auth_failed', 'Fellow rejected the email or password', { status: 401, body: { secret: 'never' } })
    },
    '/boom': () => {
      throw new Error('kaboom')
    },
  })
  const get = async (path: string) => {
    const res = await handler(new Request(`http://localhost:3000${path}`))
    return { status: res.status, body: await res.json() }
  }

  it('passes results through', async () => {
    expect(await get('/ok')).toEqual({ status: 200, body: { hello: 'world' } })
  })
  it('maps Zod errors to 400 with the issue list', async () => {
    const { status, body } = await get('/zod')
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
    expect(body.issues).toEqual([{ path: 'ratio', message: expect.stringMatching(/14/) }])
  })
  it('maps FellowError to 502 with the code and message but never the body', async () => {
    const { status, body } = await get('/fellow')
    expect(status).toBe(502)
    expect(body).toEqual({ error: 'fellow_auth_failed', message: 'Fellow rejected the email or password' })
    expect(JSON.stringify(body)).not.toContain('never')
  })
  it('maps anything else to a generic 500', async () => {
    expect(await get('/boom')).toEqual({ status: 500, body: { error: 'internal_error' } })
  })
  it.each([['?fresh=1', true], ['?fresh=true', true], ['?fresh=0', false], ['', false]])('parseFresh %j → %s', async (query, expected) => {
    expect((await get(`/fresh${query}`)).body).toEqual({ fresh: expected })
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`server/types/h3.d.ts`:
```ts
import type { Logger } from 'pino'

declare module 'h3' {
  interface H3EventContext {
    requestId?: string
    logger?: Logger
  }
}

export {}
```

`server/utils/api.ts`:
```ts
import { type EventHandler, type H3Event, defineEventHandler, getQuery, setResponseStatus } from 'h3'
import { ZodError } from 'zod'
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
    setResponseStatus(event, 400)
    return {
      error: 'validation_failed',
      issues: error.issues.map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message })),
    }
  }
  if (error instanceof FellowError) {
    // The message is ours; the body is Fellow's and stays on the server.
    logger.warn({ code: error.code, status: error.status }, error.message)
    setResponseStatus(event, 502)
    return { error: error.code, message: error.message }
  }
  logger.error({ err: error }, 'Unhandled error in an API route')
  setResponseStatus(event, 500)
  return { error: 'internal_error' }
}

export function parseFresh(event: H3Event): boolean {
  const value = getQuery(event).fresh
  return value === '1' || value === 'true'
}
```
Because `useLogger()` needs config, the `api.test.ts` cases that hit the Fellow/500 branches must set the env first. Add to the top of that test file:
```ts
import { beforeAll } from 'vitest'
import { resetConfigForTests } from '../../server/utils/config'
import { resetLoggerForTests } from '../../server/utils/logger'
beforeAll(() => {
  Object.assign(process.env, { FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2', HOST: '127.0.0.1', LOG_LEVEL: 'silent' })
  resetConfigForTests()
  resetLoggerForTests()
})
```

- [ ] **Step 4: Run to verify pass**, lint, typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): shared API error mapping and event context types"`

---

### Task 5: Middleware and the in-process test app

**Files:**
- Create: `server/middleware/00.request-id.ts`, `server/middleware/01.host-allowlist.ts`, `server/middleware/02.csrf.ts`, `tests/helpers/app.ts`
- Modify: `server/api/health.get.ts` (explicit h3 import)
- Test: `tests/routes/middleware.test.ts`

**Interfaces:**
- Produces: `createTestApp(): { fetch(path: string, init?: RequestInit, options?: { sameOrigin?: boolean }): Promise<Response>; json(method: string, path: string, body?: unknown): Promise<{ status: number; body: any; headers: Headers }> }` and `useTestEnv(overrides?: Record<string, string>): void` which sets a complete env (`FELLOW_EMAIL`, `FELLOW_PASSWORD`, `HOST=127.0.0.1`, `LOG_LEVEL=silent`, `FELLOW_DRY_RUN=false`, `ALLOWED_HOSTS` deleted) and resets config, logger, and client singletons. `fetch` targets `http://localhost:3000` and, unless `sameOrigin: false`, adds `sec-fetch-site: same-origin`.

- [ ] **Step 1: Failing tests**

`tests/routes/middleware.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'

describe('request pipeline', () => {
  beforeEach(() => useTestEnv())

  it('tags every response with a request id', async () => {
    const res = await createTestApp().fetch('/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects a Host that is not allowed', async () => {
    const app = createTestApp()
    const res = await app.fetch('/api/health', { headers: { host: 'evil.example:3000' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'host_not_allowed' })
  })

  it('honours ALLOWED_HOSTS from the environment', async () => {
    useTestEnv({ ALLOWED_HOSTS: 'aiden.example.com' })
    const app = createTestApp()
    expect((await app.fetch('/api/health')).status).toBe(400)
    expect((await app.fetch('/api/health', { headers: { host: 'aiden.example.com' } })).status).toBe(200)
  })

  it('lets GET through without CSRF headers', async () => {
    expect((await createTestApp().fetch('/api/health', {}, { sameOrigin: false })).status).toBe(200)
  })

  it('rejects a mutation with neither Sec-Fetch-Site nor an allowed Origin', async () => {
    const res = await createTestApp().fetch('/api/profiles', { method: 'POST' }, { sameOrigin: false })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'cross_site_request' })
  })

  it('rejects a mutation from a foreign origin even when it claims same-site', async () => {
    const res = await createTestApp().fetch('/api/profiles', {
      method: 'POST',
      headers: { 'origin': 'http://evil.example', 'sec-fetch-site': 'same-site' },
    }, { sameOrigin: false })
    expect(res.status).toBe(403)
  })

  it('accepts a mutation with an allowed Origin and no Sec-Fetch-Site', async () => {
    const res = await createTestApp().fetch('/api/profiles', {
      method: 'POST',
      headers: { 'origin': 'http://localhost:3000', 'content-type': 'application/json' },
      body: '{}',
    }, { sameOrigin: false })
    expect(res.status).not.toBe(403)
  })
})
```
(The last case reaches the profiles route and fails validation with 400, which is the point: CSRF let it through.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`server/middleware/00.request-id.ts`:
```ts
import { defineEventHandler, setHeader } from 'h3'
import { useLogger } from '../utils/logger'

/** Every request gets an id, a child logger carrying it, and the id echoed in a response header. */
export default defineEventHandler((event) => {
  const requestId = crypto.randomUUID()
  event.context.requestId = requestId
  event.context.logger = useLogger().child({ requestId })
  setHeader(event, 'x-request-id', requestId)
})
```

`server/middleware/01.host-allowlist.ts`:
```ts
import { defineEventHandler, getRequestHost, setResponseStatus } from 'h3'
import { getConfig } from '../utils/config'
import { hostnameOf } from '../utils/hosts'

/** Closes DNS rebinding: a request whose Host header is not ours is answered with 400 before any route runs. */
export default defineEventHandler((event) => {
  const host = hostnameOf(getRequestHost(event))
  if (getConfig().allowedHosts.includes(host)) return
  event.context.logger?.warn({ host }, 'Rejected a request for a host that is not allowed')
  setResponseStatus(event, 400)
  return { error: 'host_not_allowed' }
})
```

`server/middleware/02.csrf.ts`:
```ts
import { defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { getConfig } from '../utils/config'
import { isAllowedOrigin } from '../utils/hosts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * With no login, every tab in the owner's browser is the owner, so a mutation must prove it came from
 * this site: Sec-Fetch-Site: same-origin, or an Origin naming an allowed host. Non-browser clients send
 * an Origin header explicitly.
 */
export default defineEventHandler((event) => {
  if (!MUTATING_METHODS.has(event.method)) return
  if (getHeader(event, 'sec-fetch-site') === 'same-origin') return
  const origin = getHeader(event, 'origin')
  if (isAllowedOrigin(origin, getConfig().allowedHosts)) return
  event.context.logger?.warn({ origin: origin ?? null, method: event.method, path: event.path }, 'Rejected a cross-site mutation')
  setResponseStatus(event, 403)
  return { error: 'cross_site_request' }
})
```

`server/api/health.get.ts`:
```ts
import { defineEventHandler } from 'h3'

/** Unauthenticated liveness probe. No Fellow call, no secrets. */
export default defineEventHandler(() => ({ ok: true }))
```

`tests/helpers/app.ts` (routes for Task 6 are added there as they are written; start with health):
```ts
import { createApp, createRouter, toWebHandler } from 'h3'
import health from '../../server/api/health.get'
import requestId from '../../server/middleware/00.request-id'
import hostAllowlist from '../../server/middleware/01.host-allowlist'
import csrf from '../../server/middleware/02.csrf'
import { resetConfigForTests } from '../../server/utils/config'
import { resetFellowClientForTests } from '../../server/utils/fellow-client'
import { resetLoggerForTests } from '../../server/utils/logger'

const BASE_ENV: Record<string, string> = {
  FELLOW_EMAIL: 'coffee@example.com',
  FELLOW_PASSWORD: 'hunter2',
  FELLOW_DRY_RUN: 'false',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
}

/** A complete, known environment plus fresh config, logger, and Fellow client singletons. */
export function useTestEnv(overrides: Record<string, string> = {}): void {
  for (const key of ['ALLOWED_HOSTS', 'FELLOW_TIMEZONE', 'PORT', 'NODE_ENV']) delete process.env[key]
  Object.assign(process.env, BASE_ENV, overrides)
  resetConfigForTests()
  resetLoggerForTests()
  resetFellowClientForTests()
}

export interface JsonResult { status: number, body: any, headers: Headers }

/** The Nitro request pipeline and routes, mounted on a plain h3 app so tests run in-process against msw. */
export function createTestApp() {
  const app = createApp()
  app.use(requestId)
  app.use(hostAllowlist)
  app.use(csrf)
  const router = createRouter()
  router.get('/api/health', health)
  app.use(router)
  const handler = toWebHandler(app)

  async function fetch(path: string, init: RequestInit = {}, { sameOrigin = true }: { sameOrigin?: boolean } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (sameOrigin && !headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin')
    return handler(new Request(`http://localhost:3000${path}`, { ...init, headers }))
  }

  async function json(method: string, path: string, body?: unknown): Promise<JsonResult> {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers }
  }

  return { fetch, json }
}
```
The middleware test's Host cases pass a `host` header on a `Request`; the Fetch API forbids setting `Host` on outgoing requests in browsers, but Node's `Request` keeps it and h3's `getRequestHost` reads it. If Node strips it, replace those cases with `new Request('http://evil.example:3000/api/health')` and pass the URL through `fetch` by accepting absolute paths.

- [ ] **Step 4: Run to verify pass**, lint, typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): request ids, Host allowlist, and CSRF middleware with an in-process test app"`

---

### Task 6: Routes

**Files:**
- Create: `server/api/status.get.ts`, `server/api/device.get.ts`, `server/api/profiles/index.get.ts`, `server/api/profiles/index.post.ts`, `server/api/profiles/import.post.ts`, `server/api/profiles/[id].patch.ts`, `server/api/profiles/[id].delete.ts`, `server/api/profiles/[id]/share.post.ts`, `server/api/schedules/index.get.ts`, `server/api/schedules/index.post.ts`, `server/api/schedules/[id].patch.ts`, `server/api/schedules/[id].delete.ts`, `server/api/brew/start.post.ts`
- Modify: `tests/helpers/app.ts` (register every route)
- Test: `tests/routes/status.test.ts`, `tests/routes/device.test.ts`, `tests/routes/profiles.test.ts`, `tests/routes/schedules.test.ts`, `tests/routes/brew.test.ts`

**Interfaces (response shapes the UI relies on):**

| Route | Success |
|---|---|
| `GET /api/status` | 200 `{ dryRun: boolean, version: string, fellow: FellowOutcome }` |
| `GET /api/device?fresh=1` | 200 `{ device: Device, canStartBrew: boolean, blockers: string[] }` |
| `GET /api/profiles?fresh=1` | 200 `Profile[]` |
| `POST /api/profiles` | 201 `Profile` |
| `POST /api/profiles/import` body `{ link }` | 201 `Profile` |
| `PATCH /api/profiles/:id` | 200 `{ ok: true }` |
| `DELETE /api/profiles/:id` | 200 `{ ok: true }` |
| `POST /api/profiles/:id/share` | 200 `{ link }` |
| `GET /api/schedules?fresh=1` | 200 `Schedule[]` |
| `POST /api/schedules` | 201 `Schedule` |
| `PATCH /api/schedules/:id` | 200 `{ ok: true }` |
| `DELETE /api/schedules/:id` | 200 `{ ok: true }` |
| `POST /api/brew/start` | 202 `{ ok: true, result: object }`; 409 `{ error: 'brewer_not_ready', blockers: string[] }` |

Errors follow `respondWithError`. All Fellow-backed routes go through `defineApiRoute`.

- [ ] **Step 1: Failing tests**

`tests/routes/status.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../server/utils/version'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

describe('GET /api/status', () => {
  beforeEach(() => useTestEnv())

  it('reports dry run, version, and an unknown Fellow state before any call', async () => {
    useTestEnv({ FELLOW_DRY_RUN: 'true' })
    const { status, body } = await createTestApp().json('GET', '/api/status')
    expect(status).toBe(200)
    expect(body).toEqual({ dryRun: true, version: APP_VERSION, fellow: 'unknown' })
  })

  it('reflects the last Fellow outcome', async () => {
    server.use(...happyHandlers(newCalls()))
    const app = createTestApp()
    await app.json('GET', '/api/device')
    expect((await app.json('GET', '/api/status')).body.fellow).toBe('ok')
  })

  it('shows auth_failed after Fellow rejects the credentials', async () => {
    server.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({ message: 'no' }, { status: 401 })))
    const app = createTestApp()
    const device = await app.json('GET', '/api/device')
    expect(device.status).toBe(502)
    expect(device.body).toEqual({ error: 'fellow_auth_failed', message: expect.any(String) })
    expect((await app.json('GET', '/api/status')).body.fellow).toBe('fellow_auth_failed')
  })
})
```

`tests/routes/device.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'
import { DEVICE, DEVICE_DETAIL, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

describe('GET /api/device', () => {
  beforeEach(() => useTestEnv())

  it('returns the device with readiness, serving repeats from cache', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const app = createTestApp()
    const first = await app.json('GET', '/api/device')
    expect(first.status).toBe(200)
    expect(first.body.device).toEqual(DEVICE)
    expect(first.body.canStartBrew).toBe(false)
    expect(first.body.blockers).toContain('brewer is offline')
    await app.json('GET', '/api/device')
    expect(calls.devices).toBe(1)
  })

  it('refreshes through the detail route when fresh is requested', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const app = createTestApp()
    await app.json('GET', '/api/device')
    const { body } = await app.json('GET', '/api/device?fresh=1')
    expect(calls.deviceDetail).toBe(1)
    expect(body.device).toEqual({ ...DEVICE, ...DEVICE_DETAIL })
  })
})
```

`tests/routes/profiles.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, DEVICE, PROFILE_INPUT, PROFILE_P7, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

const profilesUrl = `${BASE}/devices/${DEVICE.id}/profiles`

describe('/api/profiles', () => {
  beforeEach(() => useTestEnv())

  it('lists profiles', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('GET', '/api/profiles')
    expect(status).toBe(200)
    expect(body.map((p: { id: string }) => p.id)).toEqual(['p7', 'p8'])
  })

  it('creates a profile and answers 201 with Fellow\'s record', async () => {
    let posted: unknown
    server.use(...happyHandlers(newCalls()), http.post(profilesUrl, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ ...PROFILE_INPUT, id: 'p9' })
    }))
    const { status, body } = await createTestApp().json('POST', '/api/profiles', PROFILE_INPUT)
    expect(status).toBe(201)
    expect(body.id).toBe('p9')
    expect(posted).toEqual(PROFILE_INPUT)
  })

  it('rejects an invalid profile with 400 and the offending paths', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/profiles', { ...PROFILE_INPUT, ratio: 3, title: '' })
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
    expect(body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['ratio', 'title'])
  })

  it('rejects unknown keys such as a server-side id', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/profiles', { ...PROFILE_INPUT, id: 'p1' })
    expect(status).toBe(400)
    expect(body.issues[0].path).toBe('')
  })

  it('updates a profile', async () => {
    let patched: unknown
    server.use(...happyHandlers(newCalls()), http.patch(`${profilesUrl}/p7`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({})
    }))
    const { status, body } = await createTestApp().json('PATCH', '/api/profiles/p7', { ...PROFILE_P7, title: 'Renamed' })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(patched).toEqual({ ...PROFILE_INPUT, title: 'Renamed' })
  })

  it('rejects a malformed id in the path with 400', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('DELETE', '/api/profiles/x1')
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
  })

  it('deletes, shares, and imports', async () => {
    let deleted = false
    let importedBody: unknown
    server.use(
      ...happyHandlers(newCalls()),
      http.delete(`${profilesUrl}/p7`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(`${profilesUrl}/p7/share`, () => HttpResponse.json({ link: 'https://brew.link/p/ws98' })),
      http.get(`${BASE}/shared/aiden/ws98`, () => HttpResponse.json(PROFILE_P7)),
      http.post(profilesUrl, async ({ request }) => {
        importedBody = await request.json()
        return HttpResponse.json({ ...PROFILE_INPUT, id: 'p10' })
      }),
    )
    const app = createTestApp()
    expect(await app.json('DELETE', '/api/profiles/p7')).toMatchObject({ status: 200, body: { ok: true } })
    expect(deleted).toBe(true)
    expect(await app.json('POST', '/api/profiles/p7/share')).toMatchObject({ status: 200, body: { link: 'https://brew.link/p/ws98' } })
    const imported = await app.json('POST', '/api/profiles/import', { link: 'https://brew.link/p/ws98' })
    expect(imported.status).toBe(201)
    expect(imported.body.id).toBe('p10')
    expect(importedBody).toEqual(PROFILE_INPUT)
  })

  it('answers 502 with the Fellow error code when Fellow fails', async () => {
    server.use(...happyHandlers(newCalls()), http.post(`${profilesUrl}/p7/share`, () => HttpResponse.json({ message: 'internal', stack: 'secret' }, { status: 500 })))
    const { status, body } = await createTestApp().json('POST', '/api/profiles/p7/share')
    expect(status).toBe(502)
    expect(body.error).toBe('fellow_http_error')
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('rejects an invalid brew link with 400', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/profiles/import', { link: 'https://brew.link/q/ws98' })
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
  })
})
```

`tests/routes/schedules.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, DEVICE, SCHEDULE_INPUT, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

const schedulesUrl = `${BASE}/devices/${DEVICE.id}/schedules`

describe('/api/schedules', () => {
  beforeEach(() => useTestEnv())

  it('lists schedules', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('GET', '/api/schedules')
    expect(status).toBe(200)
    expect(body.map((s: { id: string }) => s.id)).toEqual(['s0'])
  })

  it('creates a schedule', async () => {
    server.use(...happyHandlers(newCalls()), http.post(schedulesUrl, () => HttpResponse.json({ ...SCHEDULE_INPUT, id: 's1' })))
    const { status, body } = await createTestApp().json('POST', '/api/schedules', SCHEDULE_INPUT)
    expect(status).toBe(201)
    expect(body.id).toBe('s1')
  })

  it('rejects an invalid schedule', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/schedules', { ...SCHEDULE_INPUT, days: [true] })
    expect(status).toBe(400)
    expect(body.issues[0].path).toBe('days')
  })

  it('toggles and deletes', async () => {
    let patched: unknown
    let deleted = false
    server.use(
      ...happyHandlers(newCalls()),
      http.patch(`${schedulesUrl}/s0`, async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({})
      }),
      http.delete(`${schedulesUrl}/s0`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const app = createTestApp()
    expect(await app.json('PATCH', '/api/schedules/s0', { enabled: false })).toMatchObject({ status: 200, body: { ok: true } })
    expect(patched).toEqual({ enabled: false })
    expect(await app.json('DELETE', '/api/schedules/s0')).toMatchObject({ status: 200, body: { ok: true } })
    expect(deleted).toBe(true)
  })

  it('rejects a patch with unknown keys', async () => {
    server.use(...happyHandlers(newCalls()))
    expect((await createTestApp().json('PATCH', '/api/schedules/s0', { bogus: 1 })).status).toBe(400)
  })
})
```

`tests/routes/brew.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, DEVICE, DEVICE_DETAIL, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

const READY_DETAIL = { ...DEVICE_DETAIL, firmwareVersion: '1.5.16' }

describe('POST /api/brew/start', () => {
  beforeEach(() => useTestEnv())

  it('refuses with the blockers when the brewer is not ready', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/brew/start')
    expect(status).toBe(409)
    expect(body.error).toBe('brewer_not_ready')
    expect(body.blockers).toContain('brewer is offline')
  })

  it('always checks a fresh device state before starting', async () => {
    const calls = newCalls()
    let started = false
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => {
        calls.deviceDetail++
        return HttpResponse.json(READY_DETAIL)
      }),
      ...happyHandlers(calls),
      http.patch(`${BASE}/devices/${DEVICE.id}/start`, ({ request }) => {
        started = new URL(request.url).searchParams.get('confirm') === 'true'
        return HttpResponse.json({ status: 'started' })
      }),
    )
    const app = createTestApp()
    await app.json('GET', '/api/device')
    const { status, body } = await app.json('POST', '/api/brew/start')
    expect(status).toBe(202)
    expect(body).toEqual({ ok: true, result: { status: 'started' } })
    expect(started).toBe(true)
    expect(calls.deviceDetail).toBe(1)
  })

  it('does not touch the brewer in dry-run mode', async () => {
    useTestEnv({ FELLOW_DRY_RUN: 'true' })
    const calls = newCalls()
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => {
        calls.deviceDetail++
        return HttpResponse.json(READY_DETAIL)
      }),
      ...happyHandlers(calls),
    )
    const app = createTestApp()
    await app.json('GET', '/api/device')
    const { status, body } = await app.json('POST', '/api/brew/start')
    expect(status).toBe(202)
    expect(body.result).toEqual({ dryRun: true })
  })
})
```

- [ ] **Step 2: Run** `pnpm vitest run tests/routes` → failures (routes not registered / not found).

- [ ] **Step 3: Implement the routes**

`server/api/status.get.ts`:
```ts
import { defineApiRoute } from '../utils/api'
import { getConfig } from '../utils/config'
import { useFellowClient } from '../utils/fellow-client'
import { APP_VERSION } from '../utils/version'

/** What the UI needs to render its header: dry-run badge, version, and whether Fellow is happy. */
export default defineApiRoute(() => ({
  dryRun: getConfig().fellow.dryRun,
  version: APP_VERSION,
  fellow: useFellowClient().lastOutcome,
}))
```

`server/api/device.get.ts`:
```ts
import { brewStartBlockers } from '../lib/fellow'
import { defineApiRoute, parseFresh } from '../utils/api'
import { useFellowClient } from '../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const device = await useFellowClient().getDevice({ fresh: parseFresh(event) })
  const blockers = brewStartBlockers(device)
  return { device, canStartBrew: blockers.length === 0, blockers }
})
```

`server/api/profiles/index.get.ts`:
```ts
import { defineApiRoute, parseFresh } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(event => useFellowClient().getProfiles({ fresh: parseFresh(event) }))
```

`server/api/profiles/index.post.ts`:
```ts
import { readBody, setResponseStatus } from 'h3'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const profile = await useFellowClient().createProfile(asObject(await readBody(event)))
  event.context.logger?.info({ action: 'profile.create', profileId: profile.id }, 'Profile created')
  setResponseStatus(event, 201)
  return profile
})
```
Add to `server/utils/api.ts` and import it above:
```ts
/** Bodies must be JSON objects; the schemas do the rest. Anything else is a validation failure, not a crash. */
export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ZodError([{ code: 'invalid_type', expected: 'object', path: [], message: 'Request body must be a JSON object' } as never])
  }
  return body as Record<string, unknown>
}
```
(If Zod 4's `ZodError` constructor rejects that literal, build the error with `z.object({}).safeParse(body).error!` instead; the test only asserts a 400 and `path: ''`.)

`server/api/profiles/import.post.ts`:
```ts
import { readBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import { parseBrewLink } from '../../lib/fellow'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

const ImportBody = z.strictObject({ link: z.string().min(1) })

export default defineApiRoute(async (event) => {
  const { link } = ImportBody.parse(await readBody(event))
  const parsed = safeBrewLink(link)
  const profile = await useFellowClient().createProfileFromLink(link)
  event.context.logger?.info({ action: 'profile.import', profileId: profile.id, brewId: parsed.id }, 'Profile imported from brew.link')
  setResponseStatus(event, 201)
  return profile
})

/** An unparseable link is the caller's mistake (400), not a Fellow failure (502). */
function safeBrewLink(link: string) {
  try {
    return parseBrewLink(link)
  }
  catch {
    throw new z.ZodError([{ code: 'custom', path: ['link'], message: 'Not a brew.link URL or profile id' } as never])
  }
}
```

`server/api/profiles/[id].patch.ts`:
```ts
import { getRouterParam, readBody } from 'h3'
import { ProfileIdSchema } from '../../lib/fellow'
import { asObject, defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const id = ProfileIdSchema.parse(getRouterParam(event, 'id'))
  await useFellowClient().updateProfile(id, asObject(await readBody(event)))
  event.context.logger?.info({ action: 'profile.update', profileId: id }, 'Profile updated')
  return { ok: true }
})
```

`server/api/profiles/[id].delete.ts`:
```ts
import { getRouterParam } from 'h3'
import { ProfileIdSchema } from '../../lib/fellow'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const id = ProfileIdSchema.parse(getRouterParam(event, 'id'))
  await useFellowClient().deleteProfile(id)
  event.context.logger?.info({ action: 'profile.delete', profileId: id }, 'Profile deleted')
  return { ok: true }
})
```

`server/api/profiles/[id]/share.post.ts`:
```ts
import { getRouterParam } from 'h3'
import { ProfileIdSchema } from '../../../lib/fellow'
import { defineApiRoute } from '../../../utils/api'
import { useFellowClient } from '../../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const id = ProfileIdSchema.parse(getRouterParam(event, 'id'))
  const link = await useFellowClient().generateShareLink(id)
  event.context.logger?.info({ action: 'profile.share', profileId: id }, 'Share link generated')
  return { link }
})
```

`server/api/schedules/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`: the same four shapes with `getSchedules`, `createSchedule` (201, log `schedule.create`), `updateSchedule` with `ScheduleIdSchema` (log `schedule.update`), `deleteSchedule` (log `schedule.delete`).

`server/api/brew/start.post.ts`:
```ts
import { setResponseStatus } from 'h3'
import { brewStartBlockers } from '../../lib/fellow'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

/** Fellow does not validate readiness for you, so a fresh device read gates every start. */
export default defineApiRoute(async (event) => {
  const client = useFellowClient()
  const blockers = brewStartBlockers(await client.getDevice({ fresh: true }))
  if (blockers.length > 0) {
    event.context.logger?.warn({ action: 'brew.start', blockers }, 'Remote start refused')
    setResponseStatus(event, 409)
    return { error: 'brewer_not_ready', blockers }
  }
  const result = await client.startBrew()
  event.context.logger?.info({ action: 'brew.start', dryRun: client.dryRun }, 'Remote start requested')
  setResponseStatus(event, 202)
  return { ok: true, result }
})
```

Register every route in `tests/helpers/app.ts` (`router.get('/api/status', status)`, …, `router.post('/api/profiles/import', profilesImport)` **before** `router.patch('/api/profiles/:id', …)`, `router.post('/api/profiles/:id/share', …)`, `router.post('/api/brew/start', …)`).

- [ ] **Step 4: Run** `pnpm test` → all pass; lint; typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): device, profile, schedule, status, and remote-start routes"`

---

### Task 7: Startup plugin, nuxt-security, verification, docs

**Files:**
- Create: `server/plugins/startup.ts`
- Modify: `nuxt.config.ts`, `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `package.json` (version 0.2.0), `docs/aiden-studio-build-prompt.md` (§9 tick)

- [ ] **Step 1: Startup plugin** `server/plugins/startup.ts`:
```ts
import { FellowError } from '../lib/fellow'
import { getConfig } from '../utils/config'
import { useFellowClient } from '../utils/fellow-client'
import { CURRENT_LOG_FILE, useLogger } from '../utils/logger'
import { checkStartupSafety } from '../utils/startup'

/** Refuses to start off loopback, prints the one startup line, and probes Fellow without blocking. */
export default defineNitroPlugin(() => {
  let config: ReturnType<typeof getConfig>
  try {
    config = getConfig()
  }
  catch (error) {
    console.error(`aiden-studio cannot start: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  const problems = checkStartupSafety(config)
  if (problems.length > 0) {
    console.error(`aiden-studio refused to start:\n${problems.map(p => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }

  const logger = useLogger()
  logger.info({
    host: config.host,
    port: config.port,
    dryRun: config.fellow.dryRun,
    timezone: config.fellow.timezone,
    allowedHosts: config.allowedHosts,
    logLevel: config.logLevel,
  }, 'aiden-studio starting')
  console.log(`aiden-studio on http://${config.host}:${config.port} | dry run: ${config.fellow.dryRun} | logs: ${config.isProduction ? CURRENT_LOG_FILE : 'stdout'}`)

  useFellowClient().getDevice().then(
    device => logger.info({ deviceId: device.id, displayName: device.displayName }, 'Fellow brewer reachable'),
    (error: unknown) => logger.warn({ code: error instanceof FellowError ? error.code : 'unknown' }, 'Fellow probe failed; the dashboard will show the error'),
  )
})
```

- [ ] **Step 2: nuxt-security** in `nuxt.config.ts`:
```ts
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-security'],
  css: ['~/assets/css/main.css'],
  nitro: { preset: 'node-server' },
  security: {
    // No login and no cross-origin consumers: the Host allowlist and CSRF middleware carry the request-side
    // protection, nuxt-security carries the response headers. Its rate limiter and CORS handler add nothing here.
    rateLimiter: false,
    corsHandler: false,
    headers: {
      contentSecurityPolicy: {
        'frame-ancestors': ["'none'"],
      },
    },
  },
})
```
Run `pnpm add nuxt-security@^2.6.0` first.

- [ ] **Step 3: Verify the built server end to end**

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
ls .output/server/node_modules | grep pino-roll          # traced into the bundle
# 1. Guard: HOST unset → exits non-zero with the message
FELLOW_EMAIL=coffee@example.com FELLOW_PASSWORD=x NODE_ENV=production node .output/server/index.mjs; echo "exit $?"
# 2. Guard: non-loopback → exits non-zero
HOST=0.0.0.0 FELLOW_EMAIL=coffee@example.com FELLOW_PASSWORD=x NODE_ENV=production node .output/server/index.mjs; echo "exit $?"
# 3. Happy path (bad Fellow creds are fine: the probe just logs a warning)
rm -rf logs; HOST=127.0.0.1 PORT=3999 FELLOW_EMAIL=coffee@example.com FELLOW_PASSWORD=x FELLOW_DRY_RUN=true NODE_ENV=production node .output/server/index.mjs & 
curl -si --retry 15 --retry-connrefused --retry-delay 1 http://127.0.0.1:3999/api/health      # 200, x-request-id, content-security-policy, x-frame-options
curl -si -H 'Host: evil.example' http://127.0.0.1:3999/api/health | head -1                     # 400
curl -si -X POST http://127.0.0.1:3999/api/profiles | head -1                                   # 403
curl -si -X POST -H 'Origin: http://127.0.0.1:3999' -H 'content-type: application/json' -d '{}' http://127.0.0.1:3999/api/profiles | head -1   # 400 (validation)
curl -s http://127.0.0.1:3999/api/status                                                        # {"dryRun":true,"version":"0.2.0","fellow":...}
kill %1; ls -la logs; head -c 400 logs/current.log                                              # symlink + JSON lines with the startup record
```
Expected: exactly as annotated. If `pino-roll` is missing from `.output/server/node_modules`, replace the side-effect import with `import pinoRoll from 'pino-roll'` referenced in a no-op so the bundler keeps it.

- [ ] **Step 4: Docs**
- `CHANGELOG.md`: `## [0.2.0] - <date>` with Added (routes list, middleware, startup guard, rotating logs, status) and Changed (`h3` and `pino-roll`, `nuxt-security` dependencies). Bump `package.json` to `0.2.0`.
- `README.md`: under Scripts/Configuration add a short "API" section listing the routes and the note that non-browser clients must send `Origin: http://localhost:3000` on mutations; mention `logs/current.log`.
- `ARCHITECTURE.md`: add a "Request pipeline" section (request id → Host allowlist → CSRF → route → shared error mapping) and note that route files import from `h3` so tests mount them in-process.
- `docs/aiden-studio-build-prompt.md` §9: mark checkpoint 2 done with the date and tag.

- [ ] **Step 5: Commit and tag** — `git commit -m "feat: startup guard, security headers, docs for checkpoint 2"`, `git tag v0.2.0`.

## Self-review notes

- Spec coverage: §3b routes (Task 6, all thirteen), shared error mapping (Task 4), Host allowlist and CSRF (Task 5), nuxt-security headers (Task 7), startup guard (Tasks 1 and 7), §6 logging: levels, redaction, pino-roll, startup line, request id, mutation logging with target ids, no access log (Tasks 2, 5, 6, 7). Deferred by design: the `/logs` page (UI, checkpoint 3), launchd (checkpoint 4).
- Names used across tasks: `hostnameOf`/`isAllowedOrigin` (1→5), `checkStartupSafety` (1→7), `createLogger`/`useLogger`/`resetLoggerForTests`/`CURRENT_LOG_FILE` (2→5, 7), `lastOutcome`/`brewStartBlockers`/`resetFellowClientForTests` (3→6), `defineApiRoute`/`respondWithError`/`parseFresh`/`asObject` (4→6), `createTestApp`/`useTestEnv` (5→6), `APP_VERSION` (1→6).
