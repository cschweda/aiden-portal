# Checkpoint 4: Deploy and Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production build run at login on the owner's Mac under launchd, restart on crash, and log to `logs/`; document how to run, update, and remove it; write the Phase 2 migration notes; close out the documentation.

**Architecture:** A LaunchAgent plist template plus `install.sh` / `uninstall.sh` in `deploy/local/`. The plist runs `node --env-file=.env .output/server/index.mjs` from the repo directory with an absolute node path, `NODE_ENV=production`, and stdout/stderr to `logs/launchd.log`. The app itself already pins the bind address, rotates its own log, and refuses to start when misconfigured; launchd only supervises.

**Spec:** `docs/aiden-studio-build-prompt.md` §2 (Phase 1 launchd, Phase 2 stub), §9 checkpoint 4, §10 (`deploy/local/`, README "Run at home", `docs/PHASE-2.md`).

> **Execution notes (2026-09-10).** Done and tagged `v0.4.0`. One design change during execution: the checkout lives on an external SSD, and macOS refuses unattended (launchd-spawned) processes any access to removable volumes, so a job pointed at the checkout failed before node ran (launchd's stdout file: exit code 78) and after (node: "Operation not permitted"). The service therefore runs from an installed copy of `.output/` and `.env` under `~/Library/Application Support/aiden-studio`, with launchd's own stdout under `~/Library/Logs/aiden-studio/`. Verified on this Mac against the mock brewer: install, health, crash restart after the 30 s throttle, `status.sh`, `uninstall.sh --purge`.

## Global Constraints

- No secrets in the plist; they come from `.env` via `--env-file`.
- launchd has no shell, no `PATH`, no working directory: absolute node path, `WorkingDirectory` set, `logs/` created before bootstrap.
- Restart on crash (`KeepAlive` with `SuccessfulExit: false`, `ThrottleInterval` 30) so a misconfiguration does not spin.
- The installer refuses to proceed without a build or a `.env`, and warns when `.env` is readable by others.
- Commit messages carry no AI co-author trailer.

---

### Task 1: LaunchAgent template and installer

**Files:** `deploy/local/com.cschweda.aiden-studio.plist.template`, `deploy/local/install.sh`, `deploy/local/uninstall.sh`, `deploy/local/status.sh`.

- [ ] Template placeholders: `__NODE__`, `__REPO__`, `__LABEL__`. Keys: `Label`, `ProgramArguments` (`__NODE__`, `--env-file=.env`, `.output/server/index.mjs`), `WorkingDirectory`, `EnvironmentVariables` (`NODE_ENV=production` only), `RunAtLoad`, `KeepAlive` `{ SuccessfulExit: false }`, `ThrottleInterval` 30, `StandardOutPath` / `StandardErrorPath` (`__REPO__/logs/launchd.log`), `ProcessType` `Background`.
- [ ] `install.sh`: `set -euo pipefail`; repo root from the script's location; require `.output/server/index.mjs` ("run pnpm build first") and `.env`; warn on `.env` mode other than 600; resolve `node` (respect `AIDEN_NODE` override, else `command -v node`), require major ≥ 22; `mkdir -p logs`; render the template with `sed` (escape `/`, `&`); write `~/Library/LaunchAgents/<label>.plist`; `launchctl bootout gui/$UID/<label>` if loaded (ignore failure); `launchctl bootstrap gui/$UID <plist>`; poll the health URL (host/port from `.env` `HOST`/`PORT` if set, else parsed from `aiden.config.ts`) for up to 20 s; print where to look on failure.
- [ ] `uninstall.sh`: bootout, remove the plist, say the logs and build are untouched.
- [ ] `status.sh`: `launchctl print` summary (pid, last exit status), health check, last lines of `logs/launchd.log` and `logs/current.log`.
- [ ] Verify on this Mac against the mock: temporary `.env` (`FELLOW_BASE_URL=http://127.0.0.1:3900/v2`, demo credentials), stop the demo server on port 3000, run `install.sh`, confirm `launchctl print` shows a pid, health answers, `logs/launchd.log` holds the two startup lines, `logs/current.log` exists; `kill -9` the pid and confirm launchd restarts it; run `uninstall.sh`; delete the temporary `.env`. Commit `feat(deploy): launchd LaunchAgent with installer, uninstaller, and status script`.

### Task 2: README "Run at home"

- [ ] Section covering: build, `deploy/local/install.sh`, open `http://localhost:3000`, `tail -f logs/current.log`, `deploy/local/status.sh`; what launchd does (starts at login, restarts on crash, throttled 30 s); updating (`git pull`, `pnpm install`, `pnpm build`, `launchctl kickstart -k gui/$UID/com.cschweda.aiden-studio`); changing `aiden.config.ts` or `.env` needs a rebuild or a kickstart respectively; uninstalling; troubleshooting (misconfiguration loops every 30 s and the reason is in `logs/launchd.log`; the guard refuses a non-loopback host; `node` must be on the login shell's path or set `AIDEN_NODE`). Note the app is reachable only on this Mac and that Phase 2 covers other devices. Status line → "Phase 1 complete".

### Task 3: `docs/PHASE-2.md`

- [ ] What changes for a DigitalOcean droplet, and nothing else: same build; Node 22 and pnpm 10 on the droplet; a systemd unit or Forge daemon replacing launchd (same command); Nginx via Forge in front, TLS from Let's Encrypt, `HOST` stays `127.0.0.1` behind it; **an auth layer is required before anything leaves loopback** (recommended design: a single password gate whose secret is the Fellow password already in `.env`, nuxt-auth-utils sealed cookie, rate-limited login, secure cookies; or a small users table if invited users need identities) and the startup guard changes to "loopback only unless auth is enabled"; `ALLOWED_HOSTS=<droplet hostname>`; read the client IP from `X-Forwarded-For` behind the loopback proxy; Tailscale-only alternative; logs (pino-roll keeps rotating; Forge log viewer optional); `.env` on the droplet with `chmod 600`; a pre-flight checklist. State in bold that the guard cannot see a proxy.

### Task 4: Final docs and version

- [ ] ARCHITECTURE: "Deployment" section (launchd, what the app enforces vs. what launchd supervises). CHANGELOG `[0.4.0]`. `package.json` 0.4.0. Spec §9 checkpoint 4 tick and a one-line "Phase 1 complete" note. Plan execution notes. Mention `docs/aiden-studio-build-prompt.v1.md` as safe to delete in the report, not in the repo.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && scripts/smoke.sh`. Commit `docs: run at home, Phase 2 notes, 0.4.0`, tag `v0.4.0`.

---

## Review and fixes (2026-09-12, v0.4.1)

The checkpoint 4 review (range `ceb57a3..f8f3686`) found no Critical issues and four Important ones, fixed in
`v0.4.1` together with the cheap Minor ones:

1. The health poll could not tell the service from another server on the port. The installer now refuses while
   anything answers at the target URL after the old service is gone, so a health answer after bootstrap is ours.
2. `app_url` read the checkout's `aiden.config.ts`; it now reads the installed copy's `.env` and config (with
   `NITRO_*` precedence and bracketed IPv6), and the installer refuses when `aiden.config.ts` is newer than the
   build, so the copy always matches what was compiled in.
3. Re-install over a running service was unverified and could race `bootout`; the installer now waits until
   launchd has dropped the job (10 s cap) and explains a failed `bootstrap`.
4. A node deleted by an nvm upgrade left launchd silent; `status.sh` reads the pinned path from the plist and says
   when it is gone, and the README says to re-run the installer after changing node versions.

Also: render, lint, then move for the plist, with XML escaping; `--purge` removes the launchd log directory;
owner-only launchd log directory; `tail -F`; `logs.sh` falls back to the launchd log; node resolved through
`process.execPath`; `scripts/check-shell.sh` in `pnpm lint`. Documented rather than changed: `launchd.log` is
not rotated.

Verified live on this Mac against the mock brewer (temporary `.env`, removed afterwards): the installer refused
while a production run from the checkout held port 3000 (nothing created); refused after `touch aiden.config.ts`;
installed cleanly (health answered, pid recorded); installed again over the running service (new pid, health
answered); `status.sh` reported loaded and running with version 0.4.1 and the mock reachable; `logs.sh` followed
the app log; permissions 700/700/600/700; `uninstall.sh --purge` removed the copy, the plist, and the launchd log
directory; a stale plist with a missing node produced both warnings from `status.sh`.
