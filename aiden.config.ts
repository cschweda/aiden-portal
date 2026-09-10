import { defineAidenConfig } from './server/utils/aiden-config'

/**
 * aiden-studio configuration: the single source of truth for every setting that is not a secret.
 *
 * Edit this file, then build. It is compiled into each `pnpm dev` / `pnpm build`, so a change needs a
 * restart or a rebuild to take effect. Secrets (your Fellow email and password) never belong here; they
 * live in `.env` (see `.env.sample`). A few keys can be overridden for a single run by the optional
 * variables in `.env.sample`; leave those blank to use what is written here.
 */
export default defineAidenConfig({
  app: {
    // Shown in the page title and the startup line.
    name: 'aiden-studio',
  },

  server: {
    // Where the app listens. Phase 1 has no login screen, so this MUST stay a loopback address
    // (127.0.0.1, ::1, or localhost); the startup guard refuses anything else. Open the app at
    // http://<host>:<port>. Applies to `pnpm dev` and to the production build alike.
    host: '127.0.0.1',
    port: 3000,
    // Hostnames the app will answer to, exactly as browsers put them in the Host header (port is
    // ignored, IPv6 goes in brackets). Anything else gets a 400. This closes DNS-rebinding attacks.
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
  },

  fellow: {
    // true: every profile, schedule, and brew-start change is logged instead of sent to Fellow, and the
    // UI shows a DRY RUN badge. Reads still go through. Flip to false once you trust the app.
    dryRun: true,
    // IANA time zone sent to Fellow at login, as the phone app does. null = this machine's zone.
    timezone: null,
    // Fellow's cloud API, as used by the official app. There is no documented API; this is it.
    baseUrl: 'https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v2',
    // Give up on a single Fellow request after this long.
    timeoutMs: 15_000,
    // Retries for reads and deletes only (408, 5xx, network errors), with exponential backoff and jitter.
    // Creates and updates are never retried: a repeated POST could create a duplicate profile.
    retry: { attempts: 3, backoffBaseMs: 250 },
    // Device, profile, and schedule reads are reused for this long before Fellow is asked again. Any change
    // you make clears it immediately. Keeps the dashboard from hammering an unofficial API.
    cacheTtlMs: 30_000,
  },

  logging: {
    // fatal | error | warn | info | debug | trace | silent. null = info in production, debug in development.
    level: null,
    // Production log directory (relative to the repo). Files rotate daily; `current.log` points at today's.
    directory: 'logs',
    // How many daily files to keep.
    keepDays: 14,
    // A file also rotates when it reaches this many megabytes, so a noisy day cannot fill the disk.
    maxFileMb: 50,
  },

  ui: {
    // Default appearance: 'dark', 'light', or 'system'. The user can still toggle it in the app.
    colorMode: 'dark',
    // Ask for confirmation before a remote Instant Brew start.
    confirmBrewStart: true,
  },
})
