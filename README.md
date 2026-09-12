# aiden-portal

A personal web app for controlling a [Fellow Aiden](https://fellowproducts.com/products/aiden) coffee brewer:
brew profiles, schedules, brew.link import, share links, and remote Instant Brew, from a browser on your own machine.

> **Status:** Phase 1.5 complete. The app runs at login on your Mac under launchd, listens on loopback only, and
> is reachable from your own computers and phones over [Tailscale](https://tailscale.com). It is not a public
> website and is not built to become one. See `CHANGELOG.md`.

> **Demo:** **[aiden-portal.netlify.app](https://aiden-portal.netlify.app)** — the whole interface, running on
> invented data. It is not connected to a brewer, to Fellow, or to anything else, so nothing you press there
> changes anything in the world; it is the fastest way to see how the app looks and behaves. Start a brew and the
> trace fills in phase by phase, edit a profile, mark a descale. A reload starts the sample world over.

## How it works

Fellow publishes no API. This app talks to the same cloud endpoints the Fellow mobile app uses, with your
Fellow account credentials, from a small Node server that runs on your machine. The browser never talks to
Fellow and never sees those credentials.

- **Phase 1 — on the Mac.** The server listens on `127.0.0.1:5150` and nowhere else, with no login screen. The
  only credential anywhere is your Fellow login in `.env`.
- **Phase 1.5 — your own machines.** Tailscale joins your computers and phones into a private network of their
  own and publishes the dashboard onto it. The app still listens on loopback; Tailscale is the only door, and it
  opens for devices signed in to your Tailscale account and nothing else.

That shape is the point, not a stepping stone. Nothing is exposed to the internet and there is no public address.
Putting this on a public website would need a login inside the app first, which is not what it is for.

## The app

Dark by default (the toggle is in the sidebar footer), one accent, and every value the brewer accepts.

| Page | What it does |
|---|---|
| Dashboard | The brewer's state as one word (Ready, Brewing, Offline, Not ready) with every reported flag underneath, the reasons a brew cannot start, the **Start brew** button, which is enabled only when the brewer says it is ready and asks before it sends, and a sensor panel with everything the brewer reports, grouped for troubleshooting: the live phase, heater, pump, and water temperature; lid, tank, carafe, baskets, and shower head; brew and water totals; the settings on the brewer itself; and its identity; a descale banner with the Mark descaled button when descaling is due or close; brews and water today, this week, and this month; and the trace of the brew running now, or the last one. |
| Profiles | Every profile on the brewer with a one-line recipe summary. Create, edit, delete, share (a brew.link URL to copy), and import from a brew.link. The editor exposes every variable in its exact steps: ratio and temperature sliders in halves, bloom, and per-pulse temperatures that follow the pulse count. |
| Schedules | Each schedule with its time in the brewer's local time, days, water, and profile; pause or resume with the switch, delete, or add one with the day chips and time picker. |
| History | Brews and water by day, week, and month; average brew length and time between brews; the most used profile; every logged brew, with its trace on demand; the descale tally with its estimate and Mark descaled button, and when the brewer was descaled; and what the background reads are doing. |
| Logs | The production log file, newest first, filterable by level and by request id (click any id). Each row expands to the full record. |

Failed calls show a toast with the server's error code, never a blank failure. The `?new=1` query on the
profiles and schedules pages opens the create form directly.

| Dashboard | Profile editor |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Profile editor](docs/screenshots/profile-editor.png) |

| Schedules | Logs |
|---|---|
| ![Schedules](docs/screenshots/schedules.png) | ![Logs](docs/screenshots/logs.png) |
| History | |
|---|---|
| ![History](docs/screenshots/history.png) | |

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

### The demo site

That demo is at **[aiden-portal.netlify.app](https://aiden-portal.netlify.app)**, and anyone can build their own:
`pnpm build:demo` produces a static site with no server at all: a single-page build whose every `/api` call is
answered in the browser from sample data in `app/demo/`. It shows the whole app, with an invented brewer, seven
profiles, three weeks of brews and traces, a descale history, and logs. Nothing is connected to anything: no
Fellow account, no credentials, no real serial numbers, and a reload starts the sample world over.

```sh
pnpm build:demo
npx serve .output/public     # or: cd .output/public && python3 -m http.server 4173
```

It is not a stripped-down mock. The pages, the components and the brew statistics, descale tally, and phase
decoding are the same code the real app runs; only the data underneath is invented. Press **Start brew** in the
demo and the trace fills in over a hundred seconds, phase by phase, and the brew lands in the history.

**On Netlify.** `netlify.toml` in the repo root sets the build command, the publish directory, `AIDEN_DEMO=1`,
the single-page redirect, and the response headers; the Node version comes from `.nvmrc` and pnpm from the
`packageManager` field. Point Netlify at the repository and it needs no further configuration. From the CLI:

```sh
pnpm build:demo
npx netlify deploy --prod --dir=.output/public
```

A demo build never includes the server: `nuxt.config.ts` leaves `server/api`, `server/middleware`, and
`server/plugins` out of it entirely, so there is no Fellow client, no request pipeline, and nothing that wants
credentials. It builds on a machine that has no `.env` at all, which is what a hosting service has. The real
build is untouched: `AIDEN_DEMO` is what turns any of this on.

## Brew history and descale

The service keeps its own record of what the brewer does, because Fellow's API has no history and no maintenance
counters.

- **How it watches.** A fresh read of the brewer every 60 seconds while idle and every 5 seconds during a brew (the
  idle rate again once a brew has run for twenty minutes, for cold-brew steeps). Every fresh read the dashboard makes
  counts too, and a brew started from the app is re-read two seconds later. `HISTORY_ENABLED=false` in `.env` turns the
  background reads off; the log then only grows while a page is open.
- **What it logs.** One line per completed brew in `data/brews.jsonl`: start, end, duration, water, the profile
  selected on the brewer, whether the brew was watched or inferred, and the trace samples (phase, water temperature,
  heater, pump). Rules borrowed from the Home Assistant integration: a duration is trusted only when the brew was
  watched and the brew counter rose by exactly one; a counter that rose while nobody was watching (Mac asleep,
  service down) becomes an inferred brew with the brewer's own timestamps and no duration. Fellow never says which
  profile ran, so the log records the one that was selected on the brewer and the UI says so.
- **Time to go.** During a brew the live trace says about how long is left: measured from your previous watched
  brews of the same profile once there are any, and worked out from the recipe (bloom, an assumed pour rate, the
  pauses between pulses, a drip finish) until then. Fellow does not expose the brewer's own countdown.
- **Where it lives.** `data/` sits next to `logs/` in the working directory: the checkout for `pnpm start`, the
  installed copy under launchd. A reinstall keeps it; `uninstall.sh --purge` removes it. Nothing leaves this Mac.
- **Cleaning cycles.** The brewer announces a descale or rinse while it runs (and borrows the brew fields for it:
  1500 mL, a start time, `brewing: true`), so each cycle is logged to `data/cleanings.jsonl` with its start, end,
  duration, water, and how far the brew and water totals moved across it; a cycle never counts as a brew. The
  History page lists them, and the dashboard shows a banner while one runs and offers Mark descaled when one has
  just finished.
- **The descale tally.** Brews and litres since you pressed Mark descaled, a bar that turns amber at 80% and red at
  100% of `maintenance.descaleAfterLitres` (60 L to start; add `descaleAfterBrews` to count brews as well), and an
  estimate of the due date from the litres per day in the log, or since the last mark while the log is young. Until
  the first mark the tally counts from the brewer's lifetime totals. Marking writes only to `data/descale.json`.

## Quick start

Two pathways to the same result: the app running as a service that starts itself, reachable from your other
computers over Tailscale. Pick the one that matches the machine that will stay on. Every line goes into a terminal.

### On a Mac

Tested on Apple Silicon (macOS 26, M-series); an Intel Mac differs only in the Homebrew path noted below.

**1. Node 22 and pnpm.**

```sh
# Homebrew first, if you do not already have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node@22 pnpm
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc   # Intel Macs: /usr/local/opt/node@22/bin
exec zsh
node -v   # v22.x
pnpm -v   # 10.x
```

Already an nvm user? `nvm install 22 && nvm use 22`, then `corepack enable pnpm`. Node must live on the internal
disk: launchd will not start one from an external volume.

**2. The app and your Fellow login.**

```sh
git clone https://github.com/cschweda/aiden-portal.git ~/aiden-portal
cd ~/aiden-portal
pnpm install
cp .env.sample .env
chmod 600 .env     # it is about to hold your real Fellow password
nano .env          # fill in FELLOW_EMAIL and FELLOW_PASSWORD: the login you use in the Fellow phone app
```

**3. See it work, without touching the brewer.**

```sh
pnpm dev
```

Open `http://localhost:5150`. `fellow.dryRun` starts out `true`, so reads are live but every change is logged
instead of sent, and the header shows a DRY RUN badge. Ctrl-C stops it.

**4. Run it for real, at login.**

```sh
printf 'FELLOW_DRY_RUN=false\n' >> .env    # leave this out to stay in dry run

pnpm build
deploy/macos/install.sh
open http://localhost:5150
deploy/macos/status.sh
```

The installer copies the build and `.env` into `~/Library/Application Support/aiden-studio` and registers a launchd
agent that starts at login and restarts on a crash. Run those two commands again after any change to the code, to
`aiden.config.ts`, or to `.env`.

**5. Reach it from your other machines.**

```sh
brew install --cask tailscale
open -a Tailscale        # sign in with the account every machine will use
```

In the Tailscale admin console, once: under **DNS** turn on HTTPS certificates, and under **Machines** open this
Mac's menu and disable key expiry. Then publish the dashboard:

```sh
alias ts=/Applications/Tailscale.app/Contents/MacOS/Tailscale
ts serve --bg 5150
```

The first run prints a link to enable Serve for this machine; open it, approve, and run the command again. It then
prints the address, `https://<this-mac>.<your-tailnet>.ts.net`. Finish as described under **Both pathways** below.

### On Ubuntu 24.04 or newer

Server or desktop; the service is a systemd user unit either way. Run it as the ordinary user who will own the app,
not as root.

**1. Node 22 and pnpm.**

```sh
sudo apt update && sudo apt install -y curl git rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable pnpm
node -v   # v22.x
pnpm -v   # 10.x
```

Ubuntu's own `nodejs` package is older than 22, which is why this adds the NodeSource repository. `nvm install 22`
works just as well if you prefer a version manager; the installer records whichever node it finds.

**2. The app and your Fellow login.**

```sh
git clone https://github.com/cschweda/aiden-portal.git ~/aiden-portal
cd ~/aiden-portal
pnpm install
cp .env.sample .env
chmod 600 .env
nano .env          # FELLOW_EMAIL and FELLOW_PASSWORD
```

**3. See it work, without touching the brewer.**

```sh
pnpm dev
```

`http://localhost:5150` from that machine's own browser, or through the SSH tunnel below if it is headless. Dry run
is on, so nothing reaches the brewer. Ctrl-C stops it.

**4. Run it for real, at boot.**

```sh
printf 'FELLOW_DRY_RUN=false\n' >> .env    # leave this out to stay in dry run

pnpm build
deploy/linux/install.sh
deploy/linux/status.sh
```

The installer copies the build and `.env` into `~/.local/share/aiden-portal`, writes a systemd user unit, starts it,
and enables lingering so it runs whether or not you are logged in. On a headless box, if `systemctl --user` cannot
reach a manager, run `sudo loginctl enable-linger $USER`, log in again, and repeat. Run those two commands again
after any change to the code, to `aiden.config.ts`, or to `.env`.

**5. Reach it from your other machines.**

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                        # prints a link; open it and sign in
sudo tailscale set --operator=$USER      # so tailscale commands need no sudo from here on
```

In the Tailscale admin console, once: under **DNS** turn on HTTPS certificates, and under **Machines** open this
machine's menu and disable key expiry. Then publish the dashboard:

```sh
tailscale serve --bg 5150
```

The first run prints a link to enable Serve for this machine; open it, approve, and run the command again. It then
prints the address, `https://<this-machine>.<your-tailnet>.ts.net`. Tailscale itself runs as a system service and
comes back after a reboot with no further work.

### Both pathways: finish the Tailscale setup

Put the `ts.net` name the previous step printed into `server.allowedHosts` in `aiden.config.ts`, and, if you want to
be the only one who can change anything, your Tailscale login into `server.tailnetUsers` (`tailscale serve` stamps
the signed-in login on every request, and the app logs it). Keep both out of git by setting `ALLOWED_HOSTS` and
`TAILNET_USERS` in `.env` instead. Then rebuild and reinstall:

```sh
pnpm build && deploy/macos/install.sh      # or deploy/linux/install.sh
```

On every other machine, Mac, Windows, or phone: install Tailscale, sign in with the same account, open that
`https://` address. Nothing else to configure, and it works away from home too.

## Run at home

The service runs from an installed copy of the build, never from the checkout: a rebuild or a git operation must
never touch a running service, and on macOS an unattended process cannot read a removable volume at all, which is
what a checkout on an external disk is. Both installers copy `.output/`, `.env`, and `aiden.config.ts` into place
and leave `data/` and `logs/` alone, so brew history survives every reinstall.

| | macOS | Ubuntu |
|---|---|---|
| Supervisor | launchd user agent | systemd user unit |
| Install or refresh | `deploy/macos/install.sh` | `deploy/linux/install.sh` |
| Is it running? | `deploy/macos/status.sh` | `deploy/linux/status.sh` |
| Follow the app log | `deploy/macos/logs.sh` | `deploy/linux/logs.sh` |
| Stop and remove | `deploy/macos/uninstall.sh` | `deploy/linux/uninstall.sh` |
| Installed copy | `~/Library/Application Support/aiden-studio` | `~/.local/share/aiden-portal` |
| The supervisor's own log | `~/Library/Logs/aiden-studio/launchd.log` | `journalctl --user -u aiden-portal` |
| Starts by itself | at login | at boot, with lingering enabled |

Add `--purge` to either uninstaller to remove the installed copy, its logs, and the brew history too. The checkout
is never touched.

Both supervisors restart the app after a crash or a refused configuration, and wait 30 seconds before trying again,
so a misconfiguration cannot spin. The app enforces its own configuration: the startup guard exits rather than
listen anywhere but loopback, and the reason is printed where that platform keeps the service's output.

- **After editing `aiden.config.ts`:** rebuild and reinstall; it is compiled into the build.
- **After editing `.env`:** reinstall; the installer copies the file.
- **After changing Node versions:** reinstall. The service is pinned to the absolute path of the node it was
  installed with, and `status.sh` says so when that binary disappears.
- **While it is installed, port 5150 is taken.** The installers refuse to run when something else is listening
  there, so they can never mistake a dev server for the service. Run the dev server elsewhere meanwhile:
  `PORT=5151 pnpm dev`.
- **macOS only:** if the installer says `launchctl bootstrap` failed, open System Settings > General > Login Items &
  Extensions, make sure aiden-studio is switched on, and run the installer again. launchd never rotates its own log;
  it gains two lines per start and is safe to delete.
- **Ubuntu only:** `systemctl --user status aiden-portal` and `journalctl --user -u aiden-portal -f` are the direct
  equivalents of the status and logs scripts if you prefer them.

The app listens on `127.0.0.1` only. Nothing else on your Wi-Fi reaches it directly, by design: there is no login
screen. Your own machines reach it through Tailscale, below.

### From your other computers, with Tailscale (Phase 1.5)

[Tailscale](https://tailscale.com) joins your computers into a private network that only they can see, at home or
anywhere else with internet. The machine running the app publishes the dashboard onto that network with
`tailscale serve`, which forwards to the app on loopback, so the app itself never listens beyond that machine. Every
device signed in to your Tailscale account can then open

```
https://<your-machine>.<your-tailnet>.ts.net
```

with a real certificate and no port. `tailscale serve` prints the exact address when you publish; use that full name
as it gives it. The short name and the IP addresses the Tailscale console also lists do connect, but the certificate
is issued for the full name only, so browsers warn on them.

The setup is in the quick start above, for both platforms. On every other machine: install Tailscale, sign in with
the same account, open the address. That is all.

- **Mac:** the Mac App Store, or the download at tailscale.com; sign in from the menu bar icon.
- **Windows:** the installer at tailscale.com; approve the one prompt about changing network settings; sign in from
  the system tray icon.
- **Linux:** `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up`.
- **Phone:** the Tailscale app from the App Store or Play Store, same sign-in, same address in the browser.

**Away from home.** It works wherever the machine has internet: Tailscale connects the two devices directly across
the internet and falls back to its relays when a network blocks that, encrypted either way. The host machine has to
be on and running Tailscale, the same conditions the dashboard itself needs.

**If a machine cannot open it.** Check, in order: the Tailscale icon on that machine says connected; the host shows
as connected in the admin console; `tailscale serve status` on the host still lists the address; the host's
`status.sh` says the app is running. With the Logs page set to Detailed, every request shows the address it came in
on and the Tailscale login it carried.

Never use `tailscale funnel`, which is the public version, and never change `server.host`: the app stays on loopback
and Tailscale is the only door.

### Without Tailscale: an SSH tunnel from a machine on the same network

Without a login the app must stay on loopback, but another machine can reach that loopback through an SSH tunnel,
which keeps the brewer behind the host's own login. Enable remote login on the host first: on macOS, System
Settings > General > Sharing > Remote Login; on Ubuntu, `sudo apt install -y openssh-server`. Then, from the other
machine:

```sh
ssh -N -L 5150:127.0.0.1:5150 <your-account>@<your-host>.local
```

Leave that running and open `http://localhost:5150`. Use the host's IP address if the name does not resolve. Ctrl-C
ends the tunnel. Tailscale, above, is the better answer for phones and for being away from home; this tunnel is the
fallback when Tailscale is not installed.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server with hot reload |
| `pnpm build` | Production build into `.output/` |
| `pnpm start` | Run the production build (reads `.env` via `node --env-file`) |
| `pnpm test` | Full test suite |
| `pnpm lint` | ESLint, then `scripts/check-shell.sh` (bash syntax, shellcheck when installed, a render of the launchd template) |
| `pnpm typecheck` | `nuxt typecheck` plus the test tree |
| `scripts/smoke.sh` | Probes a production build for the things Vitest cannot see: guard, headers, Host/CSRF, error shapes, log file |
| `deploy/macos/*.sh`, `deploy/linux/*.sh` | Install, status, logs, uninstall for the launchd and systemd services (see Run at home) |

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
| `TAILNET_USERS` | Overrides `server.tailnetUsers` (comma-separated Tailscale logins allowed to make changes). |
| `LOG_LEVEL` | Overrides `logging.level`. |
| `HISTORY_ENABLED` | `false` stops the background reads that feed the brew log, the trace, and the descale tally. |
| `HISTORY_DIRECTORY` | Overrides `history.directory` (where `brews.jsonl` and `descale.json` are written). |

## API

Every route lives under `/api` and answers JSON. Mutations are POST, PATCH, or DELETE and must come from
this site: the browser proves it with `Sec-Fetch-Site: same-origin`; a script or `curl` must send
`Origin: http://localhost:5150` instead, or it gets a 403.

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
| `PATCH /api/logs/level` | body `{ level }`; switches the log level until the service restarts |
| `GET /api/history` | stats, the descale tally, the brew running now with its samples, the last traced brew, recent brews, the poller's state |
| `GET /api/history/brews/:id` | one logged brew with its trace samples |
| `POST /api/descale` | records that the brewer was descaled now; the tally restarts from its current totals |

Errors are `{ error, message?, issues? }`: 400 for validation, 502 for a Fellow failure (the code only,
never Fellow's response), 500 otherwise. Reads are cached for 30 seconds; `?fresh=1` bypasses the cache.

## Logs

In development everything goes to the terminal. In production pino writes JSON lines to
`logs/aiden.<date>.<n>.log` (an owner-only directory under the working directory: the checkout for `pnpm start`,
the installed copy under launchd), rotates daily or at 50 MB, keeps 14 files, and points `logs/current.log` at
the active one, so `tail -F logs/current.log` keeps following across rotations. Passwords, tokens, and
cookies are redacted before they are written. Every request carries an `x-request-id` header that matches
its log lines. The Logs page's Detail control switches the level being written (quiet, normal, detailed,
everything) until the service restarts; the persistent default is `logging.level` in `aiden.config.ts` or
`LOG_LEVEL` in `.env`. Stdout gets exactly two lines at startup: ours (address, dry run, log path) and Nitro's own
`Listening on …`; under launchd that is all its stdout file should ever hold, besides crash traces.

## Red team / blue team log

Newest entry first, open. Older entries are collapsed. Each entry records what was attacked (red), what was
found, and what now defends against it (blue). Add a new dated `###` entry at the top and move the previous
one into the `<details>` block at the bottom.

### 2026-09-12 — Third pass, the public demo and its headers

**Context.** Two things happened at once: the repository became public, and a demo went up at
`aiden-portal.netlify.app` with a Content-Security-Policy of its own that had to be loosened to let a static build
start itself. So: does the demo give anything away, and did loosening its policy weaken the app that controls a
real brewer?

**Red — what was tried**

- **Reach a server on the demo.** `/api/status` and `/api/device` answer 404 by rule. The published output holds no
  server bundle at all.
- **Read files that should not be served.** `/.env`, `/server/index.mjs`, `/package.json` and `/app/demo/api.ts`
  all come back 200 — and all of them are the page itself, `text/html`. The single-page redirect answers every
  unknown path, which makes a status code meaningless; each was judged by content type and body instead.
- **Collect the source.** `/_nuxt/<chunk>.js.map` is the fallback page too: the build publishes no source maps.
- **Find real data in the bundle.** The tailnet name, the Mac's hostname, the owner's Tailscale login, the checkout
  path, Fellow's API host, and the brewer's serial and MAC address: none of them appear in any published asset. The
  single hit for `FELLOW_PASSWORD` is the text of an error hint, "Check FELLOW_EMAIL and FELLOW_PASSWORD in .env",
  with no value anywhere near it.
- **Carry the relaxed policy into the real app.** It cannot: it lives in `netlify.toml`, which only Netlify reads.
  The app's own response still carries a per-request nonce with `strict-dynamic`.

**Blue — what defends it now**

- **A demo build contains no server.** `server/api`, `server/middleware`, and `server/plugins` are left out of it,
  so there is nothing to reach, nothing that wants credentials, and it builds on a machine with no `.env` at all.
- **The headers Netlify sends**: HSTS with preload, `frame-ancestors 'none'` alongside `X-Frame-Options: DENY`,
  `nosniff`, `no-referrer`, camera, microphone and location switched off, and `connect-src 'self'` so the page
  cannot call anywhere else.
- **One deliberate relaxation.** `script-src` allows `'unsafe-inline'`, because a static build boots from an inline
  script that carries its configuration. That is a real weakening of that page's policy and it is accepted on its
  merits: the demo has no accounts, takes no input from anyone, holds no data, and there is nothing on that origin
  to steal. The app that talks to the brewer keeps its nonce-based policy, which it can afford because it has a
  server to generate nonces.
- **The demo's data is invented**, down to the serial number and the MAC address.

**Accepted for now.** Unknown paths answer 200 with the page, which is how a single-page app works. Hashed assets
are cached for a year as immutable, which is what content hashes are for. The real app's own policy includes
`'unsafe-inline'` as a fallback beside `'strict-dynamic'` and the nonce, which is nuxt-security's default: browsers
that understand `strict-dynamic` ignore it, older ones fall back to it.

<details>
<summary>Older entries</summary>

### 2026-09-12 — Second pass, when the app left the Mac (Phase 1.5)

**Context.** Until now the only way to reach the app was to sit at the Mac, and the first pass said plainly that a
proxy in front of it would bypass that. Tailscale is now exactly such a proxy: `tailscale serve` accepts the
connection and speaks to the app from 127.0.0.1, so it looks like the owner. The question for this pass is what
replaces "you are sitting at the Mac" as the thing being trusted.

**Red — what was tried**

- **Reach the app from the house network.** Port 443 answers on the Tailscale address (100.94.68.74) and is
  closed on the Wi-Fi address and on loopback. Port 5150 is still bound to 127.0.0.1 alone.
- **Find the address from outside.** The `ts.net` name does not resolve on public DNS; it exists only inside the
  tailnet's own resolver. `tailscale funnel`, which would publish it, is never used and is documented as forbidden.
- **Answer to a borrowed hostname.** The Host allowlist names the `ts.net` host explicitly; every other value is
  still a 400, so a DNS record someone else points at the machine gets nothing.
- **Act as the owner from another tailnet device.** `tailscale serve` stamps `Tailscale-User-Login` on every
  request it forwards. Changes from a login that is not in `server.tailnetUsers` are refused with 403
  (`tailnet_user_not_allowed`); reads are left alone.
- **Forge that header from a browser on the Mac.** Browsers cannot set it, and every mutation still has to prove
  same-origin or carry an allowed Origin, so the same-site rule remains the gate it was.

**Blue — what defends it now**

- **The bind address is unchanged.** The app binds 127.0.0.1 and the startup guard still refuses anything else.
  Tailscale carries traffic between machines; the app never listens beyond this one.
- **The tailnet is the authentication.** Joining it means signing in to the owner's Tailscale account.
  `server.tailnetUsers` narrows that further: a device on the tailnet that is not the owner's login may look at
  the brewer but not change it.
- **Every request is attributable.** The Tailscale login and the host it arrived on are logged with each request,
  and the Logs page's Detail control shows them without a restart.
- **TLS is real off-machine.** Let's Encrypt issues the certificate for the machine's `ts.net` name, so the
  plain-http compromises that loopback allowed do not travel with it.

**Accepted for now.** Any signed-in device of the owner's is trusted to read, so an unlocked device that is
already on the tailnet can see the brewer. A login inside the app is the answer to that, and is only worth
building if this ever has to be reachable by someone who is not the owner.

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
  a proxy in front of it would bypass the whole model, which is why nothing may be put in front of the app
  unless it carries an identity check of its own.
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

</details>

## Project layout

- `server/lib/fellow/` — the Fellow client. Pure TypeScript, no Nuxt imports, so it can become its own package.
- `aiden.config.ts` — every non-secret setting; `server/utils/config.ts` merges it with `.env` and is the only place `process.env` is read.
- `server/api/` — thin Nuxt server routes over the client; `server/middleware/` is the request pipeline.
- `app/` — the Nuxt UI front end: `pages/`, `components/`, `composables/`, and `utils/` (pure, unit-tested logic such as the profile form rules and time conversion).
- `tests/` — Vitest, with msw standing in for Fellow.
- `scripts/mock-fellow.mjs` — an in-memory Fellow API for development and demos.
- `deploy/` — running it as a service: `macos/` (launchd) and `linux/` (systemd), over shared helpers in `deploy/common.sh`.

See `ARCHITECTURE.md` for the layer split and the list of API behaviors that are inferred rather than verified.

## Hat tip: fellow-aiden

This project stands on the shoulders of [fellow-aiden](https://github.com/9b/fellow-aiden) by
[9b](https://github.com/9b), the Python library that first worked out how to talk to the Aiden, and of the
[Fellow Aiden Home Assistant integration](https://github.com/kristofferR/FellowAiden-HomeAssistant), whose
maintained client documents the v2 API: the refresh-token flow, the `overallTemperature` profile field,
brew.link drop types, remote Instant Brew, and the device state that gates it. Fellow documents none of this.
Everything aiden-portal knows about the endpoints, the required headers, the profile and schedule validation
rules, and the server-side fields was learned from those two projects. aiden-portal is an independent
TypeScript implementation that ports the behavior rather than the code, but if it is useful to you, the credit
belongs upstream. Both projects are licensed under GPL-3.0.

## License

MIT. See `LICENSE`.
