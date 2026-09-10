# Architecture

## Two layers

1. **`server/lib/fellow/` — the Fellow client.** Pure TypeScript with zero Nuxt or browser imports.
   It uses the global `fetch` and takes its logger, clock, sleep, and randomness as constructor options
   so it is deterministic under test. `FellowHttp` owns authentication, retries, and JSON;
   `FellowClient` owns the typed API, the read cache, and dry-run behavior; `device.ts` holds the pure
   readiness rules for remote start.
2. **`server/api/` — Nuxt server routes.** Thin wrappers that validate input with the same Zod schemas
   and call the single `useFellowClient()` instance. The browser only ever talks to these routes.

Configuration is parsed once by `server/utils/config.ts`. Nothing else reads `process.env`.

## Authentication against Fellow

Login is lazy and single-flight. On a 401 the client refreshes the access token with the refresh token and
retries; if the refresh is declined, or the refreshed token is rejected again, it logs in with the password
and retries once more. Concurrent requests that hit 401 together share one re-authentication.

## Reads and writes

Device, profile, and schedule reads are cached for 30 seconds and de-duplicated while in flight. Any
mutation clears the cache. Only GET and DELETE are retried (408 and 5xx, three attempts, jittered backoff);
a retried POST could create a duplicate profile after a 503 Fellow had in fact processed.

## Extracting the client to its own package

Copy `server/lib/fellow/` into a package whose only dependency is `zod`, export `index.ts`, and pass a
logger that satisfies `FellowLogger` (any pino logger does). The tests under `tests/unit/fellow/` and
`tests/helpers/fellow-fixtures.ts` move with it unchanged apart from import paths.

## Sources

Two reference clients were read, not copied: [9b/fellow-aiden](https://github.com/9b/fellow-aiden) (v1 API)
and the client vendored in [NewsGuyTor/FellowAiden-HomeAssistant](https://github.com/NewsGuyTor/FellowAiden-HomeAssistant)
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
| Live `state` object | `device.ts` | Non-null means a brew is in progress; `missing_water` may appear inside it. |
