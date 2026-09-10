# aiden-studio — Build Prompt

You are building a personal web app called **aiden-studio** for controlling a Fellow Aiden coffee brewer. It will live at `github.com/cschweda/aiden-studio`. It is a single-user app that may later grow to a handful of invited users. The Fellow API is undocumented; the reference implementation is the Python library at https://github.com/9b/fellow-aiden — port its **behavior**, not its structure.

Before writing code, confirm your understanding of the security model and phase plan, and list any assumptions in a short plan. If anything in the Fellow API shape is ambiguous, define TypeScript types from the Python code's usage and flag them as unverified.

---

## 1. Stack (non-negotiable)

- Nuxt 4, Nuxt UI v4, TypeScript, pnpm
- Zod for all validation
- nuxt-auth-utils for sessions (sealed httpOnly cookies)
- better-sqlite3 for the local database
- pino for logging
- Vitest for tests; msw for mocking the Fellow API
- Nitro preset: `node-server`
- License: GPL-3.0 (the reference library is GPL; note this in the README)

---

## 2. Phases

Build **Phase 1 only**. Leave clearly marked extension points and a `docs/PHASE-2.md` stub for the rest.

### Phase 1 — Local only (Mac mini, Apple Silicon)

- Bind strictly to `127.0.0.1:3000`. Reachable only from this machine. No reverse proxy, no TLS, no Tailscale.
- `AUTH_ENABLED=false` is the expected local configuration (see §5).
- SQLite at `./data/aiden.db` (path from `DATABASE_PATH`).
- `FELLOW_DRY_RUN=true` for safe UI testing (see §3).
- Provide a launchd plist at `deploy/local/com.cschweda.aiden-studio.plist` that runs the production build at login, restarts on crash, and logs to `./logs/`.
- README "Run at home" section: build, install plist, optional `/etc/hosts` entry for `aiden.local`.

### Phase 2 — DigitalOcean droplet (do NOT build now)

`docs/PHASE-2.md` should list what changes:

- Same `node-server` build; Nginx reverse proxy via Laravel Forge; trust `X-Forwarded-For` from loopback only.
- `AUTH_ENABLED=true`; create users with `pnpm user:add`.
- Copy the SQLite file to the droplet — it's just a file, no migration tooling.
- Access choice: Tailscale-only (`tailscale serve` or Nginx bound to the tailnet IP), or public HTTPS behind the existing rate limiter and password auth.
- Optional Netlify build as a third fallback, documented but untested. On Netlify there is no persistent disk: multi-user is unavailable and auth falls back to a single `ADMIN_PASSWORD_HASH` env var with a startup warning.

Migration between phases must be a change of **host and env vars**, never a change of code.

---

## 3. Architecture

Two layers, strictly separated. The browser NEVER talks to Fellow directly and NEVER sees Fellow credentials.

### 3a. `server/utils/fellow/` — pure TypeScript Fellow client

No Nuxt or browser dependencies, so it can be extracted to its own npm package later.

**Authentication.** There is no API key or developer portal. The client logs in with the user's Fellow app account credentials from `FELLOW_EMAIL` / `FELLOW_PASSWORD`:

- `POST /auth/login` with `{ email, password }` → `{ accessToken, refreshToken }`
- Send `Authorization: Bearer <accessToken>` on every subsequent request.
- Cache the access token in module scope. On 401: try the refresh token first, fall back to email/password login, then retry the original request once. (The Python library never used the refresh token — do better.)

**Base URL:** `https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1`

**Required header on every request:** `User-Agent: Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0`

**Endpoints:**

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | returns accessToken, refreshToken |
| GET | `/devices?dataType=real` | assume one brewer, take `[0]` |
| PATCH | `/devices/{id}` | adjust a device setting |
| GET / POST | `/devices/{id}/profiles` | list / create |
| PATCH / DELETE | `/devices/{id}/profiles/{pid}` | update / delete |
| POST | `/devices/{id}/profiles/{pid}/share` | returns `{ link }` |
| GET | `/shared/{bid}` | fetch a shared brew.link profile |
| GET / POST | `/devices/{id}/schedules` | list / create |
| PATCH / DELETE | `/devices/{id}/schedules/{sid}` | update (e.g. `{ enabled }`) / delete |

