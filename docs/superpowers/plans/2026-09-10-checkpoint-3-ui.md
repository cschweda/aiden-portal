# Checkpoint 3: UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dark-by-default Nuxt UI front end over the checkpoint 2 API: dashboard with brewer state and a gated Instant Brew button, a profile editor that exposes every variable, schedules, and a log viewer, plus a mock Fellow server so all of it can be exercised without real credentials.

**Architecture:** Pages under `app/pages/` are thin; every piece of logic that can be pure lives in `app/utils/*.ts` (explicit imports, unit-tested under node). Components call the API through one `useApi()` composable that turns the server's error envelope into toasts. The layout is Nuxt UI's dashboard shell (sidebar + panel). A `GET /api/logs` route and a log reader feed the logs page. `scripts/mock-fellow.mjs` emulates the Fellow endpoints in memory; `FELLOW_BASE_URL` (loopback http only) points the client at it.

**Tech Stack:** Nuxt 4.5, Nuxt UI 4.11 (`@iconify-json/lucide` for offline icons), Zod 4, Vitest 5.

**Spec:** `docs/aiden-studio-build-prompt.md` §7, §6 (`/logs`), §9 checkpoint 3.

## Global Constraints

- Dark by default (`aiden.config.ts` `ui.colorMode`), toggle still available. One accent (amber), zinc neutrals, generous spacing, monospace for ids and timestamps.
- Every brewer state field is visible; every profile variable is editable with the exact legal steps.
- Instant Brew is enabled only when the server says `canStartBrew`; otherwise the blockers are shown. Confirmation when `ui.confirmBrewStart`.
- Every failed call shows a toast with the server's error code; never a blank failure.
- No component reads env vars; dry-run and Fellow state come from `/api/status`.
- Pure logic in `app/utils/`, tested; components stay thin.
- Commit messages carry no AI co-author trailer.

## File Structure

| Path | Responsibility |
|---|---|
| `app/utils/profile-form.ts` | limits, `blankProfile`, `syncPulseTemperatures`, `describeProfile`, `toProfileInput` |
| `app/utils/schedule-form.ts` | `secondsToTime`, `timeToSeconds`, `DAY_LABELS`, `describeDays`, `blankSchedule` |
| `app/utils/api-error.ts` | `describeApiError` |
| `app/utils/format.ts` | `formatTemperature`, `formatLitres`, `formatTime` |
| `app/composables/useApi.ts` | `$fetch` wrapper: JSON, toasts on failure |
| `app/composables/useStatus.ts` | `/api/status` state shared by the layout and pages |
| `app/layouts/default.vue`, `app/app.vue`, `app/app.config.ts`, `app/error.vue` | Shell |
| `app/components/*` | `BrewerCard`, `InstantBrewCard`, `ProfileEditor`, `ProfileRow`, `ScheduleForm`, `DayChips`, `StatusBadges`, `ConfirmModal`, `ShareLinkModal`, `ImportProfileModal` |
| `app/pages/index.vue`, `profiles.vue`, `schedules.vue`, `logs.vue` | Pages |
| `server/utils/log-reader.ts`, `server/api/logs.get.ts` | Log tail |
| `scripts/mock-fellow.mjs` | In-memory Fellow emulator |
| `server/utils/config.ts`, `aiden-config`, `.env.sample` | `FELLOW_BASE_URL` override (loopback http allowed) |
| `tests/unit/app/*.test.ts`, `tests/unit/log-reader.test.ts`, `tests/routes/logs.test.ts` | Tests |

---

### Task 1: Pure UI logic

**Files:** create the four `app/utils/*.ts` modules above; tests `tests/unit/app/profile-form.test.ts`, `schedule-form.test.ts`, `api-error.test.ts`, `format.test.ts`; add `"../app/utils/**/*.ts"` to `tests/tsconfig.json` include.

**Interfaces:**
```ts
// profile-form.ts
export const PROFILE_LIMITS = {
  ratio: { min: 14, max: 20, step: 0.5 }, overallTemperature: { min: 50, max: 99, step: 0.5 },
  bloomRatio: { min: 1, max: 3, step: 0.5 }, bloomDuration: { min: 1, max: 120, step: 1 },
  bloomTemperature: { min: 50, max: 99, step: 0.5 }, pulsesNumber: { min: 1, max: 10, step: 1 },
  pulsesInterval: { min: 5, max: 60, step: 1 }, pulseTemperature: { min: 50, max: 99, step: 0.5 },
} as const
export function blankProfile(): ProfileInput          // valid defaults: 1:16, 94°, bloom on 2:1 30s 94°, pulses on 1 pulse each
export function syncPulseTemperatures(p: ProfileInput): ProfileInput   // arrays follow the counts; new entries copy the last entry, else overallTemperature
export function toProfileInput(profile: Record<string, unknown>): ProfileInput   // strip server fields, fill any missing field from blankProfile, sync arrays
export function describeProfile(p: Partial<ProfileInput>): string   // "1:16 · 94° · bloom 2:1 30s · SS 1 pulse · batch 1 pulse"

// schedule-form.ts
export const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as const
export function secondsToTime(seconds: number): string        // 28800 → '08:00'
export function timeToSeconds(time: string): number           // '08:00' → 28800; throws on garbage
export function describeDays(days: readonly boolean[]): string // 'Every day' | 'Weekdays' | 'Weekends' | 'Mon, Wed, Fri' | 'Never'
export function blankSchedule(profileId: string): ScheduleInput   // 07:00, weekdays, 950 ml

// api-error.ts
export interface ApiFailure { code: string; message: string; issues?: Array<{ path: string; message: string }> }
export function describeApiError(error: unknown): ApiFailure   // FetchError data → code/message; network → 'network_error'; else 'unknown_error'

// format.ts
export function formatTemperature(c: number | undefined): string   // '94°C' / '—'
export function formatLitres(l: number | undefined): string         // '12.3 L' / '—'
export function formatTime(iso: string | number | undefined): string // 'HH:MM:SS' local
```

