# Config File and Red/Blue Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `aiden.config.ts` at the repo root the single source of truth for every non-secret setting, keep only secrets in `.env`, close the gaps found by the first red-team pass, and record the pass in the README.

**Architecture:** `server/utils/aiden-config.ts` holds the Zod schema and `defineAidenConfig`; `aiden.config.ts` (root) is the one file the owner edits. `server/utils/config.ts` merges that file with `.env` (secrets required; a few keys may override). `nuxt.config.ts` reads the same file for the dev server address; the startup plugin pushes the validated host and port into `NITRO_HOST`/`NITRO_PORT` so the production bind cannot drift from the file. Hardening fixes land in the existing middleware, error mapping, and a new API catch-all.

**Tech Stack:** as before.

**Spec:** `docs/aiden-studio-build-prompt.md` §1 (configuration), §5; owner requests of 2026-09-10 (config file, `.env.sample`, red/blue log).

> **Execution notes (2026-09-10).** Done and tagged `v0.2.1`. The checkpoint 2 review landed while this ran and its findings were merged in: NITRO_HOST precedence (R5), h3 error envelope (R2), XSS validator off, PATCH body cap, fail-closed Host, log levels, cold-client fresh reads, single-parse import, the smoke script. `logging.maxFileMb` was added to the config schema for the size-based rotation.

## Global Constraints

- Secrets (`FELLOW_EMAIL`, `FELLOW_PASSWORD`) live only in `.env`; `aiden.config.ts` never holds them.
- Env overrides are explicit and few: `FELLOW_DRY_RUN`, `FELLOW_TIMEZONE`, `HOST`, `PORT`, `ALLOWED_HOSTS`, `LOG_LEVEL`. Precedence: env (when set) > `aiden.config.ts`.
- The startup guard still refuses a non-loopback host, whatever its source.
- README gets a "Red team / blue team log" section: newest entry open and dated, older entries collapsed with `<details>`.
- Commit messages carry no AI co-author trailer.

## Red-team findings driving this plan (2026-09-10)

| # | Finding | Severity |
|---|---|---|
| R1 | Cross-site GET requests to `/api/*` (for example `<img src="http://localhost:3000/api/device?fresh=1">` on any page the owner visits) reach the route and can make Fellow calls. CORS stops the read, not the request. | Medium |
| R2 | Errors thrown by h3 itself inside a route (malformed JSON, `__proto__` keys) bypass the shared mapping and answer with h3's `{ error: true, url, statusCode, statusMessage, message }` envelope. | Low |
| R3 | Unknown `/api/*` paths and wrong methods (for example `POST /api/profiles/p7`) fall through to the Nuxt page renderer and answer 200 HTML. | Low |
| R4 | API responses carry no `Cache-Control`. | Low |
| R5 | `NITRO_HOST` is read by Nitro before `HOST`, but the guard only sees `HOST`: `NITRO_HOST=0.0.0.0 HOST=127.0.0.1` passes the guard and binds every interface. | High |
| R6 | `X-Frame-Options: SAMEORIGIN` disagrees with CSP `frame-ancestors 'none'`. | Info |
| R7 | `pnpm audit`: esbuild 0.27.7 (via `@nuxt/fonts` → `fontless`) has a low advisory (dev-server file read on Windows). | Low |
| R8 | `logs/` and `.env` permissions are not enforced or checked. | Low |

---

### Task 1: `aiden.config.ts` and the merged config

**Files:**
- Create: `server/utils/aiden-config.ts`, `aiden.config.ts`
- Modify: `server/utils/config.ts`, `server/utils/logger.ts`, `server/utils/fellow-client.ts`, `server/utils/startup.ts`, `server/plugins/startup.ts`, `nuxt.config.ts`, `tests/unit/config.test.ts`, `tests/unit/startup.test.ts`, `tests/unit/logger.test.ts`, `tests/helpers/app.ts`
- Test: `tests/unit/aiden-config.test.ts`

**Interfaces:**
```ts
// server/utils/aiden-config.ts
const LOG_LEVELS: readonly ['fatal','error','warn','info','debug','trace','silent']
type LogLevel
const AidenConfigSchema: ZodType<AidenConfig>
interface AidenConfig {
  app: { name: string }
  server: { host: string; port: number; allowedHosts: string[] }
  fellow: { dryRun: boolean; timezone: string | null; baseUrl: string; timeoutMs: number; retry: { attempts: number; backoffBaseMs: number }; cacheTtlMs: number }
  logging: { level: LogLevel | null; directory: string; keepDays: number }
  ui: { colorMode: 'dark' | 'light' | 'system'; confirmBrewStart: boolean }
}
function defineAidenConfig(config: AidenConfig): AidenConfig   // validates, throws with a readable message

// server/utils/config.ts
interface AppConfig {
  app: { name: string }
  fellow: { email: string; password: string; dryRun: boolean; timezone: string; baseUrl: string; timeoutMs: number; retry: { attempts: number; backoffBaseMs: number }; cacheTtlMs: number }
  host: string                       // always set now
  port: number
  allowedHosts: string[]
  logging: { level: LogLevel; directory: string; keepDays: number }
  ui: AidenConfig['ui']
  isProduction: boolean
}
function parseEnv(env: Record<string, string | undefined>, aiden?: AidenConfig): AppConfig
```
`logLevel` is replaced by `logging.level` everywhere.