**Behavior:**

- Retry 408 and 5xx up to 3 times with exponential backoff.
- Brew links: extract the id from `https://brew.link/p/xxxx`, any URL ending in `/p/{id}`, or a bare id.
- Strip server-side fields before create/update and from fetched shared profiles: `id, createdAt, deletedAt, lastUsedTime, sharedFrom, isDefaultProfile, instantBrew, folder, duration, lastGBQuantity`.
- Fuzzy profile-by-title lookup: Dice coefficient, threshold 0.65, plus an exact (case-insensitive) match mode.
- `FELLOW_DRY_RUN=true`: all GET requests proceed normally; all POST/PATCH/DELETE are logged at info with method, path, and body, and return a plausible fake success response instead of being sent. Surface a visible "DRY RUN" badge in the UI header when active.

**Zod schemas** (mirror the Python Pydantic models exactly; reject unknown keys):

*Profile*
- `profileType`: integer
- `title`: string, ≤50 chars, matching `/^[A-Za-z0-9 !@#$%&*\-+?/.,:)(]+$/`
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

*Schedule*
- `days`: exactly 7 booleans, Sunday → Saturday
- `secondFromStartOfTheDay`: integer 0–86399
- `enabled`: boolean
- `amountOfWater`: integer 150–1500
- `profileId`: string matching `/^(p|plocal)\d+$/`

### 3b. `server/api/` — Nuxt server routes

Thin wrappers over the client. Every route validates input with the Zod schemas, uses only POST/PATCH/DELETE for mutations, and returns typed responses. Read client IP from `X-Forwarded-For` / `X-Real-IP`, trusting only a loopback proxy — inert in Phase 1, load-bearing in Phase 2.

---

## 4. Database

SQLite via better-sqlite3. Schema:

```
users: id, email (unique), passwordHash (argon2), role ('admin' | 'user'),
       disabled (bool), createdAt, lastLoginAt
```

The Fellow cloud remains the source of truth for profiles and schedules; do not mirror them locally in Phase 1. Guard the DB module so the build still succeeds when `DATABASE_PATH` is unset (Netlify fallback).

---

## 5. Security and auth

### Auth toggle

- `AUTH_ENABLED` env var. **Default: true.** Set `AUTH_ENABLED=false` to skip login entirely.
- Startup guard in a Nitro plugin: if `AUTH_ENABLED=false` and the server is bound to anything other than `127.0.0.1` / `::1`, log a clear error and `exit(1)`. Auth may only be disabled on a loopback-only server.
- When disabled, the auth middleware attaches a synthetic session `{ userId: 'local', role: 'admin' }` so every downstream route and component behaves identically. No route or component checks `AUTH_ENABLED` directly — only the middleware does. The login page redirects to `/` when auth is disabled.
- Log the auth mode prominently at startup.

### When auth is enabled

- Fellow credentials live only in env vars, read server-side.
- Users live in the SQLite table. No self-registration route exists. Provide `pnpm user:add <email>` which prompts for a password and inserts the row; the first user created is admin.
- Login compares against the argon2 hash with timing-safe verification and sets a nuxt-auth-utils session (`NUXT_SESSION_PASSWORD` ≥32 chars). Session payload: `{ userId, role }`.
- A single `server/middleware/auth.ts` requires a valid session on every route under `server/api/` except `/api/auth/login`. Never per-route checks — nothing can be forgotten.
- `admin` role guards user management and destructive routes (delete profile/schedule).
- Rate-limit `/api/auth/login`: 5 attempts per 15 minutes per IP. In-memory is acceptable (single persistent process); keep the limiter behind an interface so it could move to an external store.
- CSRF: check `Origin` / `Sec-Fetch-Site` on all mutating routes.
- Security headers (CSP, `frame-ancestors 'none'`, etc.) via nuxt-security or `routeRules`.
- `.env.example` and `.gitignore` covering `.env`, `data/`, `logs/`. Never commit secrets.

