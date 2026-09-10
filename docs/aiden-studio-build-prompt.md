# aiden-studio — Build Prompt

You are building a personal web app called **aiden-studio** for controlling a Fellow Aiden coffee brewer. It will live at `github.com/cschweda/aiden-studio`. It is a single-user app running on the owner's Mac. The Fellow API is undocumented. Two reference implementations exist and were read, not copied: the Python library at https://github.com/9b/fellow-aiden (v1 API) and the client vendored in https://github.com/NewsGuyTor/FellowAiden-HomeAssistant (v2 API, actively maintained). Port their **behavior**, not their structure. Where they disagree, the Home Assistant client wins.

Before writing code, confirm your understanding of the security model and the checkpoint plan (§9), and list any assumptions in a short plan. Anything about the Fellow API that neither reference demonstrates is a guess: mark it `// UNVERIFIED` in code and list every such item in `ARCHITECTURE.md`.

> **Revision history.** v1 (2026-09-10 morning) had a users table, sessions, and a GPL license. Revised the same day after review: Netlify cut; MIT license; then, by owner decision, **no auth layer in Phase 1** and no database. Checkpoint 1 was built against this revision and also aligned the client with the v2 API.

---

## 1. Stack (non-negotiable)

- Node 22 LTS, pinned in `engines` and `.nvmrc`
- Nuxt 4, Nuxt UI v4, TypeScript, pnpm 10
- Zod 4 for all validation
- pino for logging, pino-roll for rotation
- nuxt-security for headers
- Vitest for tests; msw for mocking the Fellow API
- Nitro preset: `node-server`
- License: MIT. Both reference projects are GPL-3.0; credit them in a dedicated README section (see §10). This is an independent implementation that ports behavior, not code.

There is **no database, no session library, and no native module** in Phase 1. pnpm 10 skips dependency build scripts by default; the ones it skips are declared, with reasons, in `pnpm-workspace.yaml` (`ignoredBuiltDependencies`), so `pnpm install` never needs `pnpm approve-builds`.

All configuration is read once at startup into a Zod-validated config object (`server/utils/config.ts`). Nothing else reads `process.env`.

---

## 2. Phases

Build **Phase 1 only**. Leave clearly marked extension points and a `docs/PHASE-2.md` stub.

### Phase 1 — Local only (Mac, Apple Silicon)

- Accessed at `http://localhost:3000` only. Bind strictly to `127.0.0.1:3000`. No reverse proxy, no TLS, no Tailscale, no hosts-file aliases.
- **No login screen and no user accounts.** The only credential anywhere is the owner's Fellow login in `.env`. Whoever can reach the loopback port is the owner.
- `HOST` must be set explicitly. Nitro's node-server binds every interface when `HOST` is unset, so the startup guard (§5) treats unset as non-loopback and refuses to start.
- Expected `.env`: `FELLOW_DRY_RUN=true` until the UI is trusted.
- A launchd LaunchAgent (§10) runs the production build at login and restarts it on crash.

### Phase 2 — DigitalOcean droplet (do NOT build now)

`docs/PHASE-2.md` should list what changes, and nothing else:

- Same `node-server` build; Nginx reverse proxy via Laravel Forge; trust `X-Forwarded-For` from loopback only.
- **An auth layer must be added in code before anything leaves loopback.** Recommended design, simplest first: a single password gate whose secret is the Fellow account password already in `.env` (timing-safe comparison; nuxt-auth-utils sealed cookie; rate-limited login route; secure cookies over HTTPS). If invited users need their own identities, a small SQLite users table with argon2id hashes instead. Either way the startup guard changes from "loopback only" to "loopback only unless auth is enabled".
- `ALLOWED_HOSTS=<droplet hostname>`.
- Access choice: Tailscale-only (`tailscale serve`, or Nginx bound to the tailnet IP), or public HTTPS. **Auth is mandatory in both**: the startup guard sees only the bind address, not proxies, and both `tailscale serve` and Nginx connect from 127.0.0.1.
- Logs: pino-roll keeps rotating on disk; add logrotate or ship to Forge's log viewer if wanted.

Hosting and logging migrate by **host and env vars only**. Auth is the one deliberate exception and is Phase 2 development. No other deployment target is in scope.

---

## 3. Architecture

Two layers, strictly separated. The browser NEVER talks to Fellow directly and NEVER sees Fellow credentials.

### 3a. `server/lib/fellow/` — pure TypeScript Fellow client (built in checkpoint 1)

