# aiden-studio

A personal web app for controlling a [Fellow Aiden](https://fellowproducts.com/products/aiden) coffee brewer:
brew profiles, schedules, brew.link import, share links, and remote Instant Brew, from a browser on your own machine.

> **Status:** checkpoint 3 of 4. The app is usable end to end: dashboard, profiles, schedules, and logs over
> the Fellow client. Checkpoint 4 adds the launchd service and the Phase 2 notes. See `CHANGELOG.md`.

## How it works

Fellow publishes no API. This app talks to the same cloud endpoints the Fellow mobile app uses, with your
Fellow account credentials, from a small Node server that runs on your machine. The browser never talks to
Fellow and never sees those credentials.

- **Phase 1 (now):** runs on your Mac, reachable only at `http://localhost:3000`, no login screen. The only
  credential anywhere is your Fellow login in `.env`.
- **Phase 2 (later):** the same build on a DigitalOcean droplet behind Nginx, with an auth layer added then.

## The app

Dark by default (the toggle is in the sidebar footer), one accent, and every value the brewer accepts.

| Page | What it does |
|---|---|
| Dashboard | The brewer's state as one word (Ready, Brewing, Offline, Not ready) with every reported flag underneath, the reasons a brew cannot start, brew counters and inventory, and the **Start brew** button, which is enabled only when the brewer says it is ready and asks before it sends. |
| Profiles | Every profile on the brewer with a one-line recipe summary. Create, edit, delete, share (a brew.link URL to copy), and import from a brew.link. The editor exposes every variable in its exact steps: ratio and temperature sliders in halves, bloom, and per-pulse temperatures that follow the pulse count. |
| Schedules | Each schedule with its time in the brewer's local time, days, water, and profile; pause or resume with the switch, delete, or add one with the day chips and time picker. |
| Logs | The production log file, newest first, filterable by level and by request id (click any id). Each row expands to the full record. |

Failed calls show a toast with the server's error code, never a blank failure. The `?new=1` query on the
profiles and schedules pages opens the create form directly.

| Dashboard | Profile editor |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Profile editor](docs/screenshots/profile-editor.png) |

| Schedules | Logs |
|---|---|
| ![Schedules](docs/screenshots/schedules.png) | ![Logs](docs/screenshots/logs.png) |

(Screenshots taken against the mock brewer. In development the log viewer explains that logs go to the terminal; the production build writes the file it reads.)

### Run against the mock brewer

You do not need a brewer, or even a Fellow account, to try the app:

```sh
pnpm mock:fellow                      # terminal 1: an in-memory Fellow API on http://127.0.0.1:3900
```

Then in `.env` set `FELLOW_BASE_URL=http://127.0.0.1:3900/v2` and any `FELLOW_EMAIL` / `FELLOW_PASSWORD`,
and run `pnpm dev` (or `pnpm build && pnpm start`). The mock has three profiles, two schedules, a ready
brewer, and accepts every mutation; `pnpm mock:fellow -- --flaky` makes every third read fail with a 503
so you can watch the retries. Leave `FELLOW_BASE_URL` blank to talk to the real Fellow API.

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 10

## Setup

```sh
cp .env.sample .env      # then fill in FELLOW_EMAIL and FELLOW_PASSWORD
chmod 600 .env           # it holds your real Fellow password
pnpm install
pnpm dev
```

Two files configure the app:

- **`.env`** (git-ignored, copied from the heavily commented `.env.sample`) holds the secrets: your Fellow
  email and password. It may also override a handful of settings for one run; leave those blank normally.
- **`aiden.config.ts`** (committed, at the repo root) is the single source of truth for everything else:
  bind address and port, dry run, cache and retry tuning, Fellow's API URL, logging, and UI defaults. Edit
  it and rebuild; it is compiled into each `pnpm dev` and `pnpm build`.

`fellow.dryRun` starts out `true`: every profile, schedule, and brew-start change is logged instead of sent to
Fellow, and the UI shows a DRY RUN badge. Reads still go through. Flip it once you trust the app.

