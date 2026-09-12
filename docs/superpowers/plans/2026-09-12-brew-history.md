# Brew history, trace, and descale tally: implementation plan

**Spec:** `docs/superpowers/specs/2026-09-12-brew-history-design.md`. Executed inline in the session that wrote
it, task by task, tests first where the unit is pure, one review at the end, released as 0.7.0.

- [x] **1. Config.** `AidenConfigSchema` gains `history` and `maintenance`; `aiden.config.ts`, the test fixture,
  `parseEnv` (with `HISTORY_ENABLED`, `HISTORY_DIRECTORY`), `.env.sample`, and the config tests follow.
- [x] **2. Types and store.** `server/lib/history/{types,store}.ts` with tests in a temp directory: append and
  reload brews, skip a corrupt line, atomic descale write, permissions.
- [x] **3. Tracker.** Pure state machine with tests: start, samples, completion counted and uncounted, inferred
  brews (single, burst capped at five), restart baseline from the last record, unknown brewing state ignored.
- [x] **4. Stats and descale.** Pure functions with tests at a fixed now: day, week (Sunday), month boundaries;
  averages only from counted brews; favourite profile; descale levels and the due estimate paths.
- [x] **5. Poller and routes.** `useHistory()`, the Nitro plugin with backoff, `GET /api/history`,
  `GET /api/history/brews/:id`, `POST /api/descale`; route tests via the in-process app and msw.
- [x] **6. Mock.** Phase progression, temperatures, counter increment, brewStartTime/brewEndTime on the mock.
- [x] **7. UI.** Shared types, `DescaleCard`, `HistoryStrip`, `BrewTraceChart` (dataviz guidance), the History
  page and nav item, dashboard wiring with a 5 s history poll while a brew runs.
- [x] **8. Docs and release.** README, ARCHITECTURE (with UNVERIFIED rows), CHANGELOG 0.7.0, `install.sh` data
  directory, smoke script `HISTORY_ENABLED=false`, review subagent, lint/typecheck/test/build/smoke, reinstall.

---

## Review and fixes (2026-09-12)

The review of `46ced72..1b4dbe2` found no Critical issues and five Important ones, all fixed before the 0.7.0 tag:

1. A brew first seen mid-way (restart, wake from sleep) got a trusted duration from the first read. `CurrentBrew`
   now records how the start was learned (`transition`, `device`, `first-read`); only the first two yield a duration.
2. `useHistory()` did filesystem work in its constructor and `GET /api/device?fresh=1` and `POST /api/brew/start`
   depended on it. The store now reports `loadError` instead of throwing on load, writes that fail are recorded in
   `polling.lastError` and logged once per streak, the plugin never throws, and both routes treat the history as
   best effort. `POST /api/descale` answers 409 when the store is unusable or the brewer reports no totals.
3. The store chmod'ed any existing directory to 0700. It now only tightens a directory it created and reports an
   existing shared one, which the service logs.
4. Route tests wrote `data/` into the checkout; `useTestEnv` now gives every test its own temp directory.
5. A stuck `state` kept a brew open forever. A brew older than a day is closed uncounted and watching restarts;
   samples are thinned past 2000.

Also from the review: a poke during an in-flight tick is remembered; observations are stamped when the answer
arrives and older ones are ignored; a completion without a counter reading no longer causes a duplicate inferred
brew; zero-length gaps are left out of the between-brews average; the marker file is fsynced and a torn last log
line is repaired before the next append; the history route skips the Fellow read while the poller is failing;
`not_found` for an unknown brew; snapshot types moved out of the auto-imported utils; chart ticks for multi-hour
steeps and no labels on sliver bands; the due date carries its year; docs corrected. A fake-timer test now covers
the poller's cadence, backoff, poke, and brew sampling.
