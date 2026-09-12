# Changelog

All notable changes to aiden-studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). The version in `package.json` is
bumped and an entry is added here at the end of every checkpoint and every release.

## [Unreleased]

### Fixed

- The deployed demo was a blank page: the Content-Security-Policy in `netlify.toml` blocked the inline script a
  static build starts itself from, so nothing ran. Scripts may now be inline on that page, which is safe there and
  nowhere else, and the real app keeps its nonce-based policy.
- Icons were missing on the deployed demo: the app asks a server for them, and the single-page redirect answered
  those requests with the page itself. A demo build now carries its icons in the client bundle, and `/api/*` on
  Netlify returns a 404 instead of the page.

### Changed

- The repository is `cschweda/aiden-portal`; the clone command and the demo's source link follow.

## [0.12.0] - 2026-09-12

A demo anyone can look at.

### Added

- `pnpm build:demo` builds a static, server-free single-page version of the app whose `/api` calls are answered in
  the browser from sample data in `app/demo/`: an invented brewer, seven profiles, three weeks of brews with traces,
  a descale history, and logs. The pages and the statistics, descale, and brew-phase logic are the app's own, so the
  demo behaves like the real thing; pressing Start brew runs a hundred-second brew whose trace fills in live.
- `netlify.toml`: build command, publish directory, `AIDEN_DEMO=1`, the single-page redirect, cache and security
  headers. Netlify needs no other configuration; Node comes from `.nvmrc`. A demo build leaves `server/api`,
  `server/middleware`, and `server/plugins` out, so it needs no `.env` and ships no server code.
- A banner on the demo dashboard saying what it is, linking to the source, and offering to start the sample world
  over.

### Changed

- The app calls its own API through one auto-imported `apiFetch`, which the demo plugin points at the sample world.
  A normal build never downloads the demo code, and the demo build contains no server, no Fellow client, and no
  credentials.

### Changed

- The repository is public, so nothing in it names this machine: `aiden.config.ts` ships the generic host list and
  an empty `tailnetUsers`, and the owner's Tailscale name and login live in `.env` through `ALLOWED_HOSTS` and
  `TAILNET_USERS`. `docs/reaching-aiden-studio.html`, a page of one owner's own addresses, is gone from the repo.

### Added

- README "Quick start on a Mac": the copy-pasteable path from nothing to the app running under launchd and
  reachable from your other machines over Tailscale, tested on Apple Silicon. It replaces the old Requirements and
  Setup sections.

### Removed

- `docs/PHASE-2.md`. The public droplet it described is not where this is going; the design notes stay in the
  git history if they are ever wanted. `ARCHITECTURE.md`'s deployment section drops the phase from its title and
  describes Tailscale alongside launchd.

### Changed

- The README describes the project as it is: Phase 1 on the Mac and Phase 1.5 over Tailscale for the owner's own
  computers and phones, not a stepping stone to a public site. Every reference to a public Phase 2 deployment is
  gone, and the red team / blue team log gains a dated entry for the pass that mattered here, when `tailscale serve`
  became the first thing ever to sit in front of the app.

## [0.11.2] - 2026-09-12

### Added

- A favicon: a coffee cup in the app's amber on dark stone, as SVG, a 32 px PNG, and a 180 px home-screen icon for
  phones.

## [0.11.1] - 2026-09-12

### Added

- One log line per API request at the debug level (method, path, host, and the Tailscale login when there is
  one), so switching the Logs page to Detailed shows who asked for what and from which address.

## [0.11.0] - 2026-09-12

Phase 1.5: the dashboard from every one of your computers, through Tailscale.

### Added

- The host Mac's Tailscale name is an allowed host, so `tailscale serve --bg 5150` publishes the
  dashboard onto your private network with a real certificate while the app stays on loopback. README explains the
  setup for the Mac mini and for other Macs and Windows PCs.
- `server.tailnetUsers` (or `TAILNET_USERS`): the Tailscale logins allowed to make changes through `tailscale serve`,
  which stamps the signed-in login on each request; everyone else on the tailnet can look but not change. The login
  is logged with every request.

## [0.10.2] - 2026-09-12

### Fixed

- Opening the dashboard from Chrome's address bar could show "Could not read the brewer, cross_site_request":
  Chrome prerenders addresses it expects you to visit, the API refuses speculative loads by design, and the
  refused page was then shown as is. Pages now wait until they are actually shown before reading, and re-read
  when a prerendered page becomes visible. Refusals log the speculation header that caused them.

## [0.10.1] - 2026-09-12

### Fixed

