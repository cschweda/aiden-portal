# Changelog

All notable changes to aiden-studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). The version in `package.json` is
bumped and an entry is added here at the end of every checkpoint and every release.

## [Unreleased]

### Removed

- `docs/aiden-studio-build-prompt.v1.md`, the original build prompt kept alongside the rewritten spec. The
  current spec is `docs/aiden-studio-build-prompt.md`.

## [0.4.0] - 2026-09-10

Checkpoint 4 of 4: running at home. Phase 1 is complete.

### Added

- A launchd LaunchAgent (`deploy/local/`): template, `install.sh` (checks the build, `.env`, node
  version and permissions; copies the build and `.env` to `~/Library/Application Support/aiden-studio`;
  renders and loads the plist; waits for health), `status.sh`, `logs.sh`, and `uninstall.sh` (with
  `--purge`). Starts at login, restarts after any non-zero exit, throttled to 30 seconds.
- README "Run at home": install, update, stop, and troubleshoot.
- `docs/PHASE-2.md`: what changes for a DigitalOcean droplet, starting with the auth layer that must exist
  before anything leaves loopback.
- ARCHITECTURE "Deployment" section.

### Changed

- The service runs from an installed copy on the internal disk, not from the checkout: macOS does not let
  an unattended process read a removable volume, and a rebuild must not touch a running service. launchd's
  own stdout goes to `~/Library/Logs/aiden-studio/`.

## [0.3.1] - 2026-09-10

Fixes from the checkpoint 3 review.

### Fixed

- A failed refresh blanked the dashboard and a read failure showed "No profiles yet" on the list pages;
  reads now keep the last good data, mark it stale, and show the server's reason.
- The same-site rule is strict again (no navigation exemption) and refuses speculative loads; the app's
  own API reads are client-only, which is what the exemption had been papering over.
- `/api/logs` reports logs as unavailable outside production without reading the disk, so a production
  run from the repo root no longer feeds a dev session or breaks a test.
- Remote-start refusals show the brewer's blockers in the toast and the dashboard re-reads afterwards.
- The Fellow client never follows redirects; a plain-http `FELLOW_BASE_URL` is announced at startup.
- Basket state reads "unknown" rather than "missing" when the brewer reports neither flag; the Bluetooth
  address is shown; the log viewer debounces the request-id filter and keys rows by position.

## [0.3.0] - 2026-09-10

Checkpoint 3 of 4: the app.

### Added

- Dark-by-default Nuxt UI front end: dashboard with the brewer's state, readiness reasons, counters, and a
  gated, confirmed Instant Brew button; profiles with a full editor (every variable in its exact steps,
  per-pulse temperatures that follow the pulse count), import from brew.link, share links, and delete;
  schedules with a brewer-local time picker, day chips, and pause/resume; a log viewer with level and
  request-id filters and expandable records.
- `GET /api/logs` and a log-tail reader.
- `scripts/mock-fellow.mjs`, an in-memory Fellow API for development and demos, and the `FELLOW_BASE_URL`
  override (https, or plain http on loopback).
- Pure, unit-tested UI logic in `app/utils/` and shared API types in `shared/types/api.ts`.

### Fixed

- The same-site rule refused cross-site top-level navigations, which broke the server render for visitors
  arriving via a link; it now targets subresource requests only.

## [0.2.1] - 2026-09-10

The first red-team / blue-team pass, and a single configuration file.

### Added

- `aiden.config.ts` at the repo root: the single source of truth for every non-secret setting (bind
  address, dry run, Fellow API URL and tuning, cache, logging, UI defaults), validated at import.
- `.env.sample`, fully commented, with the two required secrets and six optional overrides.
- `scripts/smoke.sh`: probes a production build for the guard, headers, Host and same-site rules,
  error shapes, and the log file.
- A "Red team / blue team log" section in the README, newest entry first.

### Fixed

- `NITRO_HOST` could bypass the loopback guard; the config now mirrors Nitro's precedence and the
  startup plugin pins the bind address to the validated value.
- Cross-site pages could make the server call Fellow through GET requests; any `/api` request a
  browser labels cross-site or same-site is now refused.