---

## 6. Logging

- pino. `LOG_LEVEL` env var; default `info` in production, `debug` in dev.
- pino-pretty in dev; JSON lines in production.
- Production outputs: stdout plus a rotating file via pino-roll at `./logs/aiden.log` — rotate daily, keep 14 files, gzip old ones.
- Every request gets a `requestId` (h3 middleware) included in all log lines for that request.
- **info:** startup config summary (auth mode, bind address, dry-run, DB path — NEVER secret values); user login/logout; each mutating action with who did it and the target id.
- **debug:** every outbound Fellow API call as method, path, status, duration ms.
- **trace:** request/response bodies.
- **warn:** 401→relogin events, retries, rate-limit hits, validation failures.
- **error:** unhandled exceptions with stack; any Fellow response ≥400 after retries are exhausted.
- **Redaction is mandatory** via pino's `redact`: `password`, `accessToken`, `refreshToken`, `authorization` headers, `Set-Cookie`.
- No per-request access log at info level. Errors and mutations are what matter.
- `/admin/logs` page (admin only): tail the last 200 lines of the current log file, filterable by level and requestId.

---

## 7. UI (Nuxt UI v4)

- `/login` — password form (redirects to `/` when auth is disabled)
- `/` — dashboard: brewer display name, current device settings, quick profile list, DRY RUN badge when active
- `/profiles` — list, create, edit, delete, "import from brew.link", "generate share link". The editor uses sliders/steppers constrained to the exact legal values (0.5-step temps and ratios, integer ranges). Per-pulse temperature inputs expand to match the pulse count.
- `/schedules` — list, create, delete, enable/disable toggle; time picker converting to `secondFromStartOfTheDay`; day-of-week chips; profile selector populated from live profiles
- `/admin/users` — admin only: list, reset password, disable account
- `/admin/logs` — admin only, as in §6
- Logout button; session expiry handled gracefully with a redirect to `/login`

---

## 8. Tests

- Zod schemas: boundary values (13.5, 14, 20, 20.5; 49.5, 50, 99, 99.5; title length 50/51; `days` length 6/7/8; `profileId` `p1`, `plocal3`, `x1`).
- Fellow client with msw: login; 401 → refresh → retry; 401 → refresh fails → password login → retry; brew-link parsing for all accepted forms; server-field stripping; dry-run short-circuits mutations; retry/backoff on 503.
- Auth middleware: unauthenticated request → 401 on every non-login route; admin routes → 403 for `user` role.
- Auth toggle: synthetic session present when disabled; startup guard exits when disabled on a non-loopback bind.
- Run the full suite in **both** auth modes. Auth-enabled tests are not optional; the code path must stay healthy while unused.
- Rate limiter: 6th attempt within the window is rejected.

---

## 9. Deliverables

- Working repo with:
  - `README.md` — setup, env vars, "Run at home", security model, license note
  - `ARCHITECTURE.md` — the two-layer split and how to extract the Fellow client to its own package
  - `docs/PHASE-2.md` — droplet migration stub as in §2
  - `deploy/local/` — launchd plist and install instructions
  - `.env.example` documenting every env var:
    `FELLOW_EMAIL`, `FELLOW_PASSWORD`, `FELLOW_DRY_RUN`, `AUTH_ENABLED`, `NUXT_SESSION_PASSWORD`, `DATABASE_PATH`, `LOG_LEVEL`, `HOST`, `PORT`, `ADMIN_PASSWORD_HASH` (Netlify fallback only)
- `LICENSE` — GPL-3.0
- Passing test suite (`pnpm test`)
- Scripts: `dev`, `build`, `start`, `test`, `user:add`, `lint`, `typecheck`
