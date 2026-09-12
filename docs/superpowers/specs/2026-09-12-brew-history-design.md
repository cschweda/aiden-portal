# Brew history, brew trace, and descale tally

Approved by the owner on 2026-09-12 (design in chat; threshold 60 L; idle polling every 60 s; a Mark descaled
button that resets the tally; an estimate of when descaling is due, because Chicago's Lake Michigan water is hard).

## What it adds

1. **A poller inside the service.** Reads the brewer every 60 s when idle and every 5 s during a brew (every 60 s
   again once a brew has run for 20 minutes, for cold-brew steeps). Its fresh reads also warm the client cache.
   Fellow failures back off exponentially to 15 minutes and are logged once per streak.
2. **A brew log** in `data/brews.jsonl`, next to `logs/`: one JSON line per completed brew with start, end,
   duration, water (mL), the profile selected on the brewer, whether it was watched live or inferred from the
   brew counter, and the trace samples. `data/` lives in the working directory: the checkout for `pnpm start`,
   the installed copy under launchd, where a reinstall keeps it and only `uninstall.sh --purge` removes it.
3. **Stats**: brews and water today, this week (Sunday start, as Fellow numbers schedule days), this month, and
   all time in the log; average brew length; average time between brews; most-used profile.
4. **A brew trace**: while a brew runs, each poll records phase, water temperature, heater, and pump. Drawn as a
   temperature line over elapsed time with shaded phase bands. Live on the dashboard during a brew, the last
   brew afterwards, any brew on the History page.
5. **A descale tally**: brews and litres since the owner last pressed Mark descaled, a bar that turns amber at
   80% and red at 100% of the threshold in `aiden.config.ts`, and an estimate of the due date from the recent
   brewing pace. Until the first mark it counts from the brewer's lifetime totals. The mark is written only to
   `data/descale.json`; nothing is sent to Fellow.

## Rules borrowed from the Home Assistant integration

- A brew's duration is trusted only when the poller saw it running and the brew counter rose by exactly one.
- `brewStartTime` and `brewEndTime` are shown, never subtracted, for brews the poller did not watch.
- The live phase comes from `state.value`: `b` bloom, `p1`…`p10` pulse, `d` drip finish, `pa` paused.

## Components

| Unit | Responsibility |
|---|---|
| `server/lib/history/types.ts` | `BrewRecord`, `TraceSample`, `DescaleMarker`, `DescaleState` |
| `server/lib/history/store.ts` | `HistoryStore`: load and append `brews.jsonl`, read and atomically write `descale.json`, 0700/0600 permissions |
| `server/lib/history/tracker.ts` | `BrewTracker`: pure state machine from device reads to events (started, sample, completed, inferred) |
| `server/lib/history/stats.ts` | `computeStats(records, now)`: periods, averages, favourite profile |
| `server/lib/history/descale.ts` | `descaleStatus(marker, device, thresholds, records, now)`: counts, level, due estimate |
| `server/utils/history.ts` | `useHistory()`: the process-wide store, tracker, poller state; `resetHistoryForTests()` |
| `server/plugins/10.history.ts` | Starts the poll loop unless `HISTORY_ENABLED=false` |
| `server/api/history.get.ts` | Stats, descale status, current brew with samples, recent brews without samples, poller state |
| `server/api/history/brews/[id].get.ts` | One brew with its samples |
| `server/api/descale.post.ts` | Mark descaled now (same-site rule applies) |
| `app/components/DescaleCard.vue` | Tally, bar, estimate, Mark descaled with confirmation |
| `app/components/BrewTraceChart.vue` | Inline SVG: temperature line, phase bands, elapsed-time axis |
| `app/components/HistoryStrip.vue` | Today / this week / this month / favourite tiles for the dashboard |
| `app/pages/history.vue` | Stats, trace of the selected brew, brew table, descale history |

## Configuration

`aiden.config.ts` gains `history: { directory: 'data', idlePollSeconds: 60, brewPollSeconds: 5 }` and
`maintenance: { descaleAfterLitres: 60, descaleAfterBrews: 0 }` (0 disables the brew threshold). `.env` gains
two optional overrides: `HISTORY_ENABLED` (false stops the poller; the smoke script uses it) and
`HISTORY_DIRECTORY` (tests point it at a temporary directory).

## Inference rules

- The baseline brew count is the last poll that saw the brewer idle, or the `cyclesAfter` of the last stored
  record after a restart. A higher count while idle means brews the poller did not watch (Mac asleep, service
  down): one inferred record per missing brew (at most five per poll), start and end from the brewer's own
  timestamps, duration null, water only for the latest one.
- A brew observed live is completed when the brewer reads idle again; `counted` is true when the count rose by
  exactly one, and only counted brews contribute to the duration and between-brew averages.
- The profile is `ibSelectedProfileId` at the first brewing poll; its title is resolved from the cached profile
  list. The UI labels it "selected profile" because Fellow never says which profile actually ran.

## Descale estimate

Pace is litres per day over the brews logged in the last 30 days. With fewer than three brews or fewer than
three days of log, the pace since the marker is used; without a marker either, there is no estimate yet. The
estimate is `now + remaining litres / pace`, or "due now" when the threshold is reached.

## Testing

Unit tests for the store (temp directory), tracker (observed, cancelled, inferred, restart baseline), stats
(period boundaries at a fixed "now"), and descale (levels, estimate, no-marker). Route tests through the
in-process app with `HISTORY_DIRECTORY` in a temp directory. The mock brewer gains a phase progression,
temperature readings, and a counter increment so the trace and the log can be exercised without a brewer.

## Out of scope

Editing or deleting log entries, exporting, and anything that writes to Fellow. Nothing here changes the
readiness rules or the same-site protections.