- After a restart the brew counter baseline came from the brew log alone, so the three counts a descale program
  adds (the Aiden counts each phase as a brew) were re-read as missed brews. The baseline now comes from the newest
  brew or cleaning record.
- The descale tally leaves out the brews and water that cleaning cycles since the mark added to the brewer's totals
  (4.5 L and three brews per descale program).
- The dashboard banner treats the pauses between a descale program's phases as still running, and offers Mark
  descaled only after ten quiet minutes.

## [0.10.0] - 2026-09-12

### Added

- A countdown on the live brew trace: about how long is left, measured from the profile's previous watched brews
  when the log has them and worked out from the recipe until then; the trace's axis spans the expected brew from
  the start. Fellow does not expose the brewer's own countdown.
- README: reaching the dashboard from a laptop on the same network through an SSH tunnel, with the app staying on
  loopback.

## [0.9.0] - 2026-09-12

### Added

- Cleaning cycles: a descale or rinse the brewer announces is logged to `data/cleanings.jsonl` with its start, end,
  duration, water, and the movement of the brew and water totals across it. The History page has a Descale section
  with the cycles seen, the last one, the average length, and the list; the dashboard banner says when a cycle is
  running and offers Mark descaled once one has finished. A cycle never counts as a brew, and the brewing flag the
  brewer raises during a cycle no longer risks a phantom brew.

### Changed