`pnpm install` needs no build-script approvals. The few dependencies whose install scripts pnpm 10 skips are
listed, with reasons, in `pnpm-workspace.yaml`, as is the one dependency override.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server with hot reload |
| `pnpm build` | Production build into `.output/` |
| `pnpm start` | Run the production build (reads `.env` via `node --env-file`) |
| `pnpm test` | Full test suite |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `nuxt typecheck` plus the test tree |
| `scripts/smoke.sh` | Probes a production build for the things Vitest cannot see: guard, headers, Host/CSRF, error shapes, log file |

## Configuration

`aiden.config.ts` documents every setting inline. The environment only adds secrets and, optionally, a
single-run override of the keys below; `.env.sample` documents each one.

| Variable | Purpose |
|---|---|
| `FELLOW_EMAIL`, `FELLOW_PASSWORD` | Required. Your Fellow app login. Server-side only, never logged. |
| `FELLOW_DRY_RUN` | Overrides `fellow.dryRun`. |
| `FELLOW_TIMEZONE` | Overrides `fellow.timezone` (IANA zone sent to Fellow at login). |
| `HOST`, `PORT` | Override `server.host` / `server.port`. `NITRO_HOST` / `NITRO_PORT` are honoured too, with the same guard. |
| `ALLOWED_HOSTS` | Overrides `server.allowedHosts` (hostnames only, as they appear in the `Host` header). |
| `LOG_LEVEL` | Overrides `logging.level`. |

## API

Every route lives under `/api` and answers JSON. Mutations are POST, PATCH, or DELETE and must come from
this site: the browser proves it with `Sec-Fetch-Site: same-origin`; a script or `curl` must send
`Origin: http://localhost:3000` instead, or it gets a 403.

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness, no Fellow call |
| `GET /api/status` | `{ dryRun, version, fellow }` where `fellow` is the last Fellow outcome |
| `GET /api/device?fresh=1` | device state plus `canStartBrew` and the list of `blockers` |
| `GET /api/profiles?fresh=1`, `POST /api/profiles` | list, create |
| `PATCH /api/profiles/:id`, `DELETE /api/profiles/:id` | update (send the full profile), delete |
| `POST /api/profiles/:id/share` | `{ link }` |
| `POST /api/profiles/import` | body `{ link }`; imports a brew.link profile |
| `GET /api/schedules?fresh=1`, `POST /api/schedules` | list, create |
| `PATCH /api/schedules/:id`, `DELETE /api/schedules/:id` | update (for example `{ "enabled": false }`), delete |
| `POST /api/brew/start` | starts the configured Instant Brew, or 409 with the reasons it cannot |

