# Phase 2: running aiden-studio on a DigitalOcean droplet

Not built. This is the list of what changes when the app leaves the Mac, so that Phase 2 is a deliberate
piece of work rather than a surprise. Everything not listed here stays exactly as it is in Phase 1.

## The one hard rule

**Phase 1 has no login. It is safe only because the server listens on the loopback interface of a machine
you sit at.** The startup guard enforces that bind address, and it is the only thing it can see: a reverse
proxy (Nginx) or `tailscale serve` connects to the app from 127.0.0.1 and looks exactly like you. Putting
either in front of the Phase 1 build would expose your brewer to whoever can reach the proxy.

So: **an auth layer is added in code before anything else in this document happens.** Phase 2 is the one
place the "host and env vars only" migration rule is broken on purpose.

## The auth layer (design, recommended first)

The simplest design that fits a single owner:

- A login page that asks for a password. The secret is the Fellow account password already in `.env`,
  compared with a timing-safe comparison; no users table, no new secret to manage.
- A [nuxt-auth-utils](https://github.com/atinux/nuxt-auth-utils) sealed, `httpOnly`, `secure`, `sameSite=lax`
  session cookie, with `NUXT_SESSION_PASSWORD` (32+ characters) in `.env`.
- One server middleware that requires the session on every `/api` route except the login route and
  `/api/health`, added to the existing pipeline *before* the same-site rule. Never per-route checks.
  The API is what this protects; the page shells hold no data (every read goes through `/api`), but they would
  still render for an anonymous visitor, so add a route middleware that sends them to the login page.
- The login route rate-limited in memory (5 attempts per 15 minutes per client IP), behind an interface so
  it could move to Redis later.
- The startup guard changes from "loopback only" to "loopback only unless auth is enabled", driven by a new
  `auth.enabled` flag in `aiden.config.ts`.
- Logout button in the sidebar footer; the `/logs` page stays owner-only by virtue of the login.

If invited users ever need their own identities, replace the single password with a small SQLite users
table (argon2id hashes, `pnpm user:add <email>`), keeping everything else above.

## What changes on the droplet

- **Runtime.** Node 22 and pnpm 10 on the droplet; same `pnpm build`; the same command launchd runs
  (`node --env-file=.env .output/server/index.mjs`) as a systemd unit or a Forge daemon, with
  `WorkingDirectory` set to a release directory (a copy of `.output/` and `.env` refreshed by an install script,
  as `deploy/local/install.sh` does on the Mac; never the checkout, for the same reason as in Phase 1) and
  `Restart=on-failure`, `RestartSec=30`.
- **Bind address.** `HOST` stays `127.0.0.1`. Nginx (via Laravel Forge) listens on 443, terminates TLS with
  a Let's Encrypt certificate, and proxies to `127.0.0.1:5150` with `proxy_set_header Host $host` and
  `X-Forwarded-For $proxy_add_x_forwarded_for`.
- **Hosts.** `ALLOWED_HOSTS=<the droplet's hostname>` (or `server.allowedHosts` in `aiden.config.ts`).
- **Client IP.** Read `X-Forwarded-For` only when the connection comes from loopback (the proxy), for the
  rate limiter and the logs. Not needed in Phase 1 and deliberately absent.
- **Cookies.** `secure: true` (TLS is real now).
- **Data.** `data/` (the brew log and the descale marker) lives in the working directory like `logs/`; keep it across
  releases, and back it up with the rest of the release directory.
- **Headers.** Turn `upgrade-insecure-requests` back on in `nuxt.config.ts`; Phase 1 turns it off because on any
  name other than `localhost` the browser would upgrade the app's own assets to https and fail.
- **Secrets.** `.env` copied to the droplet by hand, `chmod 600`, owned by the service user; never in the repo.
- **Logs.** pino-roll keeps rotating in `logs/`; Forge's log viewer or `journalctl -u aiden-studio` for the
  process itself.
- **Access choice.** Either public HTTPS behind the login and rate limiter, or Tailscale-only
  (`tailscale serve` to 127.0.0.1:5150, or Nginx bound to the tailnet IP). **Auth is required in both.**

## Pre-flight checklist

1. Auth layer merged, with tests in both modes (`auth.enabled` true and false), and the guard test for
   "non-loopback host with auth disabled refuses to start".
2. `pnpm build` on the droplet, `scripts/smoke.sh` green there (it needs the port and host adjusted).
3. `.env` on the droplet: Fellow credentials, `NUXT_SESSION_PASSWORD`, `ALLOWED_HOSTS`; `chmod 600`.
4. Nginx config reviewed: TLS only, HTTP redirected to HTTPS, proxy headers set, no exposure of port 5150.
5. First login from a phone over the public address; `/api/health` answers; `logs/current.log` shows the
   request ids from the proxy.
6. Add a dated entry to the README's red team / blue team log for the droplet pass.