- The sensor panel says "Last cycle started" and "Last cycle water": the brewer fills those fields for a descale
  cycle too (1500 mL, the cycle's start), not only for brews.

## [0.8.0] - 2026-09-12

### Added

- A Detail control on the Logs page that switches the log level being written (quiet, normal, detailed,
  everything) for the running service, until it restarts; `PATCH /api/logs/level`. The persistent default stays in
  `aiden.config.ts` or `LOG_LEVEL`. `GET /api/logs` reports the level in force.

## [0.7.2] - 2026-09-12

### Fixed

- An empty brew log is seeded with the last brew the brewer still reports (start time, water, selected profile), so
  the day's earlier brew shows up when the service starts watching mid-day instead of only brews after that point.
- The brewer's `brewEndTime` advances on its own while idle (it moved four hours with no brew), so it is no longer
  shown on the sensor panel ("Last brew started" is, from the stable `brewStartTime`), unwatched brews only believe
  it within three hours of their start, and stats bucket brews by the day they started.

## [0.7.1] - 2026-09-12

### Changed

- The descale tally is a banner across the top of the dashboard, shown only when descaling is due or close, with
  the Mark descaled button on it; the full tally with its estimate lives on the History page. The card no longer
  stretches the dashboard's top row.

## [0.7.0] - 2026-09-12

Brew history, brew trace, and a descale tally.

### Added

- A background poller in the service: a fresh read of the brewer every 60 seconds while idle and every 5 seconds
  during a brew (`history.idlePollSeconds` / `history.brewPollSeconds` in `aiden.config.ts`; `HISTORY_ENABLED=false`
  turns it off). Fellow failures back off to fifteen minutes. The reads also keep the dashboard's cache warm.
- A brew log in `data/brews.jsonl` next to `logs/` (`history.directory`, or `HISTORY_DIRECTORY`): one line per
  completed brew with start, end, duration, water, the profile selected on the brewer, whether it was watched or
  inferred from the brew counter, and its trace samples. The installed copy keeps it across reinstalls; only
  `uninstall.sh --purge` removes it.
- A brew trace: phase, water temperature, heater, and pump sampled through the brew, drawn as a temperature line with
  shaded phase bands, a crosshair tooltip, and a sample table. Live on the dashboard while a brew runs, the last brew
  afterwards, any brew on the History page.
- Stats on the dashboard (brews and water today, this week from Sunday, this month; most used profile) and a History
  page with average brew length, average time between brews, every logged brew, the descale history, and what the
  poller is doing.
- A descale tally on the dashboard: brews and litres since Mark descaled, a bar that turns amber at 80% and red at
  100% of `maintenance.descaleAfterLitres` (60 L to start; `descaleAfterBrews` adds a brew count), an estimate of the
  due date from the recent pace, and the Mark descaled button behind a confirmation. Only aiden-studio's own file
  changes; nothing is sent to Fellow. Until the first mark the tally counts from the brewer's lifetime totals.
- `POST /api/descale`, `GET /api/history`, `GET /api/history/brews/:id`.
- The mock brewer walks a brew through bloom, two pulses, and drip finish with a cooling water temperature and
  completes it with a counter tick, so all of this can be tried without a brewer.

### Changed

- Every fresh device read the dashboard makes feeds the brew tracker, and a brew started from the app is re-read
  two seconds later so its trace starts at once.
- The startup plugin is now `00.startup.ts`, so it runs before the history plugin.

## [0.6.0] - 2026-09-12

Running at home for real: installed as the launchd service on the owner's Mac, on its own port, with dry run
off, reachable by name.

### Fixed

- On `aiden.local` and `aiden.localhost` the page arrived unstyled: the content security policy's
  `upgrade-insecure-requests` made the browser fetch every asset over https, which the plain-http server cannot
  answer. Chrome exempts only `localhost`. The directive is off in Phase 1 and noted for Phase 2.

### Changed

- The default port is 5150 (`server.port` in `aiden.config.ts`); 3000 is busy with other work on the owner's Mac.
- `aiden.localhost` and `aiden.local` are allowed hosts; the README explains that the first needs no setup and
  the second needs an IPv4 and an IPv6 hosts-file line to avoid Bonjour's five-second wait.
- The readiness blocker says "carafe is not in place (the batch basket brews into it)" when the batch basket is
  detected and only the carafe is missing; "no basket detected" is now reserved for no basket at all.

## [0.5.1] - 2026-09-12

### Removed

- The shower head row of the sensor panel. Fellow reported it as not detected on a brewer whose shower head was in
  place, before and after a brew, so the flag does not mean what its name says and would mislead troubleshooting.

## [0.5.0] - 2026-09-12

The first release run against a real brewer.

### Added

- A sensor panel on the dashboard, in place of the profiles list (the Profiles page has them): everything the
  brewer reports, grouped for troubleshooting. Right now (brew phase decoded from the live state, heater, pump,
  water temperature, last brew water and end time, cleaning, rinsing), hardware (cloud connection and since when,
  lid, tank, carafe, both baskets, shower head, firmware and whether an update is due, unsynced changes), totals
  (brews, water brewed, average per brew), the settings on the brewer itself (Instant Brew profile and water,
  elevation, units, clock, chime, advanced mode, remote brewing, language, time zone), and identity. Each reading
  says "—" when Fellow does not report it; the panel shows when it was read.
- Heater and pump chips in the readout while they are on.
- The mock brewer reports the same fields, and a live phase code, so the panel can be demonstrated without a brewer.

### Fixed

- Water brewed was shown a thousand times too large: Fellow's `totalWaterVolumeL` is millilitres despite its name.
- The Wi-Fi address was shown with the literal quotes Fellow wraps it in.
- Profile summaries read "null°" for the many profiles whose stages differ; Fellow sends `overallTemperature: null`
  for those, and the summary now shows the pulse temperatures instead ("85°", or "96–92°" when they vary).
- Opening such a profile in the editor no longer puts null into the temperature field: the first pulse temperature
  is used, so saving cannot silently send the blank recipe's 94°.
- The Bluetooth row is gone; Fellow does not report that address.

## [0.4.1] - 2026-09-12

Fixes from the checkpoint 4 review.

### Fixed

- The installer refuses to run while something else holds the port (a dev server, `pnpm start`, the mock demo),
  so it can no longer report one of those as the installed service. It waits for the old service to be fully
  torn down before loading the new one, explains a failed `launchctl bootstrap`, refuses when `aiden.config.ts`
  is newer than the build, and renders and lints the plist in a temporary file so a bad render never lands in
  `~/Library/LaunchAgents`.
- `status.sh` and `logs.sh` read the installed copy's `.env` and `aiden.config.ts`, not the checkout's; IPv6
  hosts are bracketed; `status.sh` tells "plist present but not loaded" from "not installed" and reports a node
  binary that has disappeared after an nvm upgrade.
- `logs.sh` follows across rotation (`tail -F`) and falls back to launchd's log before the app has written one.
- `uninstall.sh --purge` removes launchd's log directory too, as documented; the installer creates it owner-only.
- node is resolved through `process.execPath`, so a symlink to a node on an external volume is caught.
- `&`, `<`, and `>` in a path survive the plist render.

### Added

- `scripts/check-shell.sh`, run by `pnpm lint`: bash syntax for every script, shellcheck when installed, and a
  render of the launchd template with awkward paths, linted and read back.

### Changed

- README "Run at home": the port is held while installed (`PORT=3001 pnpm dev`), re-install after changing node
  versions, Login Items, `launchd.log` never rotates, `tail -F`. `docs/PHASE-2.md`: the droplet runs from a
  release directory, and anonymous visitors need a route middleware, not only the API guard.

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
