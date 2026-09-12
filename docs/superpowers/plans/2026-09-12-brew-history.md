# Brew history, trace, and descale tally: implementation plan

**Spec:** `docs/superpowers/specs/2026-09-12-brew-history-design.md`. Executed inline in the session that wrote
it, task by task, tests first where the unit is pure, one review at the end, released as 0.7.0.

- [ ] **1. Config.** `AidenConfigSchema` gains `history` and `maintenance`; `aiden.config.ts`, the test fixture,
  `parseEnv` (with `HISTORY_ENABLED`, `HISTORY_DIRECTORY`), `.env.sample`, and the config tests follow.
- [ ] **2. Types and store.** `server/lib/history/{types,store}.ts` with tests in a temp directory: append and
  reload brews, skip a corrupt line, atomic descale write, permissions.
- [ ] **3. Tracker.** Pure state machine with tests: start, samples, completion counted and uncounted, inferred
  brews (single, burst capped at five), restart baseline from the last record, unknown brewing state ignored.
- [ ] **4. Stats and descale.** Pure functions with tests at a fixed now: day, week (Sunday), month boundaries;
  averages only from counted brews; favourite profile; descale levels and the due estimate paths.
- [ ] **5. Poller and routes.** `useHistory()`, the Nitro plugin with backoff, `GET /api/history`,
  `GET /api/history/brews/:id`, `POST /api/descale`; route tests via the in-process app and msw.
- [ ] **6. Mock.** Phase progression, temperatures, counter increment, brewStartTime/brewEndTime on the mock.
- [ ] **7. UI.** Shared types, `DescaleCard`, `HistoryStrip`, `BrewTraceChart` (dataviz guidance), the History
  page and nav item, dashboard wiring with a 5 s history poll while a brew runs.
- [ ] **8. Docs and release.** README, ARCHITECTURE (with UNVERIFIED rows), CHANGELOG 0.7.0, `install.sh` data
  directory, smoke script `HISTORY_ENABLED=false`, review subagent, lint/typecheck/test/build/smoke, reinstall.
