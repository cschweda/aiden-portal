# aiden-studio

A personal web app for controlling a [Fellow Aiden](https://fellowproducts.com/products/aiden) coffee brewer:
brew profiles, schedules, brew.link import, share links, and remote Instant Brew, from a browser on your own machine.

> **Status:** checkpoint 2 of 4. The Fellow client and the server API are complete and tested.
> There is no UI yet. See `CHANGELOG.md`.

## How it works

Fellow publishes no API. This app talks to the same cloud endpoints the Fellow mobile app uses, with your
Fellow account credentials, from a small Node server that runs on your machine. The browser never talks to
Fellow and never sees those credentials.

- **Phase 1 (now):** runs on your Mac, reachable only at `http://localhost:3000`, no login screen. The only
  credential anywhere is your Fellow login in `.env`.
- **Phase 2 (later):** the same build on a DigitalOcean droplet behind Nginx, with an auth layer added then.

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 10

## Setup

```sh
cp .env.example .env     # then fill in FELLOW_EMAIL and FELLOW_PASSWORD
chmod 600 .env           # it holds your real Fellow password
pnpm install
pnpm dev
```

`FELLOW_DRY_RUN=true` (the default in `.env.example`) logs every profile, schedule, and brew-start change
instead of sending it to Fellow. Reads still go through. Turn it off once you trust the UI.

`pnpm install` needs no build-script approvals. The few dependencies whose install scripts pnpm 10 skips are
listed, with reasons, in `pnpm-workspace.yaml`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server with hot reload |
| `pnpm build` | Production build into `.output/` |
| `pnpm start` | Run the production build (reads `.env` via `node --env-file`) |
| `pnpm test` | Full test suite |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `nuxt typecheck` plus the test tree |

## Configuration

Every variable is documented in `.env.example`.

| Variable | Purpose |
|---|---|
| `FELLOW_EMAIL`, `FELLOW_PASSWORD` | Your Fellow app login. Server-side only. |
| `FELLOW_DRY_RUN` | `true` to log mutations instead of sending them. |
| `FELLOW_TIMEZONE` | IANA zone sent to Fellow at login. Defaults to this machine's zone. |
| `ALLOWED_HOSTS` | Hostnames accepted in the `Host` header. |
| `LOG_LEVEL` | `fatal` … `trace`. Defaults to `info` in production, `debug` in dev. |
| `HOST`, `PORT` | Bind address. Always set `HOST`; unset means every interface. |

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
`logs/aiden.<date>.<n>.log`, rotates daily, keeps 14 files, and points `logs/current.log` at the active
one, so `tail -f logs/current.log` always works. Passwords, tokens, and cookies are redacted before they
are written. Every request carries an `x-request-id` header that matches its log lines.

## Project layout

- `server/lib/fellow/` — the Fellow client. Pure TypeScript, no Nuxt imports, so it can become its own package.
- `server/utils/config.ts` — the only place `process.env` is read.
- `server/api/` — thin Nuxt server routes over the client; `server/middleware/` is the request pipeline.
- `app/` — the Nuxt UI front end (checkpoint 3).
- `tests/` — Vitest, with msw standing in for Fellow.

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
