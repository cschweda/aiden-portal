# aiden-studio — Build Prompt

You are building a personal web app called **aiden-studio** for controlling a Fellow Aiden coffee brewer. It will live at `github.com/cschweda/aiden-studio`. It is a single-user app that may later grow to a handful of invited users. The Fellow API is undocumented; the reference implementation is the Python library at https://github.com/9b/fellow-aiden — port its **behavior**, not its structure.

Before writing code, confirm your understanding of the security model and the checkpoint plan (§9), and list any assumptions in a short plan. Anything about the Fellow API that the Python code does not demonstrate is a guess: mark it `// UNVERIFIED` in code and list every such item in `ARCHITECTURE.md`.

---

## 1. Stack (non-negotiable)

- Node 22 LTS, pinned in `engines` and `.nvmrc`
- Nuxt 4, Nuxt UI v4, TypeScript, pnpm 10
- Zod for all validation
- nuxt-auth-utils for sessions (sealed httpOnly cookies)
- better-sqlite3 ≥ 13 (ships prebuilt binaries; no install script)
- `@node-rs/argon2` for password hashing (prebuilt napi binary; no install script)
- pino for logging, pino-roll for rotation
- nuxt-security for headers
- Vitest for tests; msw for mocking the Fellow API
- Nitro preset: `node-server`
- License: MIT. The reference Python library is GPL-3.0; credit it in a dedicated README section (see §10). This is an independent implementation that ports behavior, not code.

pnpm 10 skips dependency build scripts by default. The two native modules above are chosen so nothing needs `pnpm approve-builds`. If `pnpm install` warns about ignored build scripts, treat it as a dependency to review, not a warning to silence.

All configuration is read once at startup into a Zod-validated config object (`server/utils/config.ts`). Nothing else reads `process.env`.

---

## 2. Phases

Build **Phase 1 only**. Leave clearly marked extension points and a `docs/PHASE-2.md` stub.

### Phase 1 — Local only (Mac, Apple Silicon)

- Accessed at `http://localhost:3000` only. Bind strictly to `127.0.0.1:3000`. No reverse proxy, no TLS, no Tailscale, no hosts-file aliases (browsers accept plain-HTTP session cookies on `localhost` and `127.0.0.1` and nowhere else).
- `HOST` must be set explicitly. Nitro's node-server binds every interface when `HOST` is unset, so the startup guard (§5) treats unset as non-loopback and refuses to start.
- Expected `.env`: `AUTH_ENABLED=false`, `NUXT_SESSION_COOKIE_SECURE=false`, `FELLOW_DRY_RUN=true` until the UI is trusted.
- SQLite at `./data/aiden.db` (path from `DATABASE_PATH`).
- A launchd LaunchAgent (§10) runs the production build at login and restarts it on crash.

### Phase 2 — DigitalOcean droplet (do NOT build now)

`docs/PHASE-2.md` should list what changes, and nothing else:

- Same `node-server` build; Nginx reverse proxy via Laravel Forge; trust `X-Forwarded-For` from loopback only.
- `AUTH_ENABLED=true`, `NUXT_SESSION_COOKIE_SECURE=true`, `ALLOWED_HOSTS=<droplet hostname>`; create users with `pnpm user:add`.
- Copy the SQLite file to the droplet — it's just a file, no migration tooling.
- Access choice: Tailscale-only (`tailscale serve`, or Nginx bound to the tailnet IP), or public HTTPS behind the existing rate limiter and password auth.
- **Auth is mandatory in Phase 2 regardless of access choice.** The startup guard sees only the bind address, not proxies: `tailscale serve` and Nginx both connect from 127.0.0.1, so the guard would allow `AUTH_ENABLED=false` while the app is exposed. Say this in bold in the stub.
- Logs: pino-roll keeps rotating on disk; add logrotate or ship to Forge's log viewer if wanted.