- [ ] Write the tests (each function above has at least one case per branch; `blankProfile()` and `blankSchedule('p1')` must pass their Zod input schemas; `syncPulseTemperatures` on `{ ssPulsesNumber: 3, ssPulseTemperatures: [90] }` gives `[90, 90, 90]`, on `2` with `[90, 91, 92]` gives `[90, 91]`, on an empty array copies `overallTemperature`; `timeToSeconds('24:00')` throws; `describeApiError({ data: { error: 'fellow_auth_failed', message: 'x' } })` → that code).
- [ ] Run → fail. Implement. Run → pass. `git commit -m "feat(ui): pure form, formatting, and error helpers"`.

---

### Task 2: Log reader and `/api/logs`

**Interfaces:**
```ts
// server/utils/log-reader.ts
export interface LogRecord { time: number; level: number; levelName: string; msg: string; requestId?: string; rest: Record<string, unknown> }
export interface LogQuery { lines: number; minLevel?: LevelName; requestId?: string }
export function parseLogLine(line: string): LogRecord | null       // pino JSON; garbage → null
export async function readLogTail(file: string, query: LogQuery): Promise<{ available: boolean; records: LogRecord[] }>
// GET /api/logs?lines=200&level=warn&requestId=…  → { available, file, records }   (records newest first, at most `lines`)
```
Levels: pino numbers 10 trace … 60 fatal; `minLevel` keeps records at or above it. `lines` is clamped to 1..1000. The route reads `currentLogFile(getConfig())`; when the file does not exist (development), `available: false`.

- [ ] Tests: `tests/unit/log-reader.test.ts` writes a temp file (`mkdtemp`) with 5 JSON lines of mixed levels, one garbage line, two request ids; asserts tail count, ordering (newest first), `minLevel: 'warn'`, `requestId` filter, missing file → `available: false`. `tests/routes/logs.test.ts`: `lines=abc` → 400, `level=loud` → 400, and in the test cwd (no file) → `{ available: false, records: [] }`.
- [ ] Implement, register the route in `tests/helpers/app.ts`, commit `feat(logs): tail the current log file through the API`.

---

### Task 3: Mock Fellow server and `FELLOW_BASE_URL`

- [ ] `server/utils/config.ts`: `FELLOW_BASE_URL: z.url().optional()` overriding `fellow.baseUrl`; validation: https, or http whose hostname is loopback (`isLoopbackHost`). Tests: https ok, `http://127.0.0.1:3900/v2` ok, `http://example.com/v2` rejected naming `FELLOW_BASE_URL`. `.env.sample`: document it as development-only.
- [ ] `scripts/mock-fellow.mjs` (plain Node, no deps): listens on `127.0.0.1:3900`; routes under `/v2` exactly as `server/lib/fellow/http.ts` expects; in-memory profiles (3), schedules (2), one device whose detail route reports a ready brewer (firmware 1.5.16, connected, lid closed, water present, batch basket + carafe) and whose list route carries inventory; login accepts anything and issues `token-N`/`refresh-N`; refresh works; every mutation mutates the store and returns what the real API is believed to return; `PATCH /devices/:id/start` flips `brewing: true` for 20 s; `--flaky` flag makes every third GET a 503 for retry demos; logs each request to stdout. Add `"mock:fellow": "node scripts/mock-fellow.mjs"` to package.json.
- [ ] README: a "Run against the mock brewer" subsection (`pnpm mock:fellow` in one terminal; `.env` with `FELLOW_BASE_URL=http://127.0.0.1:3900/v2` and any credentials; `pnpm dev`). Commit `feat(dev): mock Fellow server and FELLOW_BASE_URL override`.

---

### Task 4: App shell

