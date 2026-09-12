# Architecture

## Two layers

1. **`server/lib/fellow/` — the Fellow client.** Pure TypeScript with zero Nuxt or browser imports.
   It uses the global `fetch` and takes its logger, clock, sleep, and randomness as constructor options
   so it is deterministic under test. `FellowHttp` owns authentication, retries, and JSON;
   `FellowClient` owns the typed API, the read cache, and dry-run behavior; `device.ts` holds the pure
   readiness rules for remote start.
2. **`server/api/` — Nuxt server routes.** Thin wrappers that validate input with the same Zod schemas
   and call the single `useFellowClient()` instance. The browser only ever talks to these routes.

Configuration has two inputs and one output. `aiden.config.ts` at the repo root holds every non-secret setting
and is validated at import by `server/utils/aiden-config.ts`; `.env` holds the two Fellow secrets and may
override a few keys for one run. `server/utils/config.ts` merges them once into `AppConfig` and is the only
place `process.env` is read. The bind address in that object follows Nitro's own precedence (`NITRO_HOST`,
`HOST`, then the file), and the startup plugin writes it back to `NITRO_HOST`/`NITRO_PORT`, so the guard, the
startup line, and the socket always agree.

## Authentication against Fellow

Login is lazy and single-flight. On a 401 the client refreshes the access token with the refresh token and
retries; if the refresh is declined, or the refreshed token is rejected again, it logs in with the password
and retries once more. Concurrent requests that hit 401 together share one re-authentication.

## Reads and writes

Device, profile, and schedule reads are cached for 30 seconds and de-duplicated while in flight. Any
mutation clears the cache. Only GET and DELETE are retried (408 and 5xx, three attempts, jittered backoff);
a retried POST could create a duplicate profile after a 503 Fellow had in fact processed.

## The UI layer

`app/` is a Nuxt UI dashboard shell (sidebar plus one panel per page). Pages are thin: they read through
`useApiFetch()` (client-only, keeps the last good data across a failed refresh and across navigations, and
exposes a `failure` the page renders with `ApiErrorAlert`) and mutate through `useApi()`, which turns the
server's error envelope into a toast and rethrows.
Everything that can be pure lives in `app/utils/` with explicit imports so it runs under plain Vitest:
profile defaults and limits, the rule that per-pulse temperatures follow the pulse count, time and day
conversions for schedules, error description, and formatting. The Zod input schemas from
`server/lib/fellow/schemas.ts` are imported into the profile editor directly, so the browser validates with
the same rules the server enforces. `shared/types/api.ts` names the response shapes both sides use.

Dry-run state, the Fellow connection state, and the version come from `/api/status`; the app name and UI
defaults come from `runtimeConfig.public.app`, which `nuxt.config.ts` fills from `aiden.config.ts`. No
component reads environment variables.

## Request pipeline

Every request passes, in order, through `server/middleware/00.request-id.ts` (a UUID on the event, on
a child logger, and in the `x-request-id` header; `Cache-Control: no-store` on `/api`), `01.host-allowlist.ts`
(400 unless the Host header, read directly so a missing one fails closed, names an allowed host; this closes
DNS rebinding), `02.csrf.ts` (403 for any `/api` request a browser labels `cross-site` or `same-site`, and
for any `/api` request a browser labels `cross-site` or `same-site`, for speculative loads, and for a
mutation without `Sec-Fetch-Site: same-origin` or an allowed `Origin`), and `03.body-limit.ts` (413 for a
mutation body over 1 MB). The app's own API reads are client-only (`useApiFetch`), because Nuxt's server
render would otherwise forward the page navigation's `Sec-Fetch-*` headers into requests to itself. Routes are wrapped in `defineApiRoute` from `server/utils/api.ts`, which
turns a Zod error into 400 with issues, a `FellowError` into 502 with the code and our message, an h3
client error into its own status inside the same envelope, and anything else into a logged 500.
`server/api/[...].ts` answers a JSON 404 for anything under `/api` no route claimed. nuxt-security adds the
response headers; its rate limiter, CORS handler, and XSS validator are disabled (nothing calls this API
from another origin, and Zod already validates every field). The README's red/blue log records why.

Route files import from `h3` directly rather than relying on Nitro's auto-imports, so
`tests/helpers/app.ts` can mount the identical handlers on a plain h3 app and exercise the whole
pipeline in-process with msw standing in for Fellow.

## Startup

`server/plugins/00.startup.ts` runs before Nitro listens. It parses the environment, refuses to start
(exit 1) when `HOST` is unset or not loopback, logs a config summary without secrets, prints one plain
line to stdout, and probes Fellow once without blocking.

## Brew history

`server/lib/history/` is pure: a `HistoryStore` over `data/brews.jsonl` and `data/descale.json` (owner-only, in the
working directory like `logs/`), a `BrewTracker` state machine from device reads to events (started, sample,
completed, inferred), `computeStats`, and `descaleStatus`. `server/utils/history.ts` owns the process-wide instance
and the poll loop that `server/plugins/10.history.ts` starts after `00.startup.ts`: a fresh device read every
`history.idlePollSeconds`, every `history.brewPollSeconds` during a brew (the idle rate again after twenty minutes,
for cold-brew steeps), exponential backoff to fifteen minutes when Fellow fails. Fresh reads made by the dashboard
and the re-read after an app-started brew feed the same tracker, so the log never depends on the loop alone.
Rules borrowed from the Home Assistant integration: a duration is trusted only when the poller watched the brew and
the counter rose by exactly one; brews the poller missed are inferred from the counter with the brewer's own
timestamps and no duration; `state.value` decodes to the phase. Routes: `GET /api/history`,
`GET /api/history/brews/:id`, `POST /api/descale`. Nothing in this layer writes to Fellow.