Migration between phases must be a change of **host and env vars**, never a change of code. No other deployment target is in scope; do not add fallbacks for hosts without a persistent disk.

---

## 3. Architecture

Two layers, strictly separated. The browser NEVER talks to Fellow directly and NEVER sees Fellow credentials.

### 3a. `server/utils/fellow/` — pure TypeScript Fellow client

No Nuxt or browser dependencies, so it can be extracted to its own npm package later. Takes its config (email, password, dry-run flag, logger) as constructor arguments and uses the global `fetch`.

**Authentication.** There is no API key or developer portal. The client logs in with the user's Fellow app account credentials from `FELLOW_EMAIL` / `FELLOW_PASSWORD`:

- `POST /auth/login` with `{ email, password }` → `{ accessToken, refreshToken }`
- Send `Authorization: Bearer <accessToken>` on every subsequent request.
- Log in lazily on the first Fellow call. Cache the access token in module scope. Optionally probe once at startup and log the result at `warn` if it fails; never block or exit on it.
- On 401: log in again with email/password and retry the original request **once**. A second 401 is an error.
- **Single-flight.** Concurrent requests that hit 401 at the same time must share one in-flight login promise. The dashboard fires several requests at once; one expiry must produce one login, not one per request.
- The login response also carries `refreshToken`. Store it, but do not use it: no refresh endpoint appears anywhere in the reference code, so its shape is unknown. Leave a named extension point (`refreshAccessToken()` that throws `NotImplemented`) and note it in `ARCHITECTURE.md`.
- If Fellow rejects the credentials, the app must still start. The failure surfaces as HTTP 502 `{ error: 'fellow_auth_failed' }` from any Fellow-backed route and as a banner on the dashboard. Never a 500, never a crash loop under launchd.

**Base URL:** `https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1`

**Required header on every request:** `User-Agent: Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0`

**Endpoints** (all verified against the reference library):

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | returns accessToken, refreshToken |
| GET | `/devices?dataType=real` | assume one brewer, take `[0]` |
| PATCH | `/devices/{id}` | body `{ [setting]: value }`. The reference never names a setting; nothing in Phase 1 calls this. Implement in the client, mark `UNVERIFIED`, expose no route and no UI. |
| GET / POST | `/devices/{id}/profiles` | list / create |
| PATCH / DELETE | `/devices/{id}/profiles/{pid}` | update / delete |
| POST | `/devices/{id}/profiles/{pid}/share` | returns `{ link }` |
| GET | `/shared/{bid}` | fetch a shared brew.link profile |
| GET / POST | `/devices/{id}/schedules` | list / create |
| PATCH / DELETE | `/devices/{id}/schedules/{sid}` | update (e.g. `{ enabled }`) / delete |

**Behavior:**