- [ ] `pnpm add -D @iconify-json/lucide`. `nuxt.config.ts`: `colorMode: { preference: aiden.ui.colorMode, fallback: 'dark' }`, `app: { head: { title: aiden.app.name } }`. `app/app.config.ts`: `ui: { colors: { primary: 'amber', neutral: 'zinc' } }`.
- [ ] `app/composables/useStatus.ts`: `useFetch('/api/status', { key: 'status' })` exposed as `{ status, refresh }` via `useState` so the layout and pages share it. `app/composables/useApi.ts`: `api<T>(path, opts)` = `$fetch` with `credentials: 'same-origin'`; on failure `describeApiError` → `useToast().add({ title: code, description: message, color: 'error' })` and rethrow.
- [ ] `app/layouts/default.vue`: `UDashboardGroup` → `UDashboardSidebar` (collapsible; header: app name + version; `UNavigationMenu` vertical with Dashboard `/`, Profiles `/profiles`, Schedules `/schedules`, Logs `/logs`; footer: color-mode toggle) + `<slot />`. `app/components/StatusBadges.vue`: DRY RUN badge (amber) when `status.dryRun`; Fellow dot (green `ok`, red for any `fellow_*`, grey `unknown`) with the code as tooltip. `app/app.vue`: `UApp` → `NuxtLayout` → `NuxtPage`. `app/error.vue`: minimal.
- [ ] Each page renders `UDashboardPanel` with `UDashboardNavbar` (title, `#right` → `StatusBadges` + a refresh button that calls the page's `refresh(true)`).
- [ ] Verify: `pnpm build` clean, then `scripts/smoke.sh`; run the built server against the mock and screenshot `/` with viewcap: dark background, sidebar, badges. Commit `feat(ui): dashboard shell with sidebar, status badges, dark default`.

---

### Task 5: Dashboard page

- [ ] `app/pages/index.vue`: `useFetch('/api/device')` and `useFetch('/api/profiles')`. `BrewerCard.vue`: name; a grid of state chips (Connected, Lid closed, Carafe, Water, Single basket, Batch basket, Brewing, Rinsing, Cleaning) each green/red/grey; inventory block in mono (firmware, serial, sku, MACs); counters (total brews, litres via `formatLitres`). `InstantBrewCard.vue`: the Instant Brew profile's title (from `ibSelectedProfileId`), the button (disabled unless `canStartBrew`), the blockers as a list under it, `ConfirmModal` when `ui.confirmBrewStart` (from `useRuntimeConfig().public.app.ui`), `POST /api/brew/start`, success toast, then `refresh(true)`. Quick profiles: first six with `describeProfile`, link to `/profiles`. A `UAlert` (error) at the top when `status.fellow === 'fellow_auth_failed'`.
- [ ] Verify against the mock (screenshot); commit `feat(ui): dashboard with brewer state and gated Instant Brew`.

---

### Task 6: Profiles page and editor

- [ ] `app/pages/profiles.vue`: list rows (`ProfileRow.vue`: title, `describeProfile`, id in mono, Edit / Share / Delete); toolbar: New profile, Import from brew.link, refresh. `ProfileEditor.vue` in a `USlideover`: `UForm :schema="ProfileInputSchema"` over `state` (from `blankProfile()` or `toProfileInput(existing)`); sections Basics (title, ratio slider+number, overall temperature slider+number), Bloom (switch, ratio, duration, temperature), Single-serve pulses (switch, count, interval, one temperature input per pulse), Batch pulses (same). Count changes call `syncPulseTemperatures`. Submit → POST or PATCH; on 400 show the server's issue paths under the fields. `ImportProfileModal.vue`: link input → POST `/api/profiles/import`. `ShareLinkModal.vue`: POST share → show link + copy button. `ConfirmModal` for delete.
- [ ] Verify against the mock: create, edit (pulse count 3 → three inputs), share, import, delete; screenshot the editor. Commit `feat(ui): profile list, editor with every variable, import and share`.

---

### Task 7: Schedules page

- [ ] `app/pages/schedules.vue`: rows (time via `secondsToTime`, `describeDays`, water, profile title from profiles, enabled `USwitch` → PATCH `{ enabled }`, delete). `ScheduleForm.vue` in a `USlideover`: `UInput type="time"` (label "brewer local time"), `DayChips.vue` (seven toggle buttons, Sun…Sat), water `UInputNumber` 150–1500 step 10, profile `USelectMenu` from live profiles; submit → POST.
- [ ] Verify against the mock; commit `feat(ui): schedules with day chips and a brewer-local time picker`.

---

### Task 8: Logs page

- [ ] `app/pages/logs.vue`: filters (level `USelect` trace…fatal, requestId `UInput`, lines 100/200/500), `UTable` columns time (mono, `formatTime`), level (badge colored by level), message, requestId (mono; click sets the filter); row expansion shows `rest` as JSON. `UAlert` when `available === false` explaining logs go to the terminal in development. Refresh button.
- [ ] Verify against the mock in production mode (so a file exists); commit `feat(ui): log viewer with level and request-id filters`.

---

### Task 9: Verification, docs, version

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && scripts/smoke.sh`. Full click-through against the mock in a real browser via Chrome MCP; viewcap screenshots of all four pages into `docs/screenshots/`. Check `html.dark` is applied by default and the toggle works.
- [ ] README: status line, UI section (pages, dark mode, mock), screenshots; ARCHITECTURE: UI layer paragraph; spec §9 tick; CHANGELOG `[0.3.0]`; `package.json` 0.3.0; tag `v0.3.0`.