- Malformed JSON and `__proto__` bodies escaped the shared error envelope; unknown `/api` paths and
  wrong methods answered the HTML app shell; PATCH bodies had no size cap; a missing Host header
  passed the allowlist; API responses lacked `Cache-Control: no-store`.
- A remote-start readiness check on a cold client used list data instead of live state.
- The log directory is created owner-only, the log file also rotates by size, and startup warns
  when `.env` is readable by other accounts.
- esbuild overridden to the patched line for GHSA-g7r4-m6w7-qqqr; `pnpm audit` is clean.

### Changed

- nuxt-security's XSS validator is off (Zod validates every field); `X-Frame-Options` is `DENY`.
- `.env.example` is replaced by `.env.sample`.

## [0.2.0] - 2026-09-10

Checkpoint 2 of 4: server routes, request hardening, and logging. Still no UI.

### Added

- API routes over the Fellow client: `/api/status`, `/api/device`, `/api/profiles` (list,
  create, update, delete, share, import from brew.link), `/api/schedules` (list, create,
  update, delete), and `/api/brew/start`, which refuses with the list of blockers unless a
  fresh device read says the brewer is ready.
- One shared error mapping: validation failures answer 400 with the issue list, Fellow
  failures answer 502 with the error code only, anything else answers a generic 500.
- Request pipeline: a request id on every response and log line, a Host allowlist (400),
  and a CSRF check on every mutation (403) that accepts `Sec-Fetch-Site: same-origin` or an
  `Origin` naming an allowed host.
- Startup guard: the server refuses to start when `HOST` is unset or not loopback, or when
  the Fellow credentials are missing, and probes Fellow once without blocking.
- Production logging to `logs/aiden.<date>.<n>.log` via pino-roll, rotated daily, 14 files
  kept, with `logs/current.log` pointing at the active file; secrets redacted.
- Security headers via nuxt-security; its rate limiter and CORS handler are off.

### Changed

- Route files import from `h3` directly so the same handlers run in-process under Vitest.
- New dependencies: `h3`, `pino-roll`, `nuxt-security`.

## [0.1.1] - 2026-09-10

Fixes from the checkpoint 1 code review.

### Fixed

- Auth: a request whose refreshed token was rejected after another request had already
  logged in again no longer fails with `fellow_auth_failed`; the fallback decision now
  follows the token that request used, and a newer token is tried before giving up.
- Auth: a password login only ever joins an in-flight password login, never an in-flight
  refresh; the login call itself is retried on 408/5xx and network errors.
- Cache: a read still in flight when a mutation lands is returned but no longer written
  back into the cache as if it were current.
- Device: the per-device detail route may omit the id; mistyped duplicate fields no longer
  clobber inventory; a 404 triggers rediscovery.
- Profile and schedule ids are validated before being placed in a Fellow URL.
- Malformed list responses from Fellow raise `fellow_bad_response` instead of a raw
  validation error.
- Pasted brew.link URLs may carry a query string or fragment.
- `[::1]` counts as loopback; the logger redacts passwords, tokens, and cookies.

### Changed

- The Fellow client lives in `server/lib/fellow/` so Nitro does not auto-import its
  internals into every server route.

## [0.1.0] - 2026-09-10

Checkpoint 1 of 4: the Fellow client, configuration, and validation. No UI yet.

### Added

- Nuxt 4 project scaffold with lint, typecheck, Vitest, and msw tooling.
- Pure TypeScript Fellow client against the v2 cloud API: lazy single-flight
  login, refresh-token renewal with password fallback on 401, retries for GET
  and DELETE only, a 30-second read cache with in-flight de-duplication, and a
  dry-run mode that logs mutations instead of sending them.
- Zod schemas for brew profiles (including `overallTemperature`) and schedules,
  mirroring the reference validation rules, with lenient response types.
- brew.link import with drop types, share-link generation, exact or fuzzy
  profile lookup by title, remote Instant Brew start, and the readiness checks
  that gate it.
- Environment config loader validated once at startup.
- `GET /api/health`.