- **Retry GET and DELETE only** on 408 and 5xx: up to 3 attempts, exponential backoff with jitter. Never retry POST or PATCH on any status; a 503 after Fellow has already stored a profile would create a duplicate. This matches the reference, whose urllib3 retry policy excludes POST and PATCH by default.
- **Read cache.** Cache the results of the three list GETs (device, profiles, schedules) in module scope for 30 s. Invalidate all three on any successful mutation. Accept a `fresh` flag to bypass the cache for the UI's refresh button. This is an unofficial API on someone else's AWS account; the UI must not be able to hammer it.
- Brew links: extract the id from `https://brew.link/p/xxxx`, any URL ending in `/p/{id}` with or without a trailing slash, or a bare alphanumeric id. Reference regex: `(?:.*?/p/)?([a-zA-Z0-9]+)/?$`.
- Strip server-side fields before create/update and from fetched shared profiles: `id, createdAt, deletedAt, lastUsedTime, sharedFrom, isDefaultProfile, instantBrew, folder, duration, lastGBQuantity`.
- Profile-by-title lookup: an exact (case-insensitive) mode, and a fuzzy mode using the Ratcliff/Obershelp ratio (Python's `difflib.SequenceMatcher`, which is what the reference uses), strictly greater than 0.65, returning the **best** match rather than the first.
- `FELLOW_DRY_RUN=true`: all GET requests proceed normally; all POST/PATCH/DELETE are logged at info with method, path, and body, and return a plausible fake success response instead of being sent. Fake ids must match the real shapes (`p\d+` for profiles, `s\d+` for schedules, `https://brew.link/p/dryrun` for share links) so nothing downstream chokes. Surface a visible "DRY RUN" badge in the UI header when active.

**Zod schemas.** Two shapes per entity:

- **Input schemas** (`ProfileInput`, `ScheduleInput`) validate everything the browser sends. Strict: reject unknown keys. Mirror the Python Pydantic models' constraints exactly. (The Python models ignore unknown keys; rejecting them is a deliberate tightening for inbound data only.)
- **Response types** (`Profile`, `Schedule`, `Device`) describe what Fellow returns. Lenient: known fields typed, unknown keys passed through untouched. The API is undocumented and will grow fields; a new field must never break a read.

Implement the 0.5-step checks as explicit value sets, as the Python does, not floating-point `multipleOf`.

*ProfileInput*
- `profileType`: integer (range unknown; `0` in the reference example)
- `title`: string, 1–50 chars, matching `/^[A-Za-z0-9 !@#$%&*\-+?/.,:)(]+$/`
- `ratio`: 14–20 in 0.5 steps
- `bloomEnabled`: boolean
- `bloomRatio`: 1–3 in 0.5 steps
- `bloomDuration`: integer 1–120
- `bloomTemperature`: 50–99 in 0.5 steps
- `ssPulsesEnabled`: boolean
- `ssPulsesNumber`: integer 1–10
- `ssPulsesInterval`: integer 5–60
- `ssPulseTemperatures`: number[], each 50–99 in 0.5 steps
- `batchPulsesEnabled`: boolean
- `batchPulsesNumber`: integer 1–10
- `batchPulsesInterval`: integer 5–60
- `batchPulseTemperatures`: number[], each 50–99 in 0.5 steps
- Refine: `ssPulseTemperatures.length === ssPulsesNumber` and `batchPulseTemperatures.length === batchPulsesNumber`. The reference example satisfies this but nothing enforces it; mark `UNVERIFIED`.

*ScheduleInput*
- `days`: exactly 7 booleans, Sunday → Saturday
- `secondFromStartOfTheDay`: integer 0–86399, in the brewer's local time
- `enabled`: boolean
- `amountOfWater`: integer 150–1500
- `profileId`: string matching `/^(p|plocal)\d+$/`

### 3b. `server/api/` — Nuxt server routes

Thin wrappers over the client. Every route validates input with the input schemas, uses only POST/PATCH/DELETE for mutations, and returns typed responses. Read client IP from `X-Forwarded-For` / `X-Real-IP`, trusting only a loopback proxy — inert in Phase 1, load-bearing in Phase 2.

Two small routes outside the Fellow wrappers:

- `GET /api/health` → `{ ok: true }`. Unauthenticated, no Fellow probe, no secrets. For Phase 2 monitors and manual checks.
- `GET /api/status` → `{ authEnabled, dryRun, version }`. Requires a session. This is how the UI learns about dry-run and auth mode; no component reads env vars.

---

## 4. Database

SQLite via better-sqlite3. `DATABASE_PATH` is required; create its directory on startup. Schema:

```
users: id, email (unique), passwordHash (argon2id), role ('admin' | 'user'),
       disabled (bool), createdAt, lastLoginAt
```

One `CREATE TABLE IF NOT EXISTS` at startup. No migration tooling in Phase 1. The Fellow cloud remains the source of truth for profiles and schedules; do not mirror them locally.

---

## 5. Security and auth

### Startup guard (Nitro plugin, runs before listen)

Refuse to start, with a clear message at `error` level, when any of these hold:

- `HOST` is unset, or is not `127.0.0.1` / `::1` / `localhost`, while `AUTH_ENABLED=false`
- `HOST` is unset or non-loopback while `NUXT_SESSION_COOKIE_SECURE=false`
- `AUTH_ENABLED=true` and `NUXT_SESSION_PASSWORD` is shorter than 32 chars
- `FELLOW_EMAIL` or `FELLOW_PASSWORD` is missing

Auth may only be disabled, and cookies may only be insecure, on a loopback-only server. Document that this guard sees the bind address only, not proxies. If `AUTH_ENABLED=true` and the users table is empty, log a `warn` telling the user to run `pnpm user:add`.

### Auth toggle

- `AUTH_ENABLED` env var. **Default: true.** Set `AUTH_ENABLED=false` to skip login entirely.
- When disabled, the auth middleware ensures a real session cookie exists for the local user by calling `setUserSession` with `{ user: { id: 'local', email: 'local', role: 'admin' } }` whenever none is present. Everything downstream — `requireUserSession`, `useUserSession()`, route middleware — then behaves identically in both modes. No route or component checks `AUTH_ENABLED`; only this middleware and `/api/status` do.
- The login page redirects to `/` whenever a session exists (which, with auth disabled, is always). It does not check the toggle.
- The logout button is hidden when `/api/status` reports auth disabled, since logging out would only recreate the synthetic session.
- Log the auth mode prominently at startup.

### When auth is enabled

- Fellow credentials live only in env vars, read server-side.
- Users live in the SQLite table. No self-registration route exists. Provide `pnpm user:add <email>` which prompts for a password and inserts the row; the first user created is admin.
- Login verifies against the argon2id hash and sets a nuxt-auth-utils session (`NUXT_SESSION_PASSWORD` ≥ 32 chars). Session payload: `{ user: { id, email, role } }` — nuxt-auth-utils keys on `user`.
- Cookie: `httpOnly`, `sameSite: 'lax'`, and `secure` from `NUXT_SESSION_COOKIE_SECURE` (default true). Declare `session.cookie.secure` in `runtimeConfig` in `nuxt.config` so the env override applies. h3 defaults to secure, and browsers drop secure cookies on plain HTTP except on `localhost` / `127.0.0.1`; Phase 1 sets it false so every browser on localhost behaves.

### Middleware (`server/middleware/auth.ts`, the only place access is decided)

A single declarative rule table, evaluated top to bottom, first match wins:

| Route | Rule |
|---|---|
| `POST /api/auth/login` | public, rate-limited |
| `GET /api/health` | public |
| `/api/_auth/session` (any method) | public — nuxt-auth-utils's own session endpoint; blocking it means the client can never learn it is logged out |
| `DELETE /api/**` | admin |
| `/api/admin/**` | admin |
| `/api/**` | any valid session |

Never per-route checks — nothing can be forgotten. No session gets 401; `user` role on an admin rule gets 403.

### Request hardening (both auth modes; load-bearing in Phase 1)

With auth disabled, every tab in the user's browser is an admin, and any website they visit can send requests to `127.0.0.1:3000`. So:

- **Host allowlist.** Reject requests whose `Host` hostname (port ignored) is not in `ALLOWED_HOSTS` (comma-separated; default `localhost,127.0.0.1,[::1]`) with 400. This closes DNS rebinding, which Origin checks do not cover for GETs.
- **CSRF.** On every mutating route: pass if `Sec-Fetch-Site` is `same-origin`; otherwise pass if `Origin` is present and its hostname is in `ALLOWED_HOSTS`; otherwise 403.
- **Rate limit** `/api/auth/login`: 5 attempts per 15 minutes per IP. In-memory is acceptable (single persistent process); keep the limiter behind an interface so it could move to an external store.
- **Security headers** (CSP, `frame-ancestors 'none'`, etc.) via nuxt-security. Start from its defaults and fix CSP violations rather than disabling CSP.
- `.env.example` and `.gitignore` covering `.env`, `data/`, `logs/`. Never commit secrets. README tells the user to `chmod 600 .env`, because `FELLOW_PASSWORD` is their real Fellow account password.

---

## 6. Logging

- pino. `LOG_LEVEL` env var; default `info` in production, `debug` in dev.
- Dev: pino-pretty to stdout.
- Production: pino-roll at `./logs/aiden.log`, rotated daily, keep 14 files (`limit.count`), `mkdir: true`. pino-roll cannot compress; do not ask it to. Do not also write to stdout — launchd captures stdout to its own file and every line would land twice.
- Always print one plain line to stdout at startup: bind address, auth mode, dry-run state, log file path. That is all launchd's stdout file should ever contain, besides crash traces.
- Every request gets a `requestId` (h3 middleware) included in all log lines for that request.
- **info:** startup config summary (auth mode, bind address, dry-run, DB path — NEVER secret values); user login/logout; each mutating action with who did it and the target id; cache invalidations.
- **debug:** every outbound Fellow API call as method, path, status, duration ms, cache hit/miss.
- **trace:** request/response bodies. Off by default; bodies land on disk and in `/admin/logs`.
- **warn:** 401→relogin events, retries, rate-limit hits, validation failures, rejected Host/Origin.
- **error:** unhandled exceptions with stack; any Fellow response ≥400 after retries are exhausted; startup guard failures.
- **Redaction is mandatory** via pino's `redact` with wildcard paths: `*.password`, `*.accessToken`, `*.refreshToken`, `*.authorization`, `*.cookie`, `*["set-cookie"]`. Test that a logged login body comes out redacted.
- No per-request access log at info level. Errors and mutations are what matter.
- `/admin/logs` page (admin only): tail the last 200 lines of the current log file, filterable by level and requestId.

---

## 7. UI (Nuxt UI v4)

- Global route middleware: no session → redirect to `/login`. A 401 from any API call → clear state, redirect to `/login`.
- `/login` — password form; redirects to `/` when a session exists
- `/` — dashboard: brewer display name, device config as a **read-only** table, quick profile list, refresh button (sends `fresh`), DRY RUN badge from `/api/status`, and a persistent banner when the last Fellow call returned `fellow_auth_failed`
- `/profiles` — list, create, edit, delete, "import from brew.link", "generate share link". The editor uses sliders/steppers constrained to the exact legal values (0.5-step temps and ratios, integer ranges). Per-pulse temperature inputs expand and shrink to match the pulse count.
- `/schedules` — list, create, delete, enable/disable toggle; time picker converting to `secondFromStartOfTheDay`, labelled as brewer-local time; day-of-week chips; profile selector populated from live profiles
- `/admin/users` — admin only: list, reset password, disable account
- `/admin/logs` — admin only, as in §6
- Logout button (hidden when auth is disabled). Every Fellow error shows a toast with the server's error code, never a blank failure.

---

## 8. Tests

- Zod input schemas: boundary values (13.5, 14, 20, 20.5; 49.5, 50, 99, 99.5; title length 0/1/50/51; `days` length 6/7/8; `profileId` `p1`, `plocal3`, `x1`); unknown key rejected; pulse array length mismatch rejected. Response types: an extra unknown field on a Fellow profile passes through.
- Fellow client with msw: login; 401 → relogin → retry succeeds; 401 → relogin → 401 again → `fellow_auth_failed`; bad credentials on first login → `fellow_auth_failed` with no throw at import time; two concurrent 401s → exactly one login request; brew-link parsing for all accepted forms; server-field stripping; dry-run short-circuits mutations and returns well-shaped ids; GET retried on 503 with backoff; **POST on 503 makes exactly one request**; cache hit within TTL, miss after a mutation, bypass with `fresh`.
- Middleware: every non-public route → 401 without a session; the three public routes reachable without one; `DELETE` and `/api/admin/*` → 403 for `user` role; mutation with a foreign `Origin` → 403; request with an unlisted `Host` → 400. Run in both auth modes.
- Startup guard: refuses when `HOST` is unset; when it is non-loopback with `AUTH_ENABLED=false`; when it is non-loopback with `NUXT_SESSION_COOKIE_SECURE=false`; when the session password is short.
- Auth toggle: synthetic session present and admin when disabled; the client-side session composable sees it.
- Logging: password, tokens, and cookies are redacted in a captured log line.
- Rate limiter: 6th attempt within the window is rejected.
- Run the full suite in **both** auth modes (`pnpm test` runs both). Auth-enabled tests are not optional; the code path must stay healthy while unused.

---

## 9. Checkpoints

Build in this order. Each checkpoint ends with `pnpm test`, `pnpm lint`, and `pnpm typecheck` green. **Stop after each checkpoint, summarize what was built and what is `UNVERIFIED`, and wait for a go-ahead before starting the next.**

1. **Fellow client.** `server/utils/fellow/`, Zod schemas, config loader, msw tests. Nuxt scaffold only.
2. **Auth and hardening.** DB, `user:add`, sessions, middleware rule table, startup guard, Host/CSRF/rate-limit, logging with redaction. Both-mode test run works.
3. **UI.** All pages in §7 against the dry-run client.
4. **Deploy and docs.** launchd, README, `ARCHITECTURE.md`, `docs/PHASE-2.md`, `.env.example`.

---

## 10. Deliverables

- Working repo with:
  - `README.md` — setup (Node 22, pnpm 10, `pnpm install` needing no build-script approvals), env vars, "Run at home", security model, a "Hat tip" section crediting https://github.com/9b/fellow-aiden, license note
  - `ARCHITECTURE.md` — the two-layer split, how to extract the Fellow client to its own package, and the complete `UNVERIFIED` list
  - `docs/PHASE-2.md` — droplet migration stub as in §2
  - `deploy/local/` — see below
  - `.env.example` documenting every env var:
    `FELLOW_EMAIL`, `FELLOW_PASSWORD`, `FELLOW_DRY_RUN`, `AUTH_ENABLED`, `NUXT_SESSION_PASSWORD`, `NUXT_SESSION_COOKIE_SECURE`, `ALLOWED_HOSTS`, `DATABASE_PATH`, `LOG_LEVEL`, `HOST`, `PORT`
  - `.nvmrc` and `engines`
- `LICENSE` — MIT
- `CHANGELOG.md` — Keep a Changelog format. Bump the version in `package.json` and add an entry at the end of every checkpoint and every release.
- Passing test suite in both modes (`pnpm test`)
- Scripts: `dev`, `build`, `start`, `test`, `user:add`, `lint`, `typecheck`

### `deploy/local/`

The production build does not read `.env` — only `nuxt dev` does — and launchd starts processes with no shell, no `PATH`, and no working directory. So:

- `com.cschweda.aiden-studio.plist.template` — a LaunchAgent with `RunAtLoad`, `KeepAlive`, `WorkingDirectory` set to the repo, `ProgramArguments` of `<absolute node> --env-file=.env .output/server/index.mjs`, `EnvironmentVariables` containing only `NODE_ENV=production`, and `StandardOutPath` / `StandardErrorPath` pointing at `logs/launchd.log`. No secrets in the plist; they come from `.env` via `--env-file`.
- `install.sh` — substitutes the absolute repo path and `$(which node)` into the template, copies it to `~/Library/LaunchAgents/`, and runs `launchctl bootstrap gui/$(id -u) …`. `uninstall.sh` reverses it.
- README "Run at home": `pnpm build`, `pnpm user:add` (if auth is on), `deploy/local/install.sh`, then open `http://localhost:3000`. Mention `tail -f logs/aiden.log`.
