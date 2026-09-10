# Changelog

All notable changes to aiden-studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). The version in `package.json` is
bumped and an entry is added here at the end of every checkpoint and every release.

## [Unreleased]

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