No Nuxt or browser dependencies, so it can be extracted to its own npm package later. Takes its config (email, password, timezone, dry-run flag, logger, clock, sleep, randomness) as constructor arguments and uses the global `fetch`.

**Authentication.** There is no API key or developer portal. The client logs in with the owner's Fellow app account credentials from `FELLOW_EMAIL` / `FELLOW_PASSWORD`:

- `POST /auth/login` with `{ email, password, timezone }` → `{ accessToken, refreshToken }`. `timezone` is an IANA zone (`FELLOW_TIMEZONE`, default: this machine's zone), as the mobile app sends.
- `POST /auth/refresh-token` with `{ refreshToken }` (unauthenticated) → `{ accessToken, refreshToken? }`.
- Send `Authorization: Bearer <accessToken>` on every other request.
- Log in lazily on the first Fellow call, never at startup. Cache the tokens in the client instance (one instance per process).
- On 401: refresh and retry once. If the refresh is declined, or the refreshed token is rejected, log in with the password and retry once more. A further 401 is `fellow_auth_failed`.
- **Single-flight.** Concurrent requests that hit 401 at the same time share one re-authentication. The dashboard fires several requests at once; one expiry must produce one refresh, not one per request.
- Login responses of 400/401/403 are bad credentials; 408/5xx are `fellow_http_error`, not credential failures.
- If Fellow rejects the credentials, the app must still start. The failure surfaces as HTTP 502 `{ error: 'fellow_auth_failed' }` from any Fellow-backed route and as a banner on the dashboard. Never a 500, never a crash loop under launchd.

**Base URL:** `https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v2`

**Required header on every request:** `User-Agent: Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0`

**Endpoints** (verified against the reference clients):

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | returns accessToken, refreshToken |
| POST | `/auth/refresh-token` | body `{ refreshToken }`; unauthenticated |
| GET | `/devices?dataType=real` | account-wide list; assume one brewer, take `[0]`. Carries inventory fields (serial, sku, firmware, MACs). |
| GET | `/devices/{id}?dataType=real` | lighter per-device detail with live state; omits inventory fields, which the client merges back in |
| PATCH | `/devices/{id}` | body `{ [setting]: value }`. No setting name is known. Implemented in the client, marked `UNVERIFIED`, no route, no UI. |
| PATCH | `/devices/{id}/start?confirm=true` | starts the brewer's configured Instant Brew. No body. Never retried. Response shape `UNVERIFIED`. |
| GET / POST | `/devices/{id}/profiles` | list / create |
| PATCH / DELETE | `/devices/{id}/profiles/{pid}` | update / delete. PATCH response shape `UNVERIFIED`. |
| POST | `/devices/{id}/profiles/{pid}/share` | returns `{ link }` |
| GET | `/shared/{dropType}/{bid}` | fetch a shared brew.link profile. `dropType` defaults to `aiden`. |
| GET / POST | `/devices/{id}/schedules` | list / create |
| PATCH / DELETE | `/devices/{id}/schedules/{sid}` | update (e.g. `{ enabled }`) / delete |

**Behavior:**

- **Retry GET and DELETE only** on 408 and 5xx: up to 3 attempts, exponential backoff with jitter. Never retry POST or PATCH on any status; a 503 after Fellow has already stored a profile would create a duplicate. This matches the v1 reference, whose urllib3 policy excludes POST and PATCH.
- **Read cache.** Cache the device, profiles, and schedules for 30 s. Collapse concurrent identical reads into one request. Invalidate all three on any successful mutation. Accept a `fresh` flag to bypass the cache for the UI's refresh button. This is an unofficial API on someone else's AWS account; the UI must not be able to hammer it.
- Brew links: accept `https://brew.link/p/<id>`, `https://brew.link/p/<id>/<dropType>`, any URL ending in those forms (trailing slash optional), or a bare alphanumeric id. Reject everything else, including `.../q/<id>`.
- Strip server-side fields before create/update and from fetched shared profiles: `id, createdAt, deletedAt, lastUsedTime, sharedFrom, isDefaultProfile, instantBrew, folder, duration, lastGBQuantity`.
- Profile-by-title lookup: an exact (case-insensitive) mode, and a fuzzy mode using the Ratcliff/Obershelp ratio (Python's `difflib.SequenceMatcher`, which both references use), strictly greater than 0.65, returning the **best** match rather than the first.
- Remote start readiness (`canStartBrew`), ported from the Home Assistant integration: firmware ≥ 1.5.16, connected, not brewing, lid closed, water present, not cleaning or rinsing, and either the single-serve basket present or the batch basket plus carafe present. Every unknown counts as "not ready".
- `FELLOW_DRY_RUN=true`: all GET requests proceed normally; all POST/PATCH/DELETE (including remote start) are logged at info with method, path, and body, and return a plausible fake success response instead of being sent. Fake ids match the real shapes (`p\d+` for profiles, `s\d+` for schedules, `https://brew.link/p/dryrun` for share links). Surface a visible "DRY RUN" badge in the UI header when active.

**Zod schemas.** Two shapes per entity:

- **Input schemas** (`ProfileInputSchema`, `ScheduleInputSchema`, `SchedulePatchSchema`) validate everything the browser sends. Strict: reject unknown keys. The reference models ignore unknown keys; rejecting them is a deliberate tightening for inbound data only.
- **Response schemas** (`DeviceSchema`, `ProfileSchema`, `ScheduleSchema`) describe what Fellow returns. Lenient: known fields typed, unknown keys passed through, and a known field with an unexpected type is dropped rather than failing the read. Only `id` is load-bearing.

0.5-step checks are explicit value sets, as in the references, not floating-point `multipleOf`.

*ProfileInput*
- `profileType`: integer (range unknown; both references use `0`)
- `title`: string, 1–50 chars, matching `/^[A-Za-z0-9 !@#$%&*\-+?/.,:)(]+$/`
- `ratio`: 14–20 in 0.5 steps
- `overallTemperature`: 50–99 in 0.5 steps (the brew temperature; present in the v2 model only)
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
- Refine: `ssPulseTemperatures.length === ssPulsesNumber` and `batchPulseTemperatures.length === batchPulsesNumber`. Both reference examples satisfy this; nothing enforces it. `UNVERIFIED`.

*ScheduleInput*
- `days`: exactly 7 booleans, Sunday → Saturday
- `secondFromStartOfTheDay`: integer 0–86399, in the brewer's local time
- `enabled`: boolean
- `amountOfWater`: integer 150–1500
- `profileId`: string matching `/^(p|plocal)\d+$/`

*Device* (all optional except `id`; read-only in Phase 1): `displayName`, `serialNumber`, `sku`, `firmwareVersion`, `wifiMacAddress`, `btMacAddress`, `isConnected`, `brewing`, `rinsing`, `cleaning`, `lidClosed`, `carafePresent`, `missingWater`, `singleBrewBasketPresent`, `batchBrewBasketPresent`, `ibSelectedProfileId` (the Instant Brew profile), `brewingProfileId`, `brewStartTime`, `totalBrewingCycles`, `totalWaterVolumeL`, `state` (live brew state object while brewing; shape unknown). Remote profile selection is not possible: the mobile client has a route for it, but Fellow's gateway rejects it.

### 3b. `server/api/` — Nuxt server routes (checkpoint 2)

Thin wrappers over the single `useFellowClient()` instance. Every route validates input with the input schemas, uses only POST/PATCH/DELETE for mutations, and returns typed responses. Read client IP from `X-Forwarded-For` / `X-Real-IP`, trusting only a loopback proxy — inert in Phase 1, load-bearing in Phase 2.

| Route | Purpose |
|---|---|
| `GET /api/health` | `{ ok: true }`. No Fellow call, no secrets. (built) |
| `GET /api/status` | `{ dryRun, version, fellow: 'ok' \| 'auth_failed' \| 'unknown' }` from the last Fellow outcome. How the UI learns about dry-run; no component reads env vars. |
| `GET /api/device?fresh=1` | device config plus `canStartBrew` |
| `GET /api/profiles?fresh=1`, `POST /api/profiles` | list / create |
| `PATCH /api/profiles/:id`, `DELETE /api/profiles/:id` | update / delete |
| `POST /api/profiles/:id/share` | `{ link }` |
| `POST /api/profiles/import` | body `{ link }`; fetch the shared profile and create it |
| `GET /api/schedules?fresh=1`, `POST /api/schedules` | list / create |
| `PATCH /api/schedules/:id`, `DELETE /api/schedules/:id` | update (enable/disable) / delete |
| `POST /api/brew/start` | refuses with 409 unless `canStartBrew` on a fresh device read; then starts |

Error mapping, in one shared handler: Zod failures → 400 with the issue list; `FellowError` → 502 with `{ error: <code> }` (never the Fellow response body); anything else → 500 with a generic message and a logged stack.

---

## 4. Persistence

None in Phase 1. The Fellow cloud is the source of truth for profiles, schedules, and device state. Do not mirror them locally.

---

## 5. Security (no auth, so this is all of it)

### Startup guard (Nitro plugin, runs before listen)

Refuse to start, with a clear message at `error` level, when:

- `HOST` is unset, or is not `127.0.0.1` / `::1` / `localhost`
- `FELLOW_EMAIL` or `FELLOW_PASSWORD` is missing

Document that this guard sees the bind address only, not proxies.

### Request hardening (load-bearing: every tab in the owner's browser is the owner)

Any website the owner visits can send requests to `127.0.0.1:3000`. So:

- **Host allowlist.** Reject requests whose `Host` hostname (port ignored) is not in `ALLOWED_HOSTS` (comma-separated; default `localhost,127.0.0.1,[::1]`) with 400. This closes DNS rebinding, which Origin checks do not cover for GETs.
- **CSRF.** On every mutating route: pass if `Sec-Fetch-Site` is `same-origin`; otherwise pass if `Origin` is present and its hostname is in `ALLOWED_HOSTS`; otherwise 403.
- **Security headers** (CSP, `frame-ancestors 'none'`, etc.) via nuxt-security. Start from its defaults and fix CSP violations rather than disabling CSP.
- `.env.example` and `.gitignore` covering `.env`, `data/`, `logs/`. Never commit secrets. README tells the owner to `chmod 600 .env`, because `FELLOW_PASSWORD` is their real Fellow account password.

---

## 6. Logging

- pino. `LOG_LEVEL` env var; default `info` in production, `debug` in dev.
- Dev: pino-pretty to stdout (as an in-process stream, not a worker transport, so it survives Nitro bundling).
- Production: pino-roll at `./logs/aiden.log`, rotated daily, keep 14 files (`limit.count`), `mkdir: true`. pino-roll cannot compress; do not ask it to. Do not also write to stdout — launchd captures stdout to its own file and every line would land twice.
- Always print one plain line to stdout at startup: bind address, dry-run state, log file path. That is all launchd's stdout file should ever contain, besides crash traces.
- Every request gets a `requestId` (h3 middleware) included in all log lines for that request.
- **info:** startup config summary (bind address, dry-run, timezone — NEVER secret values); each mutating action with the target id; cache invalidations; Fellow authentication and refresh events.
- **debug:** every outbound Fellow API call as method, path, status, duration ms, cache hit/miss.
- **trace:** request/response bodies. Off by default; bodies land on disk and in `/logs`.
- **warn:** 401→re-auth events, retries, rejected Host/Origin, validation failures, remote-start refused.
- **error:** unhandled exceptions with stack; any Fellow response ≥400 after retries are exhausted; startup guard failures.
- **Redaction is mandatory** via pino's `redact` with wildcard paths: `*.password`, `*.accessToken`, `*.refreshToken`, `*.authorization`, `*.cookie`. Test that a logged login body comes out redacted.
- No per-request access log at info level. Errors and mutations are what matter.
- `/logs` page: tail the last 200 lines of the current log file, filterable by level and requestId.

---

## 7. UI (Nuxt UI v4)

**Look.** Dark mode by default (Nuxt UI color mode preference `dark`, with the toggle still available). Sleek and modern: generous spacing, a restrained palette with one accent, monospace for ids and timestamps, no decorative clutter. Every state the brewer reports is visible, and every variable the API lets us set is editable.

- `/` — dashboard:
  - Brewer card: display name, connected, lid, carafe, water, which basket is present, brewing/rinsing/cleaning, firmware, serial, total brews and litres.
  - **Instant Brew** button: enabled only when `canStartBrew` is true; shows why not otherwise (lid open, no water, …); asks for confirmation; calls `POST /api/brew/start`.
  - Instant Brew profile (from `ibSelectedProfileId`), quick profile list, refresh button (`fresh`), DRY RUN badge from `/api/status`, and a persistent banner when the last Fellow call returned `fellow_auth_failed`.
- `/profiles` — list, create, edit, delete, "import from brew.link", "generate share link". The editor exposes **every** profile variable: title, ratio, overall temperature, bloom (enabled, ratio, duration, temperature), single-serve pulses (enabled, count, interval, one temperature per pulse), batch pulses (same). Sliders/steppers constrained to the exact legal values (0.5-step temps and ratios, integer ranges). Per-pulse temperature inputs expand and shrink to match the pulse count.
- `/schedules` — list, create, delete, enable/disable toggle; time picker converting to `secondFromStartOfTheDay`, labelled as brewer-local time; day-of-week chips; water amount; profile selector populated from live profiles.
- `/logs` — as in §6.
- Every Fellow error shows a toast with the server's error code, never a blank failure.

---

## 8. Tests

- Zod input schemas: boundary values (13.5, 14, 20, 20.5; 49.5, 50, 99, 99.5 for every temperature including `overallTemperature`; title length 0/1/50/51; `days` length 6/7/8; `profileId` `p1`, `plocal3`, `x1`); unknown key rejected; pulse array length mismatch rejected. Response schemas: an unknown field passes through; a known field with the wrong type is dropped. (built)
- Fellow client with msw: lazy login with timezone; 400/401/403 vs 5xx on login; 401 → refresh → retry; refresh declined → password login; refreshed token rejected → password login; both rejected → `fellow_auth_failed`; no refresh token issued → straight to password login; concurrent 401s → one re-authentication; brew-link parsing including drop types; server-field stripping; dry-run short-circuits every mutation including remote start; GET retried on 503 with backoff; **POST on 503 makes exactly one request**; DELETE retried; network errors retried for GET only; cache hit within TTL, miss after a mutation, bypass with `fresh`; device detail route after discovery with inventory merge; remote start sends `confirm=true` and no body; `canStartBrew` truth table. (built)
- Routes: validation → 400 with issues; `FellowError` → 502 with code only; unknown → 500; mutation with a foreign `Origin` → 403; request with an unlisted `Host` → 400; `/api/brew/start` → 409 when not ready.
- Startup guard: refuses when `HOST` is unset or non-loopback, or credentials are missing.
- Logging: password and tokens are redacted in a captured log line.

---

## 9. Checkpoints

Build in this order. Each checkpoint ends with `pnpm test`, `pnpm lint`, and `pnpm typecheck` green. **Stop after each checkpoint, summarize what was built and what is `UNVERIFIED`, and wait for a go-ahead before starting the next.**

1. **Fellow client.** ✅ Done 2026-09-10, tagged `v0.1.0`: `server/lib/fellow/`, Zod schemas, config loader, msw tests, health route, README, ARCHITECTURE, LICENSE, CHANGELOG.
2. **Server routes and hardening.** §3b routes with the shared error handler, startup guard, Host/CSRF middleware, nuxt-security, full §6 logging with redaction and rotation, route tests.
3. **UI.** All pages in §7 against the dry-run client.
4. **Deploy and docs.** launchd, README "Run at home", `docs/PHASE-2.md`, final `ARCHITECTURE.md` and `CHANGELOG.md` entry.

---

## 10. Deliverables

- Working repo with:
  - `README.md` — setup (Node 22, pnpm 10, no build-script approvals), env vars, "Run at home", security model, a "Hat tip" section crediting https://github.com/9b/fellow-aiden and https://github.com/NewsGuyTor/FellowAiden-HomeAssistant, license note
  - `ARCHITECTURE.md` — the two-layer split, how to extract the Fellow client to its own package, and the complete `UNVERIFIED` list
  - `docs/PHASE-2.md` — droplet migration stub as in §2
  - `deploy/local/` — see below
  - `.env.example` documenting every env var:
    `FELLOW_EMAIL`, `FELLOW_PASSWORD`, `FELLOW_DRY_RUN`, `FELLOW_TIMEZONE`, `ALLOWED_HOSTS`, `LOG_LEVEL`, `HOST`, `PORT`
  - `.nvmrc` and `engines`
- `LICENSE` — MIT
- `CHANGELOG.md` — Keep a Changelog format. Bump the version in `package.json` and add an entry at the end of every checkpoint and every release.
- Passing test suite (`pnpm test`)
- Scripts: `dev`, `build`, `start`, `test`, `lint`, `typecheck`

### `deploy/local/`

The production build does not read `.env` — only `nuxt dev` does — and launchd starts processes with no shell, no `PATH`, and no working directory. So:

- `com.cschweda.aiden-studio.plist.template` — a LaunchAgent with `RunAtLoad`, `KeepAlive`, `WorkingDirectory` set to the repo, `ProgramArguments` of `<absolute node> --env-file=.env .output/server/index.mjs`, `EnvironmentVariables` containing only `NODE_ENV=production`, and `StandardOutPath` / `StandardErrorPath` pointing at `logs/launchd.log`. No secrets in the plist; they come from `.env` via `--env-file`.
- `install.sh` — substitutes the absolute repo path and `$(which node)` into the template, copies it to `~/Library/LaunchAgents/`, and runs `launchctl bootstrap gui/$(id -u) …`. `uninstall.sh` reverses it.
- README "Run at home": `pnpm build`, `deploy/local/install.sh`, then open `http://localhost:3000`. Mention `tail -f logs/aiden.log`.