## Deployment (Phase 1)

`deploy/local/install.sh` copies `.output/` and `.env` to `~/Library/Application Support/aiden-studio`,
renders `com.cschweda.aiden-studio.plist.template` into `~/Library/LaunchAgents/` with an absolute node path
and that directory as `WorkingDirectory`, loads it, and waits for `/api/health`. launchd starts the job at
login and restarts it after any non-zero exit, throttled to 30 seconds. The division of labour: the app
enforces its own configuration (the guard exits 1 on a bad one), pins its bind address, rotates its own log
under its `logs/`, and redacts secrets; launchd only supervises, and its own stdout for the job goes to
`~/Library/Logs/aiden-studio/launchd.log`. Running from an installed copy rather than the checkout is what
makes this work when the checkout lives on an external volume, which macOS hides from unattended
processes, and it keeps builds and git operations away from the running service.

## Extracting the client to its own package

Copy `server/lib/fellow/` into a package whose only dependency is `zod`, export `index.ts`, and pass a
logger that satisfies `FellowLogger` (any pino logger does). The tests under `tests/unit/fellow/` and
`tests/helpers/fellow-fixtures.ts` move with it unchanged apart from import paths.

## Sources

Two reference clients were read, not copied: [9b/fellow-aiden](https://github.com/9b/fellow-aiden) (v1 API)
and the client vendored in [kristofferR/FellowAiden-HomeAssistant](https://github.com/kristofferR/FellowAiden-HomeAssistant)
(v2 API, actively maintained). Where they disagree, the Home Assistant client wins.

## UNVERIFIED behaviors

Everything below is inferred, not observed against a live brewer. Each is marked `UNVERIFIED` in code.

| Item | Where | What we assume |
|---|---|---|
| Pulse temperature count | `schemas.ts` | `ssPulseTemperatures.length === ssPulsesNumber` (same for batch). Both reference examples satisfy it; the API may not require it. |
| Profile PATCH response | `client.ts` `updateProfile` | Shape unknown; nothing is returned. Callers refetch. |
| Schedule PATCH response | `client.ts` `updateSchedule` | Same. |
| DELETE responses | `client.ts` | Bodies are ignored. |
| Remote start response | `client.ts` `startBrew` | An object of unknown shape. |
| Device settings | `client.ts` `adjustSetting` | `PATCH /devices/{id}` takes `{ [setting]: value }`. No setting name is known. Not exposed by any route. |
| `profileType` | `schemas.ts` | Any integer; both references use `0`. |
| Shared profile fields | `client.ts` `fetchSharedProfile` | May contain fields beyond the ten we strip; `createProfile` rejects unknown keys, which will surface them. |
| Drop types | `brew-link.ts` | `aiden` is the default drop type; other values are passed through untouched. |
| Device detail id | `client.ts` `fetchDeviceDetail` | The per-device route may omit `id`; a missing id is filled from discovery, a different id is rejected. |
| Schedule id format | `schemas.ts` `ScheduleIdSchema` | Ids look like `s0`; anything URL-safe is accepted before it is put in a path, nothing else. |
| Live `state` object | `device.ts` | Non-null means a brew is in progress; `missing_water` may appear inside it. `brewPhase` decodes `state.value` as the Home Assistant integration does (`b` bloom, `p1`…`p10` pulse, `d` drip finish, `pa` paused); not yet observed here during a brew. |
| `showerHeadPresent` | `schemas.ts` | Parsed but not shown: the owner's brewer reported `false` with the shower head in place, before and after a brew, so the flag does not mean what its name says. |
| `brewEndTime` | `history/tracker.ts` | Observed advancing four hours while idle with the brew counter unchanged, so it is not shown; for a brew the poller did not watch it is believed only within three hours of `brewStartTime`, which stayed put all day. Stats bucket brews by start time. |
| Production logger | `logger.ts` | The pino-roll transport is exercised only by `scripts/smoke.sh`, never by Vitest. |
| Brew counter timing | `history/tracker.ts` | `totalBrewingCycles` is assumed to rise when a brew completes (the mock does the same). If it rises at the start instead, watched brews still count, because the baseline is the last idle read. |
| Profile attribution | `history/tracker.ts` | `ibSelectedProfileId` at the first brewing read is recorded as the brew's profile. Fellow never reports which profile ran; the UI says "selected profile". |
| Live water temperature | `history/tracker.ts` | `brewingWaterTemperatureC` is taken as the live reading during a brew. On the owner's brewer it has been null while idle and null during a descale cycle with the heater on; not yet seen during a real brew. |
| Cleaning cycles | `SensorPanel.vue`, `history/tracker.ts` | During a descale the brewer reports `cleaning: true`, `brewing: true`, `state: null`, and reuses `brewStartTime` and `brewingWaterVolumeMl` (1500 mL) for the cycle; the panel therefore says "last cycle", and the tracker, which follows `state`, starts no brew. Whether `totalBrewingCycles` rises after a cleaning cycle is not yet known. |