- [ ] **Step 1: Failing tests** — `tests/unit/aiden-config.test.ts` checks `defineAidenConfig` accepts the fixture, rejects an unknown key, a non-https `baseUrl`, `keepDays: 0`. Rewrite `tests/unit/config.test.ts` to pass a fixture `AIDEN` object as the second argument: defaults come from the fixture; env overrides win; blank env means the fixture value; invalid overrides name the variable; `fellow.timezone` falls back to the machine zone when the fixture says `null`. `tests/unit/startup.test.ts` cases build configs with `parseEnv(env, AIDEN)` and host values from the fixture or env. `tests/unit/logger.test.ts` reads `config.logging.level`.
- [ ] **Step 2: Implement** the two new modules, the merge, and the consumers. `parseEnv` validates env with a schema whose override keys are all optional, then builds `AppConfig` from `aiden` with overrides applied, then validates the timezone (IANA) and `allowedHosts` (lower-cased, trimmed).
- [ ] **Step 3: Wire the bind address.** `nuxt.config.ts`: `import aiden from './aiden.config'` and `devServer: { host: aiden.server.host, port: aiden.server.port }`, `runtimeConfig: { public: { app: { name: aiden.app.name, ui: aiden.ui } } }`. `server/plugins/startup.ts`: after the guard passes, `process.env.NITRO_HOST = config.host; process.env.NITRO_PORT = String(config.port)` with a comment explaining Nitro reads these when it listens, after plugins ran. `checkStartupSafety` keeps its loopback check (the "unset" branch goes away).
- [ ] **Step 4: Verify** `pnpm test && pnpm lint && pnpm typecheck && pnpm build`, then: `NITRO_HOST=0.0.0.0 FELLOW_EMAIL=a@b.co FELLOW_PASSWORD=x NODE_ENV=production node .output/server/index.mjs` must print `Listening on http://127.0.0.1:3000` (the file wins); `HOST=0.0.0.0 …` must refuse to start.
- [ ] **Step 5: Commit** — `feat(config): aiden.config.ts as the single source of truth; .env holds secrets and explicit overrides`

---

### Task 2: Hardening fixes R1–R8

**Files:**
- Modify: `server/middleware/00.request-id.ts` (→ also `Cache-Control: no-store` on `/api/`), `server/middleware/02.csrf.ts`, `server/utils/api.ts`, `server/utils/logger.ts`, `server/plugins/startup.ts`, `nuxt.config.ts`, `pnpm-workspace.yaml`
- Create: `server/api/[...].ts`
- Test: `tests/routes/middleware.test.ts`, `tests/unit/api.test.ts`, `tests/routes/profiles.test.ts`

- [ ] **Step 1: Failing tests**
  - middleware: `GET /api/health` with `sec-fetch-site: cross-site` → 403 `{ error: 'cross_site_request' }`; with `same-site` → 403; with `none` → 200; every `/api/` response has `cache-control: no-store`; `GET /api/nope` → 404 `{ error: 'not_found' }`; `POST /api/profiles/p7` (same-origin) → 404.
  - api: a route throwing `createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })` → 400 `{ error: 'bad_request', message: 'Invalid JSON body' }`; a route throwing `createError({ statusCode: 418 })` → 418 `{ error: 'http_error', message: … }`.
  - profiles: `POST /api/profiles` with body `not json` and a JSON content type → 400 in our shape.
- [ ] **Step 2: Implement**
  - `02.csrf.ts`: for paths starting with `/api/`, if `sec-fetch-site` is `cross-site` or `same-site` → 403 for any method; then the existing mutation rule.
  - `00.request-id.ts`: `if (event.path.startsWith('/api/')) setHeader(event, 'cache-control', 'no-store')`.
  - `server/api/[...].ts`: `defineEventHandler((event) => { setResponseStatus(event, 404); return { error: 'not_found' } })` with the explicit h3 import.
  - `respondWithError`: `if (isError(error)) { setResponseStatus(event, error.statusCode); return { error: error.statusCode === 400 ? 'bad_request' : 'http_error', message: error.statusMessage ?? 'Request failed' } }` before the generic branch (`isError` from h3).
  - `nuxt.config.ts` security headers: `xFrameOptions: 'DENY'`.
  - `pnpm-workspace.yaml`: `overrides: { 'esbuild@<0.28.1': '^0.28.1' }` then `pnpm install`; keep only if build and tests stay green, otherwise record as accepted.
  - `createLogger` production branch: `mkdirSync(directory, { recursive: true, mode: 0o700 })` before creating the transport.
  - `startup.ts` plugin: if `.env` exists in `process.cwd()` and `(statSync('.env').mode & 0o077) !== 0`, log a warning naming `chmod 600 .env`.
- [ ] **Step 3: Verify** with the built server: probes 12, 13, 15, 17, 18, 21 from the red-team pass now answer 403, 400 (our shape), 400 (our shape), 404 JSON, 404 JSON, and carry `cache-control: no-store`.
- [ ] **Step 4: Commit** — `fix(security): same-site rule for API reads, uniform error envelope, API 404, no-store, DENY framing`

---

### Task 3: README red/blue log, docs, version

- [ ] Add to `README.md` a section `## Red team / blue team log` with the format rule in a one-line note, then the dated entry for 2026-09-10 (open): **Red** (the probe list), **Found** (R1–R8 with severity), **Blue** (every mitigation now in place, including the pre-existing ones: loopback bind and guard, Host allowlist, same-site and Origin rules, security headers, secret redaction, dry run, strict input validation, id validation, error envelope that never carries Fellow bodies, no retries on POST/PATCH, read cache, `.env` permissions, no auth by design and what that means). Older entries go inside `<details><summary>YYYY-MM-DD — title</summary>…</details>` beneath the open entry.
- [ ] Update `README.md` Setup/Configuration for `.env.sample` and `aiden.config.ts`; `ARCHITECTURE.md` configuration paragraph; the spec §1/§5/§10 and `.env` references; `CHANGELOG.md` `[0.2.1]`; `package.json` version `0.2.1`.
- [ ] Commit `docs: red/blue log, config file docs, 0.2.1` and tag `v0.2.1`.