Errors are `{ error, message?, issues? }`: 400 for validation, 502 for a Fellow failure (the code only,
never Fellow's response), 500 otherwise. Reads are cached for 30 seconds; `?fresh=1` bypasses the cache.

## Logs

In development everything goes to the terminal. In production pino writes JSON lines to
`logs/aiden.<date>.<n>.log` (owner-only directory), rotates daily or at 50 MB, keeps 14 files, and points
`logs/current.log` at the active one, so `tail -f logs/current.log` always works. Passwords, tokens, and
cookies are redacted before they are written. Every request carries an `x-request-id` header that matches
its log lines. Stdout gets exactly two lines at startup: ours (address, dry run, log path) and Nitro's own
`Listening on …`; under launchd that is all its stdout file should ever hold, besides crash traces.

## Red team / blue team log

Newest entry first, open. Older entries are collapsed. Each entry records what was attacked (red), what was
found, and what now defends against it (blue). Add a new dated `###` entry at the top and move the previous
one into the `<details>` block at the bottom.

### 2026-09-10 — First pass, after checkpoint 2

**Context.** Phase 1 runs with no login on a loopback-only server, so the threat model is "anything that can
reach 127.0.0.1 on this Mac": every browser tab the owner opens, every other local process, and DNS-rebinding
or cross-site tricks from pages the owner visits. There is nothing to authenticate, so the defenses are
about which requests the server is willing to act on and what it is willing to say back.

**Red — what was tried** (by hand with curl against a production build, plus an independent code review that
repeated and extended the probes, then folded into `scripts/smoke.sh` so it runs on every build):

- Bind-address escapes: `HOST=0.0.0.0`, `NITRO_HOST=0.0.0.0` with a loopback `HOST`, missing credentials.
- Host header games: foreign hosts, `LOCALHOST`, trailing dot, `127.0.0.1.evil`, empty and missing Host,
  `X-Forwarded-Host`.
- Cross-site requests: bare POST, `Origin: null`, lookalike origins (`localhost.evil.example`,
  `localhost@evil.example`), `Sec-Fetch-Site: same-site` with a foreign Origin, cross-site GET to `?fresh=1`,
  HEAD and OPTIONS on mutation routes, `X-HTTP-Method-Override`.
- Bodies: malformed JSON on POST and PATCH, arrays, `__proto__` keys, 3 MB POST, 2 MB PATCH, titles with
  `<` and the allowed specials.
- Paths: traversal in profile and schedule ids (`../start?confirm=true`), unknown API paths, wrong methods.
- Leakage: whether any error, header, or log line carries the Fellow password, tokens, or Fellow's raw
  response bodies; what `/api/status` reveals; what stdout and the log file contain.
- Dependencies: `pnpm audit`.

**Found and fixed**

| Severity | Finding | Fix |
|---|---|---|
| High | `NITRO_HOST=0.0.0.0` passed the guard (which read only `HOST`) and bound every interface. | Config mirrors Nitro's precedence and the startup plugin pins `NITRO_HOST`/`NITRO_PORT` to the validated value, so the file, the guard, and the socket cannot disagree. |
| Medium | A cross-site page could make this server call Fellow through GET requests such as `<img src="…/api/device?fresh=1">`; CORS hides the answer but does not stop the call. | Any `/api` request a browser labels `cross-site` or `same-site` is refused (403), GET included. |
| Low | Malformed JSON and `__proto__` bodies escaped the shared error mapping (a 500 with a logged stack on PATCH, h3's own envelope on POST). | h3 client errors stay in our envelope with their status; h3 server errors never forward details. |
| Low | nuxt-security's XSS validator produced a second, uncoded 400 shape and inspected query strings. | Disabled; Zod strict schemas already validate every field of this JSON API. CSP stays on. |
| Low | Unknown `/api` paths and wrong methods answered 200 with the HTML app shell. | `server/api/[...].ts` answers a JSON 404. |
| Low | PATCH bodies had no size cap (nuxt-security's limiter skips PATCH). | 1 MB cap on every mutation before any route buffers the body. |
| Low | A missing Host header passed the allowlist (h3 substitutes `localhost`). | The header is read directly and fails closed. |
| Low | API responses carried no `Cache-Control`. | `no-store` on every `/api` response. |
| Low | `logs/` was created with default permissions; a world-readable `.env` went unnoticed. | `logs/` is created `0700`; startup warns when `.env` is readable by other accounts. |
| Low | esbuild 0.27.7 via `@nuxt/fonts` carried GHSA-g7r4-m6w7-qqqr (dev-server file read, Windows only). | Overridden to the patched line in `pnpm-workspace.yaml`; audit is clean. |
| Info | `X-Frame-Options: SAMEORIGIN` disagreed with CSP `frame-ancestors 'none'`. | `DENY`. |
| Info | A remote-start check on a cold client judged readiness on the device list, whose fields are not live. | A fresh device read always goes on to the live detail route. |
| Medium (regression, same day) | The first version of the same-site rule broke the app's own server render: Nuxt forwards the page navigation's `Sec-Fetch-*` headers into its server-side API calls, and Chrome labels a navigation from a link on another site as cross-site, so the dashboard failed for anyone arriving via a link. A first fix exempted top-level navigations, which reopened a path for a page elsewhere to send the owner's tab to an API URL or prefetch it. Found in the browser click-through and by the checkpoint review. | The strict rule stands (any cross-site or same-site request to `/api` is refused, whatever its mode) and speculative loads (`Sec-Purpose: prefetch`/`prerender`) are refused too. The app's own API reads are client-only, so the server never forwards a navigation's headers into requests to itself. Covered by tests and the smoke script. |
| Low | A failed refresh could blank the dashboard, and a read failure on the profile or schedule pages rendered as "No profiles yet". Found by the checkpoint review. | Reads keep the last good data on a failed refresh, mark it stale, and show the server's reason; every page has an explicit error state. |
| Info | The Fellow client followed HTTP redirects, which would re-send the login body wherever a redirect pointed. | `redirect: 'error'` on every Fellow request. A plain-http `FELLOW_BASE_URL` is announced on startup so a forgotten mock setting cannot pass for the real brewer. |

**Blue — defenses now in place**

- **Loopback only, enforced twice.** The server refuses to start unless the effective bind address is
  loopback, and it sets that address itself from `aiden.config.ts`. The guard sees the bind address only:
  a proxy in front of it (Tailscale, Nginx) would bypass the whole model, which is why Phase 2 requires an
  auth layer before anything leaves this machine.
- **Which requests are acted on.** Host allowlist (400) closes DNS rebinding; the same-site rule (403)
  keeps other sites from driving the API at all; mutations must prove same-origin or carry an allowed
  Origin; bodies are capped; ids are validated before they touch a URL; every field of every body is
  validated by strict schemas that reject unknown keys.
- **What is said back.** One error envelope: 400 with issue paths, 502 with a Fellow error *code* and our
  own message, 500 with nothing. Fellow's response bodies never reach the browser. API responses are
  `no-store`. Headers from nuxt-security: CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, a restrictive Permissions-Policy.
- **What is written down.** Logs redact passwords, tokens, and cookies at three depths; the log directory
  is owner-only; secrets live only in `.env`, which the app checks for permissive permissions at startup.
- **What is sent to Fellow.** Only GET and DELETE are retried, so a flaky 503 can never create a duplicate
  profile; reads are cached and de-duplicated so the dashboard cannot hammer an unofficial API; dry run is
  the default until the owner turns it off.
- **Verification.** 340 Vitest cases cover the client and the request pipeline in-process;
  `scripts/smoke.sh` re-runs the probes above against every production build.

**Accepted for now.** No TLS on loopback (nothing to protect from); the two stdout lines; the dev server's
HMR and devtools endpoints, which bind to the same loopback address.

<details>
<summary>Older entries</summary>

None yet.

</details>

## Project layout

- `server/lib/fellow/` — the Fellow client. Pure TypeScript, no Nuxt imports, so it can become its own package.
- `aiden.config.ts` — every non-secret setting; `server/utils/config.ts` merges it with `.env` and is the only place `process.env` is read.
- `server/api/` — thin Nuxt server routes over the client; `server/middleware/` is the request pipeline.
- `app/` — the Nuxt UI front end: `pages/`, `components/`, `composables/`, and `utils/` (pure, unit-tested logic such as the profile form rules and time conversion).
- `tests/` — Vitest, with msw standing in for Fellow.
- `scripts/mock-fellow.mjs` — an in-memory Fellow API for development and demos.

See `ARCHITECTURE.md` for the layer split and the list of API behaviors that are inferred rather than verified.

## Hat tip: fellow-aiden

This project stands on the shoulders of [fellow-aiden](https://github.com/9b/fellow-aiden) by
[9b](https://github.com/9b), the Python library that first worked out how to talk to the Aiden, and of the
[Fellow Aiden Home Assistant integration](https://github.com/kristofferR/FellowAiden-HomeAssistant), whose
maintained client documents the v2 API: the refresh-token flow, the `overallTemperature` profile field,
brew.link drop types, remote Instant Brew, and the device state that gates it. Fellow documents none of this.
Everything aiden-studio knows about the endpoints, the required headers, the profile and schedule validation
rules, and the server-side fields was learned from those two projects. aiden-studio is an independent
TypeScript implementation that ports the behavior rather than the code, but if it is useful to you, the credit
belongs upstream. Both projects are licensed under GPL-3.0.

## License

MIT. See `LICENSE`.
