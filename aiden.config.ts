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
    port: 5150,
    // Hostnames the app will answer to, exactly as browsers put them in the Host header (port is
    // ignored, IPv6 goes in brackets). Anything else gets a 400. This closes DNS-rebinding attacks.
    // Add your own machine's Tailscale name here, or keep it out of git by setting ALLOWED_HOSTS in .env
    // (which replaces this whole list).
    allowedHosts: ['localhost', '127.0.0.1', '[::1]', 'aiden.local', 'aiden.localhost'],
    // Requests that arrive through `tailscale serve` carry the signed-in Tailscale login. When this list is not
    // empty, only these logins may make changes (start a brew, edit profiles or schedules, mark descaled); anyone
    // else on the tailnet can still look. The login is the one shown in the Tailscale admin console. Empty means
    // any member of your tailnet; TAILNET_USERS in .env sets it without committing your login.
    tailnetUsers: [],
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
    // Production log directory, relative to the working directory: the checkout under `pnpm start`, the installed
    // copy under launchd. Files rotate daily; `current.log` points at today's.
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

  history: {
    // The brew log (brews.jsonl) and the descale marker (descale.json), relative to the working directory, like
    // `logging.directory`. Under launchd that is the installed copy; a reinstall keeps it, `uninstall.sh --purge`
    // removes it.
    directory: 'data',
    // The service reads the brewer this often while it is idle, to notice brews and keep the dashboard fresh.
    // 60 is about 1,500 reads a day against an unofficial API. HISTORY_ENABLED=false in .env stops the polling.
    idlePollSeconds: 60,
    // And this often during a brew, which sets the resolution of the brew trace.
    brewPollSeconds: 5,
  },

  maintenance: {
    // Litres through the brewer since you last pressed "Mark descaled". The Aiden prompts on its own at 150 L,
    // which takes no account of how hard the water is; this threshold is the hardness-aware one. Lake Michigan
    // water, as supplied to Chicago and much of DuPage County, runs about 8 grains per gallon, or 137 mg/L as
    // calcium carbonate: the low end of "hard". Fellow advises descaling monthly at that hardness, which is
    // roughly 30 L at a batch brew a day. Raise it for softer water, lower it for a well supply.
    descaleAfterLitres: 30,
    // A brew-count threshold as well, off by default: scale comes from the water that passes through the brewer,
    // and a cycle count cannot tell a 300 mL single serve from a 1.5 L carafe. Set a number above 0 to use it,
    // in which case whichever threshold is reached first decides.
    descaleAfterBrews: 0,
    // The dashboard says how long the coffee has been sitting in the carafe, from the end of the brew until the
    // carafe is lifted out. After this many minutes it stops calling it fresh.
    coffeeFreshMinutes: 30,
  },
})
