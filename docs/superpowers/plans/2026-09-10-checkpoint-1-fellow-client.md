# Checkpoint 1: Scaffold, Config, Schemas, Fellow Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Nuxt 4 repo whose pure-TypeScript Fellow client, Zod schemas, and env config loader are complete and fully tested against msw, with build, lint, typecheck, and tests all green.

**Architecture:** `server/utils/fellow/` is a dependency-free TypeScript client (global `fetch`, injectable logger/sleep/random/now) split into an HTTP core (auth, single-flight login, retry) and a `FellowClient` facade (typed methods, read cache, dry-run). `server/utils/config.ts` parses `process.env` once with Zod. A thin Nitro layer (`server/utils/fellow-client.ts`, `server/utils/logger.ts`, `server/api/health.get.ts`) proves the wiring. Checkpoints 2–4 (auth, UI, deploy) get their own plans.

**Tech Stack:** Node 22, pnpm 10, Nuxt 4.5, Nuxt UI 4.11, TypeScript 6, Zod 4.6, Vitest 5, msw 2.15, pino 10.

**Docs delivered in this checkpoint (user request 2026-09-10):** README with a credits section for the fellow-aiden Python library, MIT LICENSE, CHANGELOG (Keep a Changelog, updated at every version bump), `.gitignore`, `.nvmrc`.

**Spec:** `docs/aiden-studio-build-prompt.md` (sections 1, 3, 4 partially, 8 partially, 9 checkpoint 1)


> **Execution notes (2026-09-10).** Executed inline; all ten tasks done, tagged `v0.1.0`. Deviations from the text below, all driven by owner decisions or reference findings made during execution:
> - Auth was dropped from Phase 1 entirely, so the config loader (Task 5) has no `AUTH_ENABLED`, `NUXT_SESSION_*`, or `DATABASE_PATH`, and gained `FELLOW_TIMEZONE`.
> - The Home Assistant integration's vendored client turned out to be a newer v2 reference. An extra task aligned the client with it: v2 base URL, login with timezone, a real refresh-token flow (the "not implemented" extension point is gone), brew.link drop types, required `overallTemperature`, remote Instant Brew start with readiness rules (`device.ts`), and the per-device detail route. Tests grew from the planned set to 221.
> - `pino-pretty` moved to `dependencies` in Task 1 rather than Task 10.
> - Tasks 6+7 and 8+9 were each committed together so that every commit has a green test suite.

## Global Constraints

- Node 22 LTS pinned in `engines` and `.nvmrc`; pnpm 10; Nuxt 4; Nuxt UI v4; TypeScript; Zod for all validation; Nitro preset `node-server`; license MIT (the reference library is GPL-3.0 and is credited in the README).
- better-sqlite3 ≥ 13 and `@node-rs/argon2` are the only native modules (checkpoint 2); neither has an install script. No `pnpm approve-builds`.
- All configuration is read once at startup into a Zod-validated config object (`server/utils/config.ts`). Nothing else reads `process.env`.
- `server/utils/fellow/` has no Nuxt or browser dependencies.
- The browser never talks to Fellow and never sees Fellow credentials.
- Base URL `https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1`; header `User-Agent: Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0` on every request.
- Retry GET and DELETE only, on 408 and 5xx, up to 3 attempts, exponential backoff with jitter. Never retry POST or PATCH.
- On 401: re-login with email/password once and retry once; a second 401 is `fellow_auth_failed`. Single-flight login. Refresh token stored, never used; `refreshAccessToken()` throws NotImplemented.
- Read cache 30 s for device, profiles, schedules; invalidate all on any successful mutation; `fresh` bypasses.
- Strip `id, createdAt, deletedAt, lastUsedTime, sharedFrom, isDefaultProfile, instantBrew, folder, duration, lastGBQuantity` before create/update and from shared profiles.
- Fuzzy title lookup: Ratcliff/Obershelp ratio strictly greater than 0.65, best match, plus exact case-insensitive mode.
- Dry run: GETs proceed; POST/PATCH/DELETE logged at info with method, path, body and answered with fakes whose ids match `p\d+` / `s\d+` / `https://brew.link/p/dryrun`.
- Input schemas strict (reject unknown keys); response types lenient (unknown keys pass through). 0.5-step checks are explicit value sets.
- Anything the Python reference does not demonstrate is marked `// UNVERIFIED` in code and listed in `ARCHITECTURE.md`.
- Commit messages carry no AI co-author trailer (user's global rule).

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `nuxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `.nvmrc`, `.gitignore`, `.env.example` | Project scaffold and tooling |
| `app/app.vue`, `app/assets/css/main.css` | Minimal Nuxt UI shell (real pages in checkpoint 3) |
| `server/utils/fellow/errors.ts` | `FellowError` with typed codes |
| `server/utils/fellow/logger.ts` | `FellowLogger` interface and `noopLogger` |
| `server/utils/fellow/schemas.ts` | Zod input schemas, value sets, lenient response schemas, inferred types |
| `server/utils/fellow/strip.ts` | Server-side field list and `stripServerFields` |
| `server/utils/fellow/brew-link.ts` | `parseBrewLink` |
| `server/utils/fellow/similarity.ts` | `similarityRatio`, `matchProfileByTitle` |
| `server/utils/fellow/http.ts` | `FellowHttp`: login, single-flight, 401 re-login, retry/backoff, JSON handling |
| `server/utils/fellow/cache.ts` | `TtlCache` |
| `server/utils/fellow/client.ts` | `FellowClient`: typed API methods, cache, dry-run |
| `server/utils/fellow/index.ts` | Public re-exports |
| `server/utils/config.ts` | `parseEnv`, `getConfig`, `isLoopbackHost` |
| `server/utils/logger.ts` | Minimal pino instance (extended in checkpoint 2) |
| `server/utils/fellow-client.ts` | `useFellowClient()` singleton for Nitro |
| `server/api/health.get.ts` | `GET /api/health` |
| `tests/setup/msw.ts`, `tests/helpers/fellow-fixtures.ts`, `tests/tsconfig.json` | Test infrastructure |
| `tests/unit/**/*.test.ts` | Unit tests, one file per module |
| `ARCHITECTURE.md` | Layer split and `UNVERIFIED` list |

Tests live in `tests/` (outside Nuxt's four generated TypeScript contexts) and are typechecked by their own `tests/tsconfig.json`, which also covers `server/utils/**` since those modules are Nuxt-free.

---

### Task 1: Scaffold and tooling

**Files:**
- Create: `package.json`, `nuxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `.nvmrc`, `.gitignore`, `.env.example`, `app/app.vue`, `app/assets/css/main.css`, `tests/tsconfig.json`, `tests/setup/msw.ts`, `tests/setup.test.ts`

**Interfaces:**
- Produces: `tests/setup/msw.ts` exports `server` (msw `SetupServer`) with `listen({ onUnhandledRequest: 'error' })` in `beforeAll`, `resetHandlers` in `afterEach`, `close` in `afterAll`. Every later test file does `import { server } from '../../setup/msw'` and `server.use(...)`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "aiden-studio",
  "version": "0.1.0",
  "description": "Personal web app for controlling a Fellow Aiden coffee brewer",
  "type": "module",
  "private": true,
  "license": "GPL-3.0",
  "engines": {
    "node": ">=22 <23",
    "pnpm": ">=10"
  },
  "packageManager": "pnpm@10.33.4",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "start": "node --env-file=.env .output/server/index.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "typecheck": "nuxt typecheck && tsc -p tests --noEmit",
    "postinstall": "nuxt prepare"
  },
  "dependencies": {
    "@nuxt/ui": "^4.11.1",
    "nuxt": "^4.5.2",
    "pino": "^10.3.1",
    "vue": "^3.5.42",
    "vue-router": "^5.3.1",
    "zod": "^4.6.1"
  },
  "devDependencies": {
    "@nuxt/eslint": "^1.17.0",
    "@types/node": "^22.0.0",
    "eslint": "^10.10.0",
    "msw": "^2.15.0",
    "pino-pretty": "^13.1.3",
    "typescript": "^6.0.3",
    "vitest": "^5.0.0",
    "vue-tsc": "^3.3.11"
  }
}
```

- [ ] **Step 2: Write `nuxt.config.ts`, `tsconfig.json`, `.nvmrc`**

`nuxt.config.ts`:
```ts
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  nitro: { preset: 'node-server' },
})
```

`tsconfig.json` (exactly what `nuxi init` generates for Nuxt 4):
```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

`.nvmrc`:
```
22
```

- [ ] **Step 3: Write `.gitignore` and `.env.example`**

`.gitignore`:
```
# Nuxt dev/build outputs
.output
.data
.nuxt
.nitro
.cache
dist

# Node dependencies
node_modules

# Runtime state
data
logs
*.log

# Misc
.DS_Store
.fleet
.idea
.vscode

# Local env files
.env
.env.*
!.env.example
```

`.env.example`:
```
# ---- Fellow account (required) ------------------------------------------
# Your Fellow app login. Kept server-side only; never sent to the browser.
FELLOW_EMAIL=you@example.com
FELLOW_PASSWORD=change-me
# true = log POST/PATCH/DELETE instead of sending them to Fellow. GETs still run.
FELLOW_DRY_RUN=true

# ---- Auth ----------------------------------------------------------------
# Default true. false is only allowed when HOST is loopback (see startup guard).
AUTH_ENABLED=false
# Required when AUTH_ENABLED=true. At least 32 characters.
NUXT_SESSION_PASSWORD=
# Default true. false is only allowed when HOST is loopback. Phase 1 (plain HTTP) sets false.
NUXT_SESSION_COOKIE_SECURE=false
# Comma-separated hostnames accepted in the Host header (port ignored).
ALLOWED_HOSTS=localhost,127.0.0.1,[::1]

# ---- Storage and logging -------------------------------------------------
DATABASE_PATH=./data/aiden.db
# fatal | error | warn | info | debug | trace. Default: info in production, debug in dev.
LOG_LEVEL=

# ---- Bind address (required; unset means every interface) ----------------
HOST=127.0.0.1
PORT=3000
```

- [ ] **Step 4: Write the app shell**

`app/app.vue`:
```vue
<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <main class="p-8">
      <h1 class="text-2xl font-semibold">
        aiden-studio
      </h1>
      <p class="mt-2 text-muted">
        The UI arrives in checkpoint 3.
      </p>
    </main>
  </UApp>
</template>
```

`app/assets/css/main.css`:
```css
@import "tailwindcss";
@import "@nuxt/ui";
```

- [ ] **Step 5: Write test tooling**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/msw.ts'],
  },
})
```

`eslint.config.mjs`:
```js
// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt()
```

`tests/tsconfig.json` (standalone on purpose: it must not depend on generated Nuxt config, and everything it covers is Nuxt-free):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["./**/*.ts", "../server/utils/**/*.ts"]
}
```

`tests/setup/msw.ts`:
```ts
import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'

export const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

`tests/setup.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from './setup/msw'

describe('test harness', () => {
  it('intercepts fetch through msw', async () => {
    server.use(http.get('https://example.test/ping', () => HttpResponse.json({ pong: true })))
    const res = await fetch('https://example.test/ping')
    expect(await res.json()).toEqual({ pong: true })
  })

  it('rejects unhandled requests', async () => {
    await expect(fetch('https://example.test/nothing-here')).rejects.toThrow()
  })
})
```

- [ ] **Step 6: Install and verify the toolchain**

Run: `pnpm install`
Expected: success. If pnpm prints "Ignored build scripts: <pkg>…", review each package: for ones whose scripts are optional (esbuild and similar ship platform binaries as optional deps), add them to `"pnpm": { "ignoredBuiltDependencies": [ … ] }` in `package.json` so the warning is an explicit decision, then rerun `pnpm install`.

Run: `pnpm build`
Expected: `.output/server/index.mjs` exists; no errors.

Run: `pnpm lint`
Expected: no errors (fix any style complaints in the files above).

Run: `pnpm typecheck`
Expected: both `nuxt typecheck` and `tsc -p tests --noEmit` exit 0.

Run: `pnpm test`
Expected: 2 tests pass in `tests/setup.test.ts`.

- [ ] **Step 7: Initialise git and commit**

```bash
git init -b main
git add -A
git commit -m "chore: scaffold Nuxt 4 project with test, lint, and typecheck tooling"
```

---

### Task 2: Fellow errors, logger interface, and Zod schemas

**Files:**
- Create: `server/utils/fellow/errors.ts`, `server/utils/fellow/logger.ts`, `server/utils/fellow/schemas.ts`
- Test: `tests/unit/fellow/schemas.test.ts`

**Interfaces:**
- Produces:
  - `class FellowError extends Error { code: FellowErrorCode; status?: number; body?: unknown }` with `FellowErrorCode = 'fellow_auth_failed' | 'fellow_http_error' | 'fellow_network_error' | 'fellow_invalid_link' | 'fellow_not_implemented' | 'fellow_bad_response'`
  - `interface FellowLogger { trace|debug|info|warn|error: (obj: Record<string, unknown>, msg: string) => void }`, `noopLogger`
  - `ProfileInputSchema`, `ScheduleInputSchema`, `SchedulePatchSchema`, `DeviceSchema`, `ProfileSchema`, `ScheduleSchema` and types `ProfileInput`, `ScheduleInput`, `SchedulePatch`, `Device`, `Profile`, `Schedule`
  - value sets `RATIO_VALUES`, `BLOOM_RATIO_VALUES`, `TEMPERATURE_VALUES`, regexes `TITLE_REGEX`, `PROFILE_ID_REGEX`

- [ ] **Step 1: Write the failing schema tests**

`tests/unit/fellow/schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  DeviceSchema,
  ProfileInputSchema,
  ProfileSchema,
  RATIO_VALUES,
  ScheduleInputSchema,
  SchedulePatchSchema,
  TEMPERATURE_VALUES,
} from '../../../server/utils/fellow/schemas'
import { PROFILE_INPUT, SCHEDULE_INPUT } from '../../helpers/fellow-fixtures'

const profile = (overrides: Record<string, unknown> = {}) => ({ ...PROFILE_INPUT, ...overrides })
const schedule = (overrides: Record<string, unknown> = {}) => ({ ...SCHEDULE_INPUT, ...overrides })
const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success

describe('value sets', () => {
  it('ratio runs 14..20 in 0.5 steps', () => {
    expect(RATIO_VALUES).toEqual([14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20])
  })
  it('temperature runs 50..99 in 0.5 steps', () => {
    expect(TEMPERATURE_VALUES).toHaveLength(99)
    expect(TEMPERATURE_VALUES[0]).toBe(50)
    expect(TEMPERATURE_VALUES[98]).toBe(99)
  })
})

describe('ProfileInputSchema', () => {
  it('accepts the reference example', () => {
    expect(ProfileInputSchema.parse(PROFILE_INPUT)).toEqual(PROFILE_INPUT)
  })
  it.each([[13.5, false], [14, true], [14.25, false], [20, true], [20.5, false]])('ratio %s → %s', (ratio, ok) => {
    expect(accepts(ProfileInputSchema, profile({ ratio }))).toBe(ok)
  })
  it.each([[49.5, false], [50, true], [99, true], [99.5, false]])('bloomTemperature %s → %s', (t, ok) => {
    expect(accepts(ProfileInputSchema, profile({ bloomTemperature: t }))).toBe(ok)
  })
  it.each([[0.5, false], [1, true], [3, true], [3.5, false]])('bloomRatio %s → %s', (r, ok) => {
    expect(accepts(ProfileInputSchema, profile({ bloomRatio: r }))).toBe(ok)
  })
  it.each([[0, false], [1, true], [120, true], [121, false], [30.5, false]])('bloomDuration %s → %s', (d, ok) => {
    expect(accepts(ProfileInputSchema, profile({ bloomDuration: d }))).toBe(ok)
  })
  it.each([[0, false], [1, true], [50, true], [51, false]])('title length %s → %s', (len, ok) => {
    expect(accepts(ProfileInputSchema, profile({ title: 'a'.repeat(len) }))).toBe(ok)
  })
  it('rejects characters outside the title alphabet', () => {
    expect(accepts(ProfileInputSchema, profile({ title: 'bad"title' }))).toBe(false)
    expect(accepts(ProfileInputSchema, profile({ title: 'Ok! @#$%&*-+?/.,:)(' }))).toBe(true)
  })
  it('rejects unknown keys', () => {
    const result = ProfileInputSchema.safeParse(profile({ id: 'p1' }))
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(i => i.code)).toContain('unrecognized_keys')
  })
  it('requires one temperature per pulse', () => {
    expect(accepts(ProfileInputSchema, profile({ ssPulsesNumber: 2 }))).toBe(false)
    expect(accepts(ProfileInputSchema, profile({ batchPulseTemperatures: [96] }))).toBe(false)
    expect(accepts(ProfileInputSchema, profile({ ssPulsesNumber: 1, ssPulseTemperatures: [90] }))).toBe(true)
  })
  it('validates each pulse temperature', () => {
    expect(accepts(ProfileInputSchema, profile({ ssPulseTemperatures: [96, 97, 99.5] }))).toBe(false)
  })
  it.each([[0, false], [1, true], [10, true], [11, false]])('ssPulsesNumber %s → %s', (n, ok) => {
    const temps = Array.from({ length: Math.max(n, 0) }, () => 90)
    expect(accepts(ProfileInputSchema, profile({ ssPulsesNumber: n, ssPulseTemperatures: temps }))).toBe(ok)
  })
  it.each([[4, false], [5, true], [60, true], [61, false]])('batchPulsesInterval %s → %s', (i, ok) => {
    expect(accepts(ProfileInputSchema, profile({ batchPulsesInterval: i }))).toBe(ok)
  })
})

describe('ScheduleInputSchema', () => {
  it('accepts the reference example', () => {
    expect(ScheduleInputSchema.parse(SCHEDULE_INPUT)).toEqual(SCHEDULE_INPUT)
  })
  it.each([[6, false], [7, true], [8, false]])('days length %s → %s', (len, ok) => {
    expect(accepts(ScheduleInputSchema, schedule({ days: Array.from({ length: len }, () => true) }))).toBe(ok)
  })
  it('rejects non-boolean days', () => {
    expect(accepts(ScheduleInputSchema, schedule({ days: [1, 0, 1, 0, 1, 0, 1] }))).toBe(false)
  })
  it.each([[-1, false], [0, true], [86399, true], [86400, false]])('secondFromStartOfTheDay %s → %s', (s, ok) => {
    expect(accepts(ScheduleInputSchema, schedule({ secondFromStartOfTheDay: s }))).toBe(ok)
  })
  it.each([[149, false], [150, true], [1500, true], [1501, false]])('amountOfWater %s → %s', (w, ok) => {
    expect(accepts(ScheduleInputSchema, schedule({ amountOfWater: w }))).toBe(ok)
  })
  it.each([['p1', true], ['plocal3', true], ['x1', false], ['p', false], ['P1', false]])('profileId %s → %s', (id, ok) => {
    expect(accepts(ScheduleInputSchema, schedule({ profileId: id }))).toBe(ok)
  })
  it('rejects unknown keys', () => {
    expect(accepts(ScheduleInputSchema, schedule({ id: 's1' }))).toBe(false)
  })
})

describe('SchedulePatchSchema', () => {
  it('accepts a partial update', () => {
    expect(SchedulePatchSchema.parse({ enabled: false })).toEqual({ enabled: false })
  })
  it('still rejects unknown keys', () => {
    expect(accepts(SchedulePatchSchema, { enabled: false, bogus: 1 })).toBe(false)
  })
})

describe('response schemas are lenient', () => {
  it('passes unknown profile fields through', () => {
    const parsed = ProfileSchema.parse({ id: 'p1', title: 'x', brandNewField: 42 })
    expect(parsed.brandNewField).toBe(42)
  })
  it('requires an id', () => {
    expect(ProfileSchema.safeParse({ title: 'x' }).success).toBe(false)
  })
  it('does not enforce value sets on reads', () => {
    expect(ProfileSchema.safeParse({ id: 'p1', title: 'x', ratio: 12.25 }).success).toBe(true)
  })
  it('accepts a device with only an id', () => {
    expect(DeviceSchema.parse({ id: 'd1', weird: true })).toEqual({ id: 'd1', weird: true })
  })
})
```

`tests/helpers/fellow-fixtures.ts` (first version; later tasks extend it):
```ts
import type { ProfileInput, ScheduleInput } from '../../server/utils/fellow/schemas'

export const BASE = 'https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1'

export const DEVICE = { id: 'dev-123', displayName: 'Kitchen Aiden', firmwareVersion: '1.2.3' }

export const PROFILE_INPUT: ProfileInput = {
  profileType: 0,
  title: 'Debug-FellowAiden',
  ratio: 16,
  bloomEnabled: true,
  bloomRatio: 2,
  bloomDuration: 30,
  bloomTemperature: 96,
  ssPulsesEnabled: true,
  ssPulsesNumber: 3,
  ssPulsesInterval: 23,
  ssPulseTemperatures: [96, 97, 98],
  batchPulsesEnabled: true,
  batchPulsesNumber: 2,
  batchPulsesInterval: 30,
  batchPulseTemperatures: [96, 97],
}

export const PROFILE_P7 = {
  ...PROFILE_INPUT,
  id: 'p7',
  createdAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
  lastUsedTime: null,
  sharedFrom: null,
  isDefaultProfile: false,
  instantBrew: false,
  folder: null,
  duration: 240,
  lastGBQuantity: 30,
}

export const PROFILE_P8 = { ...PROFILE_P7, id: 'p8', title: 'Morning Cup' }

export const SCHEDULE_INPUT: ScheduleInput = {
  days: [true, true, false, true, false, true, false],
  secondFromStartOfTheDay: 28800,
  enabled: true,
  amountOfWater: 950,
  profileId: 'p7',
}

export const SCHEDULE_S0 = { ...SCHEDULE_INPUT, id: 's0' }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/fellow/schemas.test.ts`
Expected: FAIL — cannot resolve `server/utils/fellow/schemas`.

- [ ] **Step 3: Write errors.ts and logger.ts**

`server/utils/fellow/errors.ts`:
```ts
export type FellowErrorCode =
  | 'fellow_auth_failed'
  | 'fellow_http_error'
  | 'fellow_network_error'
  | 'fellow_invalid_link'
  | 'fellow_not_implemented'
  | 'fellow_bad_response'

export interface FellowErrorOptions {
  status?: number
  body?: unknown
  cause?: unknown
}

/** Every failure the Fellow client raises. `code` is stable and safe to show to the UI; `body` is not. */
export class FellowError extends Error {
  readonly code: FellowErrorCode
  readonly status: number | undefined
  readonly body: unknown

  constructor(code: FellowErrorCode, message: string, options: FellowErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'FellowError'
    this.code = code
    this.status = options.status
    this.body = options.body
  }
}
```

`server/utils/fellow/logger.ts`:
```ts
export type LogFn = (obj: Record<string, unknown>, msg: string) => void

/** Structurally compatible with a pino logger's (obj, msg) call form. */
export interface FellowLogger {
  trace: LogFn
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
}

const ignore: LogFn = () => {}

export const noopLogger: FellowLogger = { trace: ignore, debug: ignore, info: ignore, warn: ignore, error: ignore }
```

- [ ] **Step 4: Write schemas.ts**

`server/utils/fellow/schemas.ts`:
```ts
import { z } from 'zod'

/** Inclusive half-step range, e.g. halfSteps(14, 20) → [14, 14.5, …, 20]. Mirrors the reference library's *_ENUM lists. */
export function halfSteps(min: number, max: number): number[] {
  return Array.from({ length: (max - min) * 2 + 1 }, (_, i) => min + i * 0.5)
}

export const RATIO_VALUES = halfSteps(14, 20)
export const BLOOM_RATIO_VALUES = halfSteps(1, 3)
export const TEMPERATURE_VALUES = halfSteps(50, 99)
export const TITLE_REGEX = /^[A-Za-z0-9 !@#$%&*\-+?/.,:)(]+$/
export const PROFILE_ID_REGEX = /^(p|plocal)\d+$/

function halfStep(values: number[], label: string) {
  const first = values[0]
  const last = values[values.length - 1]
  return z.literal(values, { error: `${label} must be between ${first} and ${last} in 0.5 steps` })
}

const temperatures = z.array(halfStep(TEMPERATURE_VALUES, 'temperature'))

export const ProfileInputSchema = z
  .strictObject({
    profileType: z.int(),
    title: z.string().min(1).max(50).regex(TITLE_REGEX, {
      error: 'title allows only A-Z, a-z, 0-9, space and !@#$%&*-+?/.,:)(',
    }),
    ratio: halfStep(RATIO_VALUES, 'ratio'),
    bloomEnabled: z.boolean(),
    bloomRatio: halfStep(BLOOM_RATIO_VALUES, 'bloomRatio'),
    bloomDuration: z.int().min(1).max(120),
    bloomTemperature: halfStep(TEMPERATURE_VALUES, 'bloomTemperature'),
    ssPulsesEnabled: z.boolean(),
    ssPulsesNumber: z.int().min(1).max(10),
    ssPulsesInterval: z.int().min(5).max(60),
    ssPulseTemperatures: temperatures,
    batchPulsesEnabled: z.boolean(),
    batchPulsesNumber: z.int().min(1).max(10),
    batchPulsesInterval: z.int().min(5).max(60),
    batchPulseTemperatures: temperatures,
  })
  // UNVERIFIED: the reference example has one temperature per pulse, but nothing proves the Fellow API requires it.
  .refine(p => p.ssPulseTemperatures.length === p.ssPulsesNumber, {
    path: ['ssPulseTemperatures'],
    error: 'must contain exactly ssPulsesNumber temperatures',
  })
  .refine(p => p.batchPulseTemperatures.length === p.batchPulsesNumber, {
    path: ['batchPulseTemperatures'],
    error: 'must contain exactly batchPulsesNumber temperatures',
  })

export type ProfileInput = z.infer<typeof ProfileInputSchema>

export const ScheduleInputSchema = z.strictObject({
  days: z.array(z.boolean()).length(7, { error: 'days must have exactly 7 entries, Sunday to Saturday' }),
  secondFromStartOfTheDay: z.int().min(0).max(86399),
  enabled: z.boolean(),
  amountOfWater: z.int().min(150).max(1500),
  profileId: z.string().regex(PROFILE_ID_REGEX, { error: 'profileId must be p<n> or plocal<n>' }),
})

export type ScheduleInput = z.infer<typeof ScheduleInputSchema>

export const SchedulePatchSchema = ScheduleInputSchema.partial()

export type SchedulePatch = z.infer<typeof SchedulePatchSchema>

// Responses are lenient on purpose: the API is undocumented and may grow fields. Only `id` is load-bearing.
export const DeviceSchema = z.looseObject({ id: z.string(), displayName: z.string().optional() })
export const ProfileSchema = z.looseObject({ id: z.string(), title: z.string() })
export const ScheduleSchema = z.looseObject({ id: z.string() })

export type Device = z.infer<typeof DeviceSchema>
export type Profile = z.infer<typeof ProfileSchema> & Partial<ProfileInput>
export type Schedule = z.infer<typeof ScheduleSchema> & Partial<ScheduleInput>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/fellow/schemas.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Lint, typecheck, commit**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

```bash
git add server/utils/fellow tests
git commit -m "feat(fellow): add error type, logger interface, and Zod schemas"
```

---

### Task 3: Server-field stripping and brew-link parsing

**Files:**
- Create: `server/utils/fellow/strip.ts`, `server/utils/fellow/brew-link.ts`
- Test: `tests/unit/fellow/strip.test.ts`, `tests/unit/fellow/brew-link.test.ts`

**Interfaces:**
- Produces: `SERVER_SIDE_PROFILE_FIELDS: readonly string[]`, `stripServerFields(profile: Record<string, unknown>): Record<string, unknown>` (returns a new object), `parseBrewLink(linkOrId: string): string` (throws `FellowError('fellow_invalid_link')`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/fellow/strip.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { SERVER_SIDE_PROFILE_FIELDS, stripServerFields } from '../../../server/utils/fellow/strip'
import { PROFILE_INPUT, PROFILE_P7 } from '../../helpers/fellow-fixtures'

describe('stripServerFields', () => {
  it('lists the ten fields from the reference library', () => {
    expect([...SERVER_SIDE_PROFILE_FIELDS]).toEqual([
      'id', 'createdAt', 'deletedAt', 'lastUsedTime', 'sharedFrom',
      'isDefaultProfile', 'instantBrew', 'folder', 'duration', 'lastGBQuantity',
    ])
  })
  it('removes every server-side field and keeps the rest', () => {
    expect(stripServerFields(PROFILE_P7)).toEqual(PROFILE_INPUT)
  })
  it('does not mutate its input', () => {
    const copy = { ...PROFILE_P7 }
    stripServerFields(copy)
    expect(copy).toEqual(PROFILE_P7)
  })
  it('leaves unknown fields alone', () => {
    expect(stripServerFields({ id: 'p1', title: 'x', mystery: 1 })).toEqual({ title: 'x', mystery: 1 })
  })
})
```

`tests/unit/fellow/brew-link.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseBrewLink } from '../../../server/utils/fellow/brew-link'
import { FellowError } from '../../../server/utils/fellow/errors'

describe('parseBrewLink', () => {
  it.each([
    ['https://brew.link/p/ws98', 'ws98'],
    ['https://brew.link/p/ws98/', 'ws98'],
    ['http://brew.link/p/AbC123', 'AbC123'],
    ['brew.link/p/ws98', 'ws98'],
    ['https://example.com/deep/path/p/zz9', 'zz9'],
    ['ws98', 'ws98'],
    ['  ws98  ', 'ws98'],
  ])('%s → %s', (input, id) => {
    expect(parseBrewLink(input)).toBe(id)
  })

  it.each([
    '',
    '   ',
    'https://brew.link/p/',
    'https://brew.link/q/ws98',
    'https://brew.link/p/ws98?utm=1',
    'ws-98',
    'https://brew.link/p/ws 98',
  ])('rejects %j', (input) => {
    expect(() => parseBrewLink(input)).toThrow(FellowError)
    try {
      parseBrewLink(input)
    } catch (error) {
      expect((error as FellowError).code).toBe('fellow_invalid_link')
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/fellow/strip.test.ts tests/unit/fellow/brew-link.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`server/utils/fellow/strip.ts`:
```ts
/** Fields Fellow adds to a profile. They must never be sent back on create/update. Same list as the reference library. */
export const SERVER_SIDE_PROFILE_FIELDS = [
  'id',
  'createdAt',
  'deletedAt',
  'lastUsedTime',
  'sharedFrom',
  'isDefaultProfile',
  'instantBrew',
  'folder',
  'duration',
  'lastGBQuantity',
] as const

export function stripServerFields(profile: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...profile }
  for (const field of SERVER_SIDE_PROFILE_FIELDS) {
    delete copy[field]
  }
  return copy
}
```

`server/utils/fellow/brew-link.ts`:
```ts
import { FellowError } from './errors'

/**
 * Accepts `https://brew.link/p/<id>`, any URL ending in `/p/<id>` (trailing slash optional), or a bare id.
 * The reference regex `(?:.*?/p/)?([a-zA-Z0-9]+)/?$` was search-anchored and accepted any URL ending in an
 * alphanumeric token; this version is anchored at both ends so `.../q/<id>` is rejected.
 */
const BREW_LINK_PATTERN = /^(?:\S*?\/p\/)?([A-Za-z0-9]+)\/?$/

export function parseBrewLink(linkOrId: string): string {
  const match = BREW_LINK_PATTERN.exec(linkOrId.trim())
  const id = match?.[1]
  if (!id) {
    throw new FellowError('fellow_invalid_link', `Not a brew.link URL or profile id: ${JSON.stringify(linkOrId)}`)
  }
  return id
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/fellow/strip.test.ts tests/unit/fellow/brew-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/fellow tests
git commit -m "feat(fellow): strip server-side profile fields and parse brew.link ids"
```

---

### Task 4: Title similarity and lookup

**Files:**
- Create: `server/utils/fellow/similarity.ts`
- Test: `tests/unit/fellow/similarity.test.ts`

**Interfaces:**
- Produces: `similarityRatio(a: string, b: string): number` (Ratcliff/Obershelp, identical to Python `difflib.SequenceMatcher(None, a, b).ratio()` for strings under 200 chars), `matchProfileByTitle<T extends { title: string }>(profiles: readonly T[], title: string, options?: { fuzzy?: boolean; threshold?: number }): T | undefined`.

- [ ] **Step 1: Write the failing tests**

Expected ratios below were produced by `python3 -c "from difflib import SequenceMatcher; …"` on 2026-09-10.

`tests/unit/fellow/similarity.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { matchProfileByTitle, similarityRatio } from '../../../server/utils/fellow/similarity'

describe('similarityRatio (matches Python difflib.SequenceMatcher.ratio)', () => {
  it.each([
    ['fellowaiden', 'debug-fellowaiden', 0.7857142857],
    ['kitten', 'sitting', 0.6153846154],
    ['abcd', 'bcde', 0.75],
    ['morning cup', 'morning cup', 1],
    ['morning cup', 'evening cup', 0.7272727273],
    ['', 'x', 0],
    ['', '', 1],
    ['light roast', 'dark roast', 0.5714285714],
    ['ethiopia natural', 'ethiopian natural', 0.9696969697],
  ])('%j vs %j → %s', (a, b, expected) => {
    expect(similarityRatio(a, b)).toBeCloseTo(expected, 9)
  })

  it('is symmetric for these inputs', () => {
    expect(similarityRatio('kitten', 'sitting')).toBeCloseTo(similarityRatio('sitting', 'kitten'), 9)
  })
})

describe('matchProfileByTitle', () => {
  const profiles = [
    { id: 'p1', title: 'Debug-FellowAiden' },
    { id: 'p2', title: 'Morning Cup' },
    { id: 'p3', title: 'Evening Cup' },
    { id: 'p4', title: 'Kitten' },
  ]

  it('finds an exact title regardless of case', () => {
    expect(matchProfileByTitle(profiles, 'morning cup')?.id).toBe('p2')
  })
  it('returns undefined without fuzzy when nothing matches exactly', () => {
    expect(matchProfileByTitle(profiles, 'FellowAiden')).toBeUndefined()
  })
  it('fuzzy-matches the reference README example', () => {
    expect(matchProfileByTitle(profiles, 'FellowAiden', { fuzzy: true })?.id).toBe('p1')
  })
  it('returns the best fuzzy match, not the first one over the threshold', () => {
    // "evening cup" scores 0.727 against "Morning Cup" and 1.0 against "Evening Cup".
    expect(matchProfileByTitle(profiles, 'evening cup ', { fuzzy: true })?.id).toBe('p3')
  })
  it('treats the threshold as strictly greater-than', () => {
    // kitten vs sitting is 0.615, below 0.65.
    expect(matchProfileByTitle(profiles, 'sitting', { fuzzy: true })).toBeUndefined()
    expect(matchProfileByTitle(profiles, 'sitting', { fuzzy: true, threshold: 0.6 })?.id).toBe('p4')
  })
  it('prefers an exact match even in fuzzy mode', () => {
    expect(matchProfileByTitle(profiles, 'MORNING CUP', { fuzzy: true })?.id).toBe('p2')
  })
  it('handles an empty list', () => {
    expect(matchProfileByTitle([], 'x', { fuzzy: true })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/fellow/similarity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`server/utils/fellow/similarity.ts`:
```ts
/**
 * Ratcliff/Obershelp similarity: 2 × (matched characters) / (total characters).
 * This is a port of Python's difflib.SequenceMatcher.ratio() for the no-junk case (inputs under 200
 * characters), which is what the reference library uses for fuzzy profile lookup.
 */
export function similarityRatio(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  const total = x.length + y.length
  if (total === 0) return 1
  return (2 * matchingCharacters(x, y)) / total
}

type Range = [alo: number, ahi: number, blo: number, bhi: number]

function matchingCharacters(a: string[], b: string[]): number {
  const pending: Range[] = [[0, a.length, 0, b.length]]
  let matched = 0
  while (pending.length > 0) {
    const [alo, ahi, blo, bhi] = pending.pop()!
    const [i, j, k] = longestMatch(a, b, alo, ahi, blo, bhi)
    if (k === 0) continue
    matched += k
    if (alo < i && blo < j) pending.push([alo, i, blo, j])
    if (i + k < ahi && j + k < bhi) pending.push([i + k, ahi, j + k, bhi])
  }
  return matched
}

/** Longest common block within the given windows; ties go to the earliest start in a, then in b (as in difflib). */
function longestMatch(a: string[], b: string[], alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
  let bestI = alo
  let bestJ = blo
  let bestSize = 0
  let lengthEndingAt = new Map<number, number>()
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>()
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue
      const k = (lengthEndingAt.get(j - 1) ?? 0) + 1
      next.set(j, k)
      if (k > bestSize) {
        bestI = i - k + 1
        bestJ = j - k + 1
        bestSize = k
      }
    }
    lengthEndingAt = next
  }
  return [bestI, bestJ, bestSize]
}

export interface TitleLookupOptions {
  fuzzy?: boolean
  /** Similarity must be strictly greater than this. Default 0.65, as in the reference library. */
  threshold?: number
}

export function matchProfileByTitle<T extends { title: string }>(
  profiles: readonly T[],
  title: string,
  { fuzzy = false, threshold = 0.65 }: TitleLookupOptions = {},
): T | undefined {
  const wanted = title.toLowerCase()
  const exact = profiles.find(p => p.title.toLowerCase() === wanted)
  if (exact || !fuzzy) return exact

  let best: T | undefined
  let bestScore = threshold
  for (const profile of profiles) {
    const score = similarityRatio(profile.title.toLowerCase(), wanted)
    if (score > bestScore) {
      best = profile
      bestScore = score
    }
  }
  return best
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/fellow/similarity.test.ts`
Expected: PASS. If a ratio differs from Python, the port is wrong — do not adjust the fixture.

- [ ] **Step 5: Commit**

```bash
git add server/utils/fellow tests
git commit -m "feat(fellow): port difflib ratio for fuzzy profile lookup"
```

---

### Task 5: Config loader

**Files:**
- Create: `server/utils/config.ts`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface AppConfig {
    fellow: { email: string; password: string; dryRun: boolean }
    auth: { enabled: boolean; sessionPassword: string | undefined; cookieSecure: boolean }
    allowedHosts: string[]           // lowercased, trimmed
    databasePath: string
    logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
    host: string | undefined
    port: number
    isProduction: boolean
  }
  function parseEnv(env: Record<string, string | undefined>): AppConfig   // throws Error listing every problem
  function getConfig(): AppConfig                                        // memoised parseEnv(process.env)
  function resetConfigForTests(): void
  function isLoopbackHost(host: string | undefined): boolean
  ```

- [ ] **Step 1: Write the failing tests**

`tests/unit/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { isLoopbackHost, parseEnv } from '../../server/utils/config'

const MINIMAL = { FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2' }

describe('parseEnv', () => {
  it('applies documented defaults', () => {
    const config = parseEnv(MINIMAL)
    expect(config).toEqual({
      fellow: { email: 'coffee@example.com', password: 'hunter2', dryRun: false },
      auth: { enabled: true, sessionPassword: undefined, cookieSecure: true },
      allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      databasePath: './data/aiden.db',
      logLevel: 'debug',
      host: undefined,
      port: 3000,
      isProduction: false,
    })
  })

  it('reads every variable', () => {
    const config = parseEnv({
      ...MINIMAL,
      FELLOW_DRY_RUN: 'true',
      AUTH_ENABLED: 'false',
      NUXT_SESSION_PASSWORD: 'x'.repeat(40),
      NUXT_SESSION_COOKIE_SECURE: 'false',
      ALLOWED_HOSTS: ' Localhost , aiden.example.com ',
      DATABASE_PATH: '/tmp/aiden.db',
      LOG_LEVEL: 'warn',
      HOST: '127.0.0.1',
      PORT: '4000',
      NODE_ENV: 'production',
    })
    expect(config.fellow.dryRun).toBe(true)
    expect(config.auth).toEqual({ enabled: false, sessionPassword: 'x'.repeat(40), cookieSecure: false })
    expect(config.allowedHosts).toEqual(['localhost', 'aiden.example.com'])
    expect(config.databasePath).toBe('/tmp/aiden.db')
    expect(config.logLevel).toBe('warn')
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(4000)
    expect(config.isProduction).toBe(true)
  })

  it('defaults the log level to info in production', () => {
    expect(parseEnv({ ...MINIMAL, NODE_ENV: 'production' }).logLevel).toBe('info')
  })

  it('treats empty strings as unset', () => {
    const config = parseEnv({ ...MINIMAL, HOST: '', LOG_LEVEL: '', PORT: '', NUXT_SESSION_PASSWORD: '' })
    expect(config.host).toBeUndefined()
    expect(config.port).toBe(3000)
    expect(config.auth.sessionPassword).toBeUndefined()
  })

  it.each(['1', 'yes', 'on', 'TRUE'])('parses %s as true', (value) => {
    expect(parseEnv({ ...MINIMAL, FELLOW_DRY_RUN: value }).fellow.dryRun).toBe(true)
  })

  it('names every invalid variable in one error', () => {
    expect(() => parseEnv({ FELLOW_EMAIL: 'not-an-email', FELLOW_PASSWORD: '', PORT: 'abc', AUTH_ENABLED: 'maybe' }))
      .toThrow(/FELLOW_EMAIL[\s\S]*FELLOW_PASSWORD[\s\S]*AUTH_ENABLED[\s\S]*PORT|FELLOW_EMAIL[\s\S]*PORT/)
  })

  it('rejects an unknown log level', () => {
    expect(() => parseEnv({ ...MINIMAL, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
  })

  it('rejects an out-of-range port', () => {
    expect(() => parseEnv({ ...MINIMAL, PORT: '70000' })).toThrow(/PORT/)
  })
})

describe('isLoopbackHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['localhost', true],
    ['LOCALHOST', true],
    ['0.0.0.0', false],
    ['::', false],
    ['192.168.1.10', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`server/utils/config.ts`:
```ts
import { z } from 'zod'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

const EnvSchema = z.object({
  FELLOW_EMAIL: z.email(),
  FELLOW_PASSWORD: z.string().min(1),
  FELLOW_DRY_RUN: z.stringbool().default(false),
  AUTH_ENABLED: z.stringbool().default(true),
  NUXT_SESSION_PASSWORD: z.string().optional(),
  NUXT_SESSION_COOKIE_SECURE: z.stringbool().default(true),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,[::1]'),
  DATABASE_PATH: z.string().min(1).default('./data/aiden.db'),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.string().optional(),
})

export interface AppConfig {
  fellow: { email: string, password: string, dryRun: boolean }
  auth: { enabled: boolean, sessionPassword: string | undefined, cookieSecure: boolean }
  allowedHosts: string[]
  databasePath: string
  logLevel: LogLevel
  host: string | undefined
  port: number
  isProduction: boolean
}

/** Drops empty-string values so `HOST=` in a .env file behaves like an unset variable. */
function withoutEmptyValues(env: Record<string, string | undefined>): Record<string, string> {
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') cleaned[key] = value
  }
  return cleaned
}

export function parseEnv(env: Record<string, string | undefined>): AppConfig {
  const result = EnvSchema.safeParse(withoutEmptyValues(env))
  if (!result.success) {
    const problems = result.error.issues.map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`)
  }
  const raw = result.data
  const isProduction = raw.NODE_ENV === 'production'
  return {
    fellow: { email: raw.FELLOW_EMAIL, password: raw.FELLOW_PASSWORD, dryRun: raw.FELLOW_DRY_RUN },
    auth: { enabled: raw.AUTH_ENABLED, sessionPassword: raw.NUXT_SESSION_PASSWORD, cookieSecure: raw.NUXT_SESSION_COOKIE_SECURE },
    allowedHosts: raw.ALLOWED_HOSTS.split(',').map(h => h.trim().toLowerCase()).filter(h => h.length > 0),
    databasePath: raw.DATABASE_PATH,
    logLevel: raw.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    host: raw.HOST,
    port: raw.PORT,
    isProduction,
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOSTS.has(host.trim().toLowerCase())
}

let cached: AppConfig | undefined

/** The one place the app reads process.env. Parsed once; throws on the first call if the environment is invalid. */
export function getConfig(): AppConfig {
  cached ??= parseEnv(process.env)
  return cached
}

export function resetConfigForTests(): void {
  cached = undefined
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/config.test.ts`
Expected: PASS. If the "names every invalid variable" regex is brittle, assert with three separate `toThrow(/FELLOW_EMAIL/)`, `/PORT/`, `/AUTH_ENABLED/` calls instead — the behavior that matters is that all problems appear in one message.

- [ ] **Step 5: Commit**

```bash
git add server/utils/config.ts tests/unit/config.test.ts
git commit -m "feat(config): parse environment once with Zod"
```

---

### Task 6: FellowHttp — login, single-flight, 401 re-login

**Files:**
- Create: `server/utils/fellow/http.ts`
- Test: `tests/unit/fellow/http.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const FELLOW_BASE_URL: string
  const FELLOW_USER_AGENT: string
  type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
  interface FellowHttpOptions {
    email: string; password: string
    baseUrl?: string; userAgent?: string; logger?: FellowLogger
    fetch?: typeof globalThis.fetch
    sleep?: (ms: number) => Promise<void>; random?: () => number
    maxAttempts?: number; backoffBaseMs?: number; timeoutMs?: number
  }
  class FellowHttp {
    constructor(options: FellowHttpOptions)
    get isAuthenticated(): boolean
    request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<T>  // path starts with '/', may carry a query string
    refreshAccessToken(): Promise<never>                                                 // throws fellow_not_implemented
  }
  ```
  `request` resolves with the parsed JSON body, the raw text if the body is not JSON, or `undefined` for an empty body. Non-2xx after auth handling rejects with `FellowError('fellow_http_error', { status, body })`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/fellow/http.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw'
import { FELLOW_BASE_URL, FELLOW_USER_AGENT, FellowHttp, type FellowHttpOptions } from '../../../server/utils/fellow/http'
import { BASE, DEVICE } from '../../helpers/fellow-fixtures'

const EMAIL = 'coffee@example.com'
const PASSWORD = 'hunter2'

function makeHttp(overrides: Partial<FellowHttpOptions> = {}): FellowHttp {
  return new FellowHttp({ email: EMAIL, password: PASSWORD, sleep: async () => {}, random: () => 0, ...overrides })
}

const loginUrl = `${BASE}/auth/login`
const devicesUrl = `${BASE}/devices`

describe('constants', () => {
  it('uses the reference base URL and user agent', () => {
    expect(FELLOW_BASE_URL).toBe('https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1')
    expect(FELLOW_USER_AGENT).toBe('Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0')
  })
})

describe('login', () => {
  it('does not log in at construction', () => {
    // No handlers are registered, so any request would fail the test via onUnhandledRequest: 'error'.
    const client = makeHttp()
    expect(client.isAuthenticated).toBe(false)
  })

  it('logs in lazily, then sends the bearer token and user agent on every request', async () => {
    let logins = 0
    let loginBody: unknown
    let loginUserAgent: string | null = null
    const seen: Array<{ auth: string | null, ua: string | null }> = []
    server.use(
      http.post(loginUrl, async ({ request }) => {
        logins++
        loginBody = await request.json()
        loginUserAgent = request.headers.get('user-agent')
        return HttpResponse.json({ accessToken: 'token-1', refreshToken: 'refresh-1' })
      }),
      http.get(devicesUrl, ({ request }) => {
        seen.push({ auth: request.headers.get('authorization'), ua: request.headers.get('user-agent') })
        return HttpResponse.json([DEVICE])
      }),
    )
    const client = makeHttp()
    expect(await client.request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(client.isAuthenticated).toBe(true)
    expect(loginBody).toEqual({ email: EMAIL, password: PASSWORD })
    expect(loginUserAgent).toBe(FELLOW_USER_AGENT)
    expect(seen).toEqual([{ auth: 'Bearer token-1', ua: FELLOW_USER_AGENT }])

    await client.request('GET', '/devices?dataType=real')
    expect(logins).toBe(1)
  })

  it('reports bad credentials as fellow_auth_failed', async () => {
    server.use(http.post(loginUrl, () => HttpResponse.json({ message: 'Incorrect username or password.' }, { status: 401 })))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({
      name: 'FellowError',
      code: 'fellow_auth_failed',
      status: 401,
    })
  })

  it('treats a login response without accessToken as a failure', async () => {
    server.use(http.post(loginUrl, () => HttpResponse.json({ ok: true })))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_auth_failed' })
  })

  it('shares one in-flight login between concurrent first requests', async () => {
    let logins = 0
    server.use(
      http.post(loginUrl, () => {
        logins++
        return HttpResponse.json({ accessToken: 'token-1' })
      }),
      http.get(devicesUrl, () => HttpResponse.json([DEVICE])),
    )
    const client = makeHttp()
    await Promise.all([1, 2, 3].map(() => client.request('GET', '/devices?dataType=real')))
    expect(logins).toBe(1)
  })
})

describe('401 handling', () => {
  it('re-logs in once and retries the request', async () => {
    let logins = 0
    server.use(
      http.post(loginUrl, () => {
        logins++
        return HttpResponse.json({ accessToken: `token-${logins}` })
      }),
      http.get(devicesUrl, ({ request }) =>
        request.headers.get('authorization') === 'Bearer token-2'
          ? HttpResponse.json([DEVICE])
          : new HttpResponse(null, { status: 401 }),
      ),
    )
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(logins).toBe(2)
  })

  it('gives up with fellow_auth_failed after a second 401 and makes no further attempts', async () => {
    let logins = 0
    let gets = 0
    server.use(
      http.post(loginUrl, () => {
        logins++
        return HttpResponse.json({ accessToken: `token-${logins}` })
      }),
      http.get(devicesUrl, () => {
        gets++
        return new HttpResponse(null, { status: 401 })
      }),
    )
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_auth_failed', status: 401 })
    expect(logins).toBe(2)
    expect(gets).toBe(2)
  })

  it('logs in once when several requests hit 401 at the same time', async () => {
    let logins = 0
    let validToken = ''
    const acceptOnlyValidToken = ({ request }: { request: Request }) =>
      request.headers.get('authorization') === `Bearer ${validToken}`
        ? HttpResponse.json([])
        : new HttpResponse(null, { status: 401 })
    server.use(
      http.post(loginUrl, () => {
        logins++
        validToken = `token-${logins}`
        return HttpResponse.json({ accessToken: validToken })
      }),
      http.get(devicesUrl, acceptOnlyValidToken),
      http.get(`${BASE}/devices/dev-123/profiles`, acceptOnlyValidToken),
      http.get(`${BASE}/devices/dev-123/schedules`, acceptOnlyValidToken),
    )
    const client = makeHttp()
    await client.request('GET', '/devices?dataType=real')
    expect(logins).toBe(1)

    validToken = 'token-expired-server-side'
    await Promise.all([
      client.request('GET', '/devices?dataType=real'),
      client.request('GET', '/devices/dev-123/profiles'),
      client.request('GET', '/devices/dev-123/schedules'),
    ])
    expect(logins).toBe(2)
  })
})

describe('response handling', () => {
  it('returns undefined for an empty body', async () => {
    server.use(
      http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' })),
      http.delete(`${BASE}/devices/dev-123/profiles/p7`, () => new HttpResponse(null, { status: 204 })),
    )
    expect(await makeHttp().request('DELETE', '/devices/dev-123/profiles/p7')).toBeUndefined()
  })

  it('returns raw text when the body is not JSON', async () => {
    server.use(
      http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' })),
      http.get(devicesUrl, () => new HttpResponse('plain text', { status: 200 })),
    )
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toBe('plain text')
  })

  it('serialises JSON bodies with a content type', async () => {
    let contentType: string | null = null
    let body: unknown
    server.use(
      http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' })),
      http.post(`${BASE}/devices/dev-123/profiles`, async ({ request }) => {
        contentType = request.headers.get('content-type')
        body = await request.json()
        return HttpResponse.json({ id: 'p9' })
      }),
    )
    expect(await makeHttp().request('POST', '/devices/dev-123/profiles', { title: 'x' })).toEqual({ id: 'p9' })
    expect(contentType).toBe('application/json')
    expect(body).toEqual({ title: 'x' })
  })

  it('raises fellow_http_error with status and body for a 4xx', async () => {
    server.use(
      http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' })),
      http.get(devicesUrl, () => HttpResponse.json({ message: 'nope' }, { status: 404 })),
    )
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({
      code: 'fellow_http_error',
      status: 404,
      body: { message: 'nope' },
    })
  })

  it('refreshAccessToken is an explicit not-implemented extension point', async () => {
    await expect(makeHttp().refreshAccessToken()).rejects.toMatchObject({ code: 'fellow_not_implemented' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/fellow/http.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation (no retry loop yet; Task 7 adds it)**

`server/utils/fellow/http.ts`:
```ts
import { FellowError } from './errors'
import { type FellowLogger, noopLogger } from './logger'

export const FELLOW_BASE_URL = 'https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1'
export const FELLOW_USER_AGENT = 'Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface FellowHttpOptions {
  email: string
  password: string
  baseUrl?: string
  userAgent?: string
  logger?: FellowLogger
  fetch?: typeof globalThis.fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Attempts for GET and DELETE on 408/5xx/network errors. POST and PATCH always get exactly one. */
  maxAttempts?: number
  backoffBaseMs?: number
  timeoutMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Talks HTTP to Fellow: lazy login, bearer token, one re-login on 401, JSON in and out. */
export class FellowHttp {
  private readonly email: string
  private readonly password: string
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly logger: FellowLogger
  private readonly fetchImpl: typeof globalThis.fetch
  protected readonly sleep: (ms: number) => Promise<void>
  protected readonly random: () => number
  protected readonly maxAttempts: number
  protected readonly backoffBaseMs: number
  private readonly timeoutMs: number

  private accessToken: string | null = null
  /** Fellow returns this at login. It is never sent because no refresh endpoint is known. */
  private refreshToken: string | null = null
  private loginInFlight: Promise<string> | null = null

  constructor(options: FellowHttpOptions) {
    this.email = options.email
    this.password = options.password
    this.baseUrl = options.baseUrl ?? FELLOW_BASE_URL
    this.userAgent = options.userAgent ?? FELLOW_USER_AGENT
    this.logger = options.logger ?? noopLogger
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.sleep = options.sleep ?? defaultSleep
    this.random = options.random ?? Math.random
    this.maxAttempts = options.maxAttempts ?? 3
    this.backoffBaseMs = options.backoffBaseMs ?? 250
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null
  }

  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const response = await this.sendAuthenticated(method, path, body)
    if (response.ok) return (await parseBody(response)) as T
    throw new FellowError('fellow_http_error', `Fellow responded ${response.status} to ${method} ${path}`, {
      status: response.status,
      body: await parseBody(response),
    })
  }

  // UNVERIFIED: the login response carries a refreshToken, but the reference client never uses it and no
  // refresh endpoint appears anywhere in its code. Implement this once the endpoint is known.
  async refreshAccessToken(): Promise<never> {
    throw new FellowError('fellow_not_implemented', 'Fellow token refresh is not implemented: the refresh endpoint is unknown')
  }

  protected async sendAuthenticated(method: HttpMethod, path: string, body: unknown): Promise<Response> {
    const token = await this.ensureToken()
    let response = await this.send(method, path, body, token)
    if (response.status !== 401) return response

    this.logger.warn({ method, path }, 'Fellow returned 401; re-authenticating')
    const freshToken = await this.reauthenticate(token)
    response = await this.send(method, path, body, freshToken)
    if (response.status === 401) {
      throw new FellowError('fellow_auth_failed', 'Fellow rejected the request even after re-authenticating', { status: 401 })
    }
    return response
  }

  private ensureToken(): Promise<string> {
    return this.accessToken ? Promise.resolve(this.accessToken) : this.login()
  }

  /** If another request already replaced the stale token, reuse it instead of logging in again. */
  private reauthenticate(staleToken: string): Promise<string> {
    if (this.accessToken && this.accessToken !== staleToken) return Promise.resolve(this.accessToken)
    return this.login()
  }

  private login(): Promise<string> {
    if (!this.loginInFlight) {
      this.loginInFlight = this.performLogin().finally(() => {
        this.loginInFlight = null
      })
    }
    return this.loginInFlight
  }

  private async performLogin(): Promise<string> {
    this.logger.debug({}, 'Authenticating with Fellow')
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'User-Agent': this.userAgent, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    }
    catch (error) {
      throw new FellowError('fellow_network_error', 'Could not reach Fellow to log in', { cause: error })
    }
    const data = (await parseBody(response)) as { accessToken?: unknown, refreshToken?: unknown } | undefined
    if (!response.ok || typeof data?.accessToken !== 'string') {
      throw new FellowError('fellow_auth_failed', 'Fellow rejected the email or password', { status: response.status, body: data })
    }
    this.accessToken = data.accessToken
    this.refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : null
    this.logger.info({}, 'Authenticated with Fellow')
    return this.accessToken
  }

  private async send(method: HttpMethod, path: string, body: unknown, token: string): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const started = performance.now()
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    this.logger.debug({ method, path, status: response.status, durationMs: Math.round(performance.now() - started) }, 'Fellow API call')
    return response
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/fellow/http.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add server/utils/fellow/http.ts tests/unit/fellow/http.test.ts
git commit -m "feat(fellow): HTTP core with lazy single-flight login and one re-login on 401"
```

---

### Task 7: FellowHttp — retry with backoff for GET and DELETE only

**Files:**
- Modify: `server/utils/fellow/http.ts` (replace `request`, add `backoff`)
- Test: `tests/unit/fellow/http.test.ts` (append a `describe('retries')`)

**Interfaces:**
- Consumes: `FellowHttp.request`, `sleep`, `random`, `maxAttempts`, `backoffBaseMs` from Task 6.
- Produces: same `request` signature; delay for attempt n is `backoffBaseMs * 2^(n-1) + floor(random() * 100)` ms.

- [ ] **Step 1: Append the failing tests**

Append to `tests/unit/fellow/http.test.ts` (add `vi` to the vitest import):
```ts
describe('retries', () => {
  const loggedIn = () => http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' }))

  it('retries a GET on 503 with exponential backoff and succeeds', async () => {
    let gets = 0
    server.use(
      loggedIn(),
      http.get(devicesUrl, () => {
        gets++
        return gets < 3 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json([DEVICE])
      }),
    )
    const sleep = vi.fn(async () => {})
    expect(await makeHttp({ sleep }).request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(gets).toBe(3)
    expect(sleep.mock.calls.map(call => call[0])).toEqual([250, 500])
  })

  it('adds jitter from the injected random source', async () => {
    let gets = 0
    server.use(
      loggedIn(),
      http.get(devicesUrl, () => {
        gets++
        return gets < 2 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json([DEVICE])
      }),
    )
    const sleep = vi.fn(async () => {})
    await makeHttp({ sleep, random: () => 0.5 }).request('GET', '/devices?dataType=real')
    expect(sleep.mock.calls.map(call => call[0])).toEqual([300])
  })

  it('gives up after three attempts and reports the last status', async () => {
    let gets = 0
    server.use(loggedIn(), http.get(devicesUrl, () => {
      gets++
      return new HttpResponse(null, { status: 503 })
    }))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_http_error', status: 503 })
    expect(gets).toBe(3)
  })

  it('retries 408 but not 404', async () => {
    let timeouts = 0
    let notFounds = 0
    server.use(
      loggedIn(),
      http.get(`${BASE}/timeout`, () => {
        timeouts++
        return new HttpResponse(null, { status: 408 })
      }),
      http.get(`${BASE}/missing`, () => {
        notFounds++
        return new HttpResponse(null, { status: 404 })
      }),
    )
    const client = makeHttp()
    await expect(client.request('GET', '/timeout')).rejects.toMatchObject({ status: 408 })
    await expect(client.request('GET', '/missing')).rejects.toMatchObject({ status: 404 })
    expect(timeouts).toBe(3)
    expect(notFounds).toBe(1)
  })

  it('retries DELETE', async () => {
    let deletes = 0
    server.use(loggedIn(), http.delete(`${BASE}/devices/dev-123/profiles/p7`, () => {
      deletes++
      return deletes < 2 ? new HttpResponse(null, { status: 502 }) : new HttpResponse(null, { status: 204 })
    }))
    await makeHttp().request('DELETE', '/devices/dev-123/profiles/p7')
    expect(deletes).toBe(2)
  })

  it('never retries POST or PATCH, even on 503', async () => {
    let posts = 0
    let patches = 0
    server.use(
      loggedIn(),
      http.post(`${BASE}/devices/dev-123/profiles`, () => {
        posts++
        return new HttpResponse(null, { status: 503 })
      }),
      http.patch(`${BASE}/devices/dev-123/profiles/p7`, () => {
        patches++
        return new HttpResponse(null, { status: 503 })
      }),
    )
    const sleep = vi.fn(async () => {})
    const client = makeHttp({ sleep })
    await expect(client.request('POST', '/devices/dev-123/profiles', {})).rejects.toMatchObject({ status: 503 })
    await expect(client.request('PATCH', '/devices/dev-123/profiles/p7', {})).rejects.toMatchObject({ status: 503 })
    expect(posts).toBe(1)
    expect(patches).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a GET after a network error but not a POST', async () => {
    let gets = 0
    let posts = 0
    server.use(
      loggedIn(),
      http.get(devicesUrl, () => {
        gets++
        return gets < 2 ? HttpResponse.error() : HttpResponse.json([DEVICE])
      }),
      http.post(`${BASE}/devices/dev-123/profiles`, () => {
        posts++
        return HttpResponse.error()
      }),
    )
    const client = makeHttp()
    expect(await client.request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    await expect(client.request('POST', '/devices/dev-123/profiles', {})).rejects.toMatchObject({ code: 'fellow_network_error' })
    expect(gets).toBe(2)
    expect(posts).toBe(1)
  })

  it('does not retry an auth failure', async () => {
    let logins = 0
    server.use(http.post(loginUrl, () => {
      logins++
      return HttpResponse.json({ message: 'no' }, { status: 401 })
    }))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_auth_failed' })
    expect(logins).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm vitest run tests/unit/fellow/http.test.ts`
Expected: the `retries` cases fail (503 GET rejects instead of succeeding; sleep never called); earlier cases still pass.

- [ ] **Step 3: Replace `request` and add `backoff` in `http.ts`**

Replace the `request` method with:
```ts
  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    // Only idempotent methods are retried. A retried POST could create a duplicate profile after a 503 that
    // Fellow had in fact processed. This matches the reference client's urllib3 policy.
    const maxAttempts = RETRYABLE_METHODS.has(method) ? this.maxAttempts : 1
    for (let attempt = 1; ; attempt++) {
      let response: Response
      try {
        response = await this.sendAuthenticated(method, path, body)
      }
      catch (error) {
        if (error instanceof FellowError) throw error
        if (attempt >= maxAttempts) {
          throw new FellowError('fellow_network_error', `Fellow request failed: ${method} ${path}`, { cause: error })
        }
        await this.backoff(attempt, method, path, `network error: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (response.ok) return (await parseBody(response)) as T

      const retryable = response.status === 408 || response.status >= 500
      if (retryable && attempt < maxAttempts) {
        await this.backoff(attempt, method, path, `status ${response.status}`)
        continue
      }
      throw new FellowError('fellow_http_error', `Fellow responded ${response.status} to ${method} ${path}`, {
        status: response.status,
        body: await parseBody(response),
      })
    }
  }

  private async backoff(attempt: number, method: HttpMethod, path: string, reason: string): Promise<void> {
    const delayMs = this.backoffBaseMs * 2 ** (attempt - 1) + Math.floor(this.random() * 100)
    this.logger.warn({ method, path, attempt, delayMs, reason }, 'Retrying Fellow request')
    await this.sleep(delayMs)
  }
```
and add near the top of the file:
```ts
const RETRYABLE_METHODS: ReadonlySet<HttpMethod> = new Set(['GET', 'DELETE'])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/fellow/http.test.ts`
Expected: PASS, all cases including the earlier ones.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add server/utils/fellow/http.ts tests/unit/fellow/http.test.ts
git commit -m "feat(fellow): retry GET and DELETE on 408/5xx with jittered backoff"
```

---

### Task 8: TtlCache and FellowClient reads

**Files:**
- Create: `server/utils/fellow/cache.ts`, `server/utils/fellow/client.ts`
- Modify: `tests/helpers/fellow-fixtures.ts` (add handlers and `makeClient`)
- Test: `tests/unit/fellow/cache.test.ts`, `tests/unit/fellow/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class TtlCache { constructor(ttlMs: number, now?: () => number); get<T>(key: string): T | undefined; set<T>(key: string, value: T): T; clear(): void }
  interface FellowClientOptions extends FellowHttpOptions { dryRun?: boolean; cacheTtlMs?: number; now?: () => number }
  interface ReadOptions { fresh?: boolean }
  class FellowClient {
    constructor(options: FellowClientOptions)
    readonly dryRun: boolean
    getDevice(options?: ReadOptions): Promise<Device>
    getProfiles(options?: ReadOptions): Promise<Profile[]>
    getSchedules(options?: ReadOptions): Promise<Schedule[]>
  }
  ```
  Fixtures: `newCalls(): Calls`, `happyHandlers(calls: Calls, token?: string): HttpHandler[]`, `makeClient(overrides?: Partial<FellowClientOptions>): FellowClient`.

- [ ] **Step 1: Extend the fixtures**

Append to `tests/helpers/fellow-fixtures.ts`:
```ts
import { http, HttpResponse, type HttpHandler } from 'msw'
import { FellowClient, type FellowClientOptions } from '../../server/utils/fellow/client'

export interface Calls { login: number, devices: number, profiles: number, schedules: number }

export function newCalls(): Calls {
  return { login: 0, devices: 0, profiles: 0, schedules: 0 }
}

/** Login plus the three list GETs, all succeeding and counting into `calls`. */
export function happyHandlers(calls: Calls, token = 'token-1'): HttpHandler[] {
  return [
    http.post(`${BASE}/auth/login`, () => {
      calls.login++
      return HttpResponse.json({ accessToken: token, refreshToken: 'refresh-1' })
    }),
    http.get(`${BASE}/devices`, () => {
      calls.devices++
      return HttpResponse.json([DEVICE])
    }),
    http.get(`${BASE}/devices/${DEVICE.id}/profiles`, () => {
      calls.profiles++
      return HttpResponse.json([PROFILE_P7, PROFILE_P8])
    }),
    http.get(`${BASE}/devices/${DEVICE.id}/schedules`, () => {
      calls.schedules++
      return HttpResponse.json([SCHEDULE_S0])
    }),
  ]
}

export function makeClient(overrides: Partial<FellowClientOptions> = {}): FellowClient {
  return new FellowClient({ email: 'coffee@example.com', password: 'hunter2', sleep: async () => {}, random: () => 0, ...overrides })
}
```
(Move the `import` lines to the top of the file so the file stays valid.)

- [ ] **Step 2: Write the failing tests**

`tests/unit/fellow/cache.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { TtlCache } from '../../../server/utils/fellow/cache'

describe('TtlCache', () => {
  it('returns what was set until the TTL passes', () => {
    let now = 1_000
    const cache = new TtlCache(30_000, () => now)
    cache.set('k', { a: 1 })
    expect(cache.get('k')).toEqual({ a: 1 })
    now += 29_999
    expect(cache.get('k')).toEqual({ a: 1 })
    now += 1
    expect(cache.get('k')).toBeUndefined()
  })

  it('returns undefined for unknown keys and after clear', () => {
    const cache = new TtlCache(1_000, () => 0)
    expect(cache.get('nope')).toBeUndefined()
    cache.set('k', 1)
    cache.clear()
    expect(cache.get('k')).toBeUndefined()
  })

  it('set returns the value for chaining', () => {
    const cache = new TtlCache(1_000, () => 0)
    expect(cache.set('k', 'v')).toBe('v')
  })
})
```

`tests/unit/fellow/client.test.ts` (first section; Task 9 appends more):
```ts
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw'
import { BASE, DEVICE, happyHandlers, makeClient, newCalls } from '../../helpers/fellow-fixtures'

describe('FellowClient reads', () => {
  it('returns the first device and remembers its id for later paths', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient()
    expect(await client.getDevice()).toEqual(DEVICE)
    const profiles = await client.getProfiles()
    expect(profiles.map(p => p.id)).toEqual(['p7', 'p8'])
    expect(profiles[0]?.title).toBe('Debug-FellowAiden')
    expect(calls).toEqual({ login: 1, devices: 1, profiles: 1, schedules: 0 })
  })

  it('fetches the device once to learn the id, even when profiles are asked for first', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient()
    expect((await client.getSchedules()).map(s => s.id)).toEqual(['s0'])
    expect(calls.devices).toBe(1)
  })

  it('rejects an empty device list as fellow_bad_response', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () => HttpResponse.json({ accessToken: 't' })),
      http.get(`${BASE}/devices`, () => HttpResponse.json([])),
    )
    await expect(makeClient().getDevice()).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('serves repeat reads from the cache within 30 seconds', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    let now = 100_000
    const client = makeClient({ now: () => now })
    await client.getProfiles()
    await client.getProfiles()
    now += 29_000
    await client.getProfiles()
    expect(calls.profiles).toBe(1)
    now += 2_000
    await client.getProfiles()
    expect(calls.profiles).toBe(2)
  })

  it('bypasses the cache when fresh is set', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient()
    await client.getDevice()
    await client.getDevice({ fresh: true })
    expect(calls.devices).toBe(2)
  })

  it('collapses concurrent identical reads into one request', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient()
    await Promise.all([client.getProfiles(), client.getProfiles(), client.getProfiles()])
    expect(calls.profiles).toBe(1)
    expect(calls.devices).toBe(1)
  })

  it('exposes dryRun as false by default', () => {
    expect(makeClient().dryRun).toBe(false)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/fellow/cache.test.ts tests/unit/fellow/client.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write cache.ts and client.ts**

`server/utils/fellow/cache.ts`:
```ts
interface Entry { value: unknown, expiresAt: number }

/** Tiny in-memory cache with one TTL for every key. `now` is injectable for tests. */
export class TtlCache {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set<T>(key: string, value: T): T {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
    return value
  }

  clear(): void {
    this.entries.clear()
  }
}
```

`server/utils/fellow/client.ts` (reads only; Task 9 adds mutations):
```ts
import { z } from 'zod'
import { TtlCache } from './cache'
import { FellowError } from './errors'
import { FellowHttp, type FellowHttpOptions } from './http'
import { type FellowLogger, noopLogger } from './logger'
import { type Device, DeviceSchema, type Profile, ProfileSchema, type Schedule, ScheduleSchema } from './schemas'

export interface FellowClientOptions extends FellowHttpOptions {
  /** Log mutations instead of sending them. Reads still go to Fellow. */
  dryRun?: boolean
  cacheTtlMs?: number
  now?: () => number
}

export interface ReadOptions {
  /** Skip the read cache for this call. */
  fresh?: boolean
}

const DEVICES_PATH = '/devices?dataType=real'

/** Typed facade over FellowHttp: one brewer per account, cached list reads, dry-run support. */
export class FellowClient {
  readonly dryRun: boolean
  private readonly http: FellowHttp
  private readonly cache: TtlCache
  private readonly logger: FellowLogger
  private readonly now: () => number
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private knownDeviceId: string | null = null

  constructor(options: FellowClientOptions) {
    this.dryRun = options.dryRun ?? false
    this.logger = options.logger ?? noopLogger
    this.now = options.now ?? Date.now
    this.http = new FellowHttp(options)
    this.cache = new TtlCache(options.cacheTtlMs ?? 30_000, this.now)
  }

  async getDevice(options: ReadOptions = {}): Promise<Device> {
    return this.cachedRead('device', options, async () => {
      const devices = await this.http.request<unknown>('GET', DEVICES_PATH)
      const parsed = z.array(DeviceSchema).safeParse(devices)
      const first = parsed.success ? parsed.data[0] : undefined
      if (!first) {
        throw new FellowError('fellow_bad_response', 'Fellow returned no usable device for this account', { body: devices })
      }
      // The reference client assumes a single brewer per account and takes the first one.
      this.knownDeviceId = first.id
      return first
    })
  }

  async getProfiles(options: ReadOptions = {}): Promise<Profile[]> {
    return this.cachedRead('profiles', options, async () => {
      const raw = await this.http.request<unknown>('GET', `/devices/${await this.deviceId()}/profiles`)
      return z.array(ProfileSchema).parse(raw) as Profile[]
    })
  }

  async getSchedules(options: ReadOptions = {}): Promise<Schedule[]> {
    return this.cachedRead('schedules', options, async () => {
      const raw = await this.http.request<unknown>('GET', `/devices/${await this.deviceId()}/schedules`)
      return z.array(ScheduleSchema).parse(raw) as Schedule[]
    })
  }

  private async deviceId(): Promise<string> {
    return this.knownDeviceId ?? (await this.getDevice()).id
  }

  /** Cache hit → value; otherwise one shared load per key, so concurrent callers do not each hit Fellow. */
  private async cachedRead<T>(key: string, { fresh = false }: ReadOptions, load: () => Promise<T>): Promise<T> {
    if (!fresh) {
      const hit = this.cache.get<T>(key)
      if (hit !== undefined) {
        this.logger.debug({ key }, 'Fellow read served from cache')
        return hit
      }
      const pending = this.inFlight.get(key) as Promise<T> | undefined
      if (pending) return pending
    }
    const loading = load()
      .then(value => this.cache.set(key, value))
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, loading)
    return loading
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/fellow/cache.test.ts tests/unit/fellow/client.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add server/utils/fellow tests
git commit -m "feat(fellow): typed client reads with a 30s cache and in-flight de-duplication"
```

---

### Task 9: FellowClient mutations, dry run, brew links, title lookup

**Files:**
- Modify: `server/utils/fellow/client.ts`
- Create: `server/utils/fellow/index.ts`
- Test: `tests/unit/fellow/client.test.ts` (append)

**Interfaces:**
- Produces (all on `FellowClient`):
  ```ts
  createProfile(input: Record<string, unknown>): Promise<Profile>        // strips server fields, validates with ProfileInputSchema, POST
  updateProfile(profileId: string, input: Record<string, unknown>): Promise<void>   // PATCH; response shape UNVERIFIED so nothing is returned
  deleteProfile(profileId: string): Promise<void>
  generateShareLink(profileId: string): Promise<string>
  fetchSharedProfile(linkOrId: string): Promise<Record<string, unknown>>  // GET /shared/{id}, stripped, not validated
  createProfileFromLink(linkOrId: string): Promise<Profile>
  findProfileByTitle(title: string, options?: TitleLookupOptions): Promise<Profile | undefined>
  createSchedule(input: Record<string, unknown>): Promise<Schedule>
  updateSchedule(scheduleId: string, patch: Record<string, unknown>): Promise<void>
  deleteSchedule(scheduleId: string): Promise<void>
  adjustSetting(setting: string, value: unknown): Promise<unknown>       // UNVERIFIED
  refreshAccessToken(): Promise<never>
  ```
  `index.ts` re-exports everything public from `client`, `http`, `errors`, `logger`, `schemas`, `strip`, `brew-link`, `similarity`, `cache`.

- [ ] **Step 1: Append the failing tests**

Append to `tests/unit/fellow/client.test.ts` (extend the fixtures import with `PROFILE_INPUT, PROFILE_P7, SCHEDULE_INPUT, SCHEDULE_S0`, and add `vi` to the vitest import):
```ts
const loggedIn = () => http.post(`${BASE}/auth/login`, () => HttpResponse.json({ accessToken: 't' }))
const profilesUrl = `${BASE}/devices/${DEVICE.id}/profiles`
const schedulesUrl = `${BASE}/devices/${DEVICE.id}/schedules`

describe('FellowClient profile mutations', () => {
  it('creates a profile: strips server fields, posts the input, returns the parsed response, invalidates the cache', async () => {
    const calls = newCalls()
    let posted: unknown
    server.use(
      ...happyHandlers(calls),
      http.post(profilesUrl, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ ...PROFILE_INPUT, id: 'p9', createdAt: 'now' })
      }),
    )
    const client = makeClient()
    await client.getProfiles()
    const created = await client.createProfile(PROFILE_P7)
    expect(posted).toEqual(PROFILE_INPUT)
    expect(created.id).toBe('p9')
    await client.getProfiles()
    expect(calls.profiles).toBe(2)
  })

  it('rejects an invalid profile before sending anything', async () => {
    server.use(loggedIn(), http.get(`${BASE}/devices`, () => HttpResponse.json([DEVICE])))
    await expect(makeClient().createProfile({ ...PROFILE_INPUT, ratio: 12 })).rejects.toThrow(/ratio/)
  })

  it('treats a create response without an id as fellow_bad_response', async () => {
    server.use(...happyHandlers(newCalls()), http.post(profilesUrl, () => HttpResponse.json({ message: 'weird' })))
    await expect(makeClient().createProfile(PROFILE_INPUT)).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('updates a profile with PATCH and a stripped body', async () => {
    let patched: unknown
    server.use(
      ...happyHandlers(newCalls()),
      http.patch(`${profilesUrl}/p7`, async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    await expect(makeClient().updateProfile('p7', { ...PROFILE_P7, title: 'Renamed' })).resolves.toBeUndefined()
    expect(patched).toEqual({ ...PROFILE_INPUT, title: 'Renamed' })
  })

  it('deletes a profile', async () => {
    let deleted = false
    server.use(...happyHandlers(newCalls()), http.delete(`${profilesUrl}/p7`, () => {
      deleted = true
      return new HttpResponse(null, { status: 204 })
    }))
    await makeClient().deleteProfile('p7')
    expect(deleted).toBe(true)
  })

  it('generates a share link', async () => {
    server.use(...happyHandlers(newCalls()), http.post(`${profilesUrl}/p7/share`, () => HttpResponse.json({ link: 'https://brew.link/p/ws98' })))
    expect(await makeClient().generateShareLink('p7')).toBe('https://brew.link/p/ws98')
  })

  it('reports a share response without a link', async () => {
    server.use(...happyHandlers(newCalls()), http.post(`${profilesUrl}/p7/share`, () => HttpResponse.json({})))
    await expect(makeClient().generateShareLink('p7')).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('fetches a shared profile by link or id and strips server fields', async () => {
    server.use(loggedIn(), http.get(`${BASE}/shared/ws98`, () => HttpResponse.json({ ...PROFILE_P7, sharedFrom: 'someone' })))
    const client = makeClient()
    expect(await client.fetchSharedProfile('https://brew.link/p/ws98')).toEqual(PROFILE_INPUT)
    expect(await client.fetchSharedProfile('ws98')).toEqual(PROFILE_INPUT)
  })

  it('creates a profile from a brew link', async () => {
    let posted: unknown
    server.use(
      ...happyHandlers(newCalls()),
      http.get(`${BASE}/shared/ws98`, () => HttpResponse.json(PROFILE_P7)),
      http.post(profilesUrl, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ ...PROFILE_INPUT, id: 'p10' })
      }),
    )
    expect((await makeClient().createProfileFromLink('https://brew.link/p/ws98')).id).toBe('p10')
    expect(posted).toEqual(PROFILE_INPUT)
  })

  it('finds profiles by title, exactly or fuzzily', async () => {
    server.use(...happyHandlers(newCalls()))
    const client = makeClient()
    expect((await client.findProfileByTitle('morning cup'))?.id).toBe('p8')
    expect(await client.findProfileByTitle('FellowAiden')).toBeUndefined()
    expect((await client.findProfileByTitle('FellowAiden', { fuzzy: true }))?.id).toBe('p7')
  })
})

describe('FellowClient schedule mutations', () => {
  it('creates a schedule', async () => {
    let posted: unknown
    server.use(...happyHandlers(newCalls()), http.post(schedulesUrl, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ ...SCHEDULE_INPUT, id: 's1' })
    }))
    expect((await makeClient().createSchedule(SCHEDULE_INPUT)).id).toBe('s1')
    expect(posted).toEqual(SCHEDULE_INPUT)
  })

  it('rejects an invalid schedule before sending', async () => {
    server.use(loggedIn(), http.get(`${BASE}/devices`, () => HttpResponse.json([DEVICE])))
    await expect(makeClient().createSchedule({ ...SCHEDULE_INPUT, profileId: 'x1' })).rejects.toThrow(/profileId/)
  })

  it('patches a schedule and validates the patch', async () => {
    let patched: unknown
    server.use(...happyHandlers(newCalls()), http.patch(`${schedulesUrl}/s0`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ ...SCHEDULE_S0, enabled: false })
    }))
    const client = makeClient()
    await client.updateSchedule('s0', { enabled: false })
    expect(patched).toEqual({ enabled: false })
    await expect(client.updateSchedule('s0', { bogus: 1 })).rejects.toThrow()
  })

  it('deletes a schedule', async () => {
    let deleted = false
    server.use(...happyHandlers(newCalls()), http.delete(`${schedulesUrl}/s0`, () => {
      deleted = true
      return new HttpResponse(null, { status: 204 })
    }))
    await makeClient().deleteSchedule('s0')
    expect(deleted).toBe(true)
  })
})

describe('FellowClient device settings (UNVERIFIED)', () => {
  it('patches the device with a single setting', async () => {
    let patched: unknown
    server.use(...happyHandlers(newCalls()), http.patch(`${BASE}/devices/${DEVICE.id}`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ displayName: 'Bench' })
    }))
    expect(await makeClient().adjustSetting('displayName', 'Bench')).toEqual({ displayName: 'Bench' })
    expect(patched).toEqual({ displayName: 'Bench' })
  })

  it('surfaces refreshAccessToken as not implemented', async () => {
    await expect(makeClient().refreshAccessToken()).rejects.toMatchObject({ code: 'fellow_not_implemented' })
  })
})

describe('FellowClient dry run', () => {
  const spyLogger = () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

  it('still performs reads', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    expect((await makeClient({ dryRun: true }).getProfiles()).length).toBe(2)
    expect(calls.profiles).toBe(1)
  })

  it('suppresses mutations, logs them at info, and answers with well-shaped fakes', async () => {
    // Only read handlers exist: any mutation reaching msw fails the test via onUnhandledRequest: 'error'.
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const logger = spyLogger()
    const client = makeClient({ dryRun: true, logger, now: () => 1_700_000_000_000 })
    expect(client.dryRun).toBe(true)

    const profile = await client.createProfile(PROFILE_P7)
    expect(profile.id).toMatch(/^p\d+$/)
    expect(profile.title).toBe(PROFILE_INPUT.title)
    expect(logger.info).toHaveBeenCalledWith(
      { dryRun: true, method: 'POST', path: `/devices/${DEVICE.id}/profiles`, body: PROFILE_INPUT },
      expect.stringContaining('DRY RUN'),
    )

    const schedule = await client.createSchedule(SCHEDULE_INPUT)
    expect(schedule.id).toMatch(/^s\d+$/)
    expect((await client.createProfile(PROFILE_INPUT)).id).not.toBe(profile.id)

    expect(await client.generateShareLink('p7')).toBe('https://brew.link/p/dryrun')
    await expect(client.updateProfile('p7', PROFILE_INPUT)).resolves.toBeUndefined()
    await expect(client.deleteProfile('p7')).resolves.toBeUndefined()
    await expect(client.updateSchedule('s0', { enabled: false })).resolves.toBeUndefined()
    await expect(client.deleteSchedule('s0')).resolves.toBeUndefined()
    expect(await client.adjustSetting('displayName', 'x')).toEqual({ displayName: 'x' })
    // Nine mutations above; the login line is also logged at info, so count only dry-run entries.
    expect(logger.info.mock.calls.filter(call => (call[0] as { dryRun?: boolean }).dryRun === true)).toHaveLength(9)
  })

  it('still validates input and still invalidates the cache', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient({ dryRun: true })
    await expect(client.createProfile({ ...PROFILE_INPUT, title: '' })).rejects.toThrow(/title/)
    await client.getProfiles()
    await client.createProfile(PROFILE_INPUT)
    await client.getProfiles()
    expect(calls.profiles).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm vitest run tests/unit/fellow/client.test.ts`
Expected: the new describes fail with "is not a function"; the reads still pass.

- [ ] **Step 3: Add the mutation methods to `client.ts`**

Extend the imports at the top of `server/utils/fellow/client.ts`:
```ts
import { parseBrewLink } from './brew-link'
import { type HttpMethod } from './http'
import { ProfileInputSchema, ScheduleInputSchema, SchedulePatchSchema } from './schemas'
import { matchProfileByTitle, type TitleLookupOptions } from './similarity'
import { stripServerFields } from './strip'
```
(merge with the existing `./http` and `./schemas` imports rather than importing twice.)

Add these members to the class, after `getSchedules`:
```ts
  private dryRunSequence = 9000

  async createProfile(input: Record<string, unknown>): Promise<Profile> {
    const body = ProfileInputSchema.parse(stripServerFields(input))
    const path = `/devices/${await this.deviceId()}/profiles`
    const response = await this.mutate('POST', path, body, () => ({
      ...body,
      id: this.nextDryRunId('p'),
      createdAt: new Date(this.now()).toISOString(),
      isDefaultProfile: false,
    }))
    return this.parseOrBadResponse(ProfileSchema, response, 'create profile') as Profile
  }

  // UNVERIFIED: the reference client ignores the PATCH response body, so its shape is unknown and nothing is returned.
  async updateProfile(profileId: string, input: Record<string, unknown>): Promise<void> {
    const body = ProfileInputSchema.parse(stripServerFields(input))
    await this.mutate('PATCH', `/devices/${await this.deviceId()}/profiles/${profileId}`, body, () => ({ ...body, id: profileId }))
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.mutate('DELETE', `/devices/${await this.deviceId()}/profiles/${profileId}`, undefined, () => undefined)
  }

  async generateShareLink(profileId: string): Promise<string> {
    const response = await this.mutate('POST', `/devices/${await this.deviceId()}/profiles/${profileId}/share`, undefined, () => ({ link: 'https://brew.link/p/dryrun' }))
    const link = (response as { link?: unknown } | undefined)?.link
    if (typeof link !== 'string') {
      throw new FellowError('fellow_bad_response', 'Fellow did not return a share link', { body: response })
    }
    return link
  }

  /** The shared profile with server-side fields removed. Not validated: pass it to createProfile for that. */
  async fetchSharedProfile(linkOrId: string): Promise<Record<string, unknown>> {
    const brewId = parseBrewLink(linkOrId)
    const shared = await this.http.request<unknown>('GET', `/shared/${brewId}`)
    if (typeof shared !== 'object' || shared === null || Array.isArray(shared)) {
      throw new FellowError('fellow_bad_response', `Shared profile ${brewId} was not an object`, { body: shared })
    }
    return stripServerFields(shared as Record<string, unknown>)
  }

  async createProfileFromLink(linkOrId: string): Promise<Profile> {
    return this.createProfile(await this.fetchSharedProfile(linkOrId))
  }

  async findProfileByTitle(title: string, options: TitleLookupOptions = {}): Promise<Profile | undefined> {
    return matchProfileByTitle(await this.getProfiles(), title, options)
  }

  async createSchedule(input: Record<string, unknown>): Promise<Schedule> {
    const body = ScheduleInputSchema.parse(input)
    const response = await this.mutate('POST', `/devices/${await this.deviceId()}/schedules`, body, () => ({ ...body, id: this.nextDryRunId('s') }))
    return this.parseOrBadResponse(ScheduleSchema, response, 'create schedule') as Schedule
  }

  // UNVERIFIED: response body shape unknown (the reference client returns it raw), so nothing is returned.
  async updateSchedule(scheduleId: string, patch: Record<string, unknown>): Promise<void> {
    const body = SchedulePatchSchema.parse(patch)
    await this.mutate('PATCH', `/devices/${await this.deviceId()}/schedules/${scheduleId}`, body, () => ({ ...body, id: scheduleId }))
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.mutate('DELETE', `/devices/${await this.deviceId()}/schedules/${scheduleId}`, undefined, () => undefined)
  }

  // UNVERIFIED: the reference client sends { [setting]: value } but never names a setting. Not exposed by any route in Phase 1.
  async adjustSetting(setting: string, value: unknown): Promise<unknown> {
    const body = { [setting]: value }
    return this.mutate('PATCH', `/devices/${await this.deviceId()}`, body, () => body)
  }

  refreshAccessToken(): Promise<never> {
    return this.http.refreshAccessToken()
  }

  /** Sends a mutation, or in dry-run mode logs it and returns `fake()`. Either way the read cache is dropped. */
  private async mutate<T>(method: Exclude<HttpMethod, 'GET'>, path: string, body: unknown, fake: () => T): Promise<T> {
    let result: T
    if (this.dryRun) {
      this.logger.info({ dryRun: true, method, path, body }, 'DRY RUN: Fellow mutation suppressed')
      result = fake()
    }
    else {
      result = await this.http.request<T>(method, path, body)
    }
    this.cache.clear()
    return result
  }

  private nextDryRunId(prefix: 'p' | 's'): string {
    this.dryRunSequence += 1
    return `${prefix}${this.dryRunSequence}`
  }

  private parseOrBadResponse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new FellowError('fellow_bad_response', `Fellow's ${what} response was not the expected shape`, { body: value })
    }
    return parsed.data
  }
```

`server/utils/fellow/index.ts`:
```ts
export { parseBrewLink } from './brew-link'
export { TtlCache } from './cache'
export { FellowClient, type FellowClientOptions, type ReadOptions } from './client'
export { FellowError, type FellowErrorCode, type FellowErrorOptions } from './errors'
export { FELLOW_BASE_URL, FELLOW_USER_AGENT, FellowHttp, type FellowHttpOptions, type HttpMethod } from './http'
export { type FellowLogger, type LogFn, noopLogger } from './logger'
export * from './schemas'
export { matchProfileByTitle, similarityRatio, type TitleLookupOptions } from './similarity'
export { SERVER_SIDE_PROFILE_FIELDS, stripServerFields } from './strip'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/fellow`
Expected: PASS, every file.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add server/utils/fellow tests
git commit -m "feat(fellow): mutations, dry-run mode, brew.link import, share links, title lookup"
```

---

### Task 10: Nitro wiring, project docs, and checkpoint verification

**Files:**
- Create: `server/utils/logger.ts`, `server/utils/fellow-client.ts`, `server/api/health.get.ts`, `README.md`, `LICENSE`, `CHANGELOG.md`, `ARCHITECTURE.md`
- Modify: `package.json` (move `pino-pretty` to `dependencies`; it is imported statically so the production bundle can resolve it)

**Interfaces:**
- Consumes: `getConfig()` (Task 5), `FellowClient` (Task 9).
- Produces: `useLogger(): pino.Logger` and `useFellowClient(): FellowClient` (module singletons; auto-imported by Nitro in server routes), `GET /api/health` → `{ ok: true }`.

- [ ] **Step 1: Write the Nitro layer**

`server/utils/logger.ts` (minimal; checkpoint 2 adds redaction, request ids, and pino-roll):
```ts
import pino from 'pino'
import pretty from 'pino-pretty'
import { getConfig } from './config'

let instance: pino.Logger | undefined

/** Process-wide pino logger. Pretty in development, JSON lines in production. */
export function useLogger(): pino.Logger {
  if (!instance) {
    const config = getConfig()
    instance = config.isProduction
      ? pino({ level: config.logLevel })
      : pino({ level: config.logLevel }, pretty({ colorize: true, translateTime: 'HH:MM:ss' }))
  }
  return instance
}
```

`server/utils/fellow-client.ts`:
```ts
import { getConfig } from './config'
import { FellowClient } from './fellow'
import { useLogger } from './logger'

let instance: FellowClient | undefined

/** The single Fellow client for this process. Credentials come from config and never leave the server. */
export function useFellowClient(): FellowClient {
  if (!instance) {
    const { fellow } = getConfig()
    instance = new FellowClient({
      email: fellow.email,
      password: fellow.password,
      dryRun: fellow.dryRun,
      logger: useLogger().child({ module: 'fellow' }),
    })
  }
  return instance
}
```

`server/api/health.get.ts`:
```ts
/** Unauthenticated liveness probe. No Fellow call, no secrets. */
export default defineEventHandler(() => ({ ok: true }))
```

- [ ] **Step 2: Write the project docs**

`LICENSE`: the MIT license text with `Copyright (c) 2026 <holder>` where `<holder>` is the output of `git config --get user.name`, or `cschweda` if unset.

`CHANGELOG.md`:
```markdown
# Changelog

All notable changes to aiden-studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). The version in `package.json` is
bumped and an entry is added here at the end of every checkpoint and every release.

## [Unreleased]

## [0.1.0] - 2026-09-10

### Added

- Nuxt 4 project scaffold with lint, typecheck, Vitest, and msw tooling.
- Pure TypeScript Fellow client: lazy single-flight login, one re-login on 401,
  retries for GET and DELETE only, 30-second read cache with in-flight
  de-duplication, and a dry-run mode that logs mutations instead of sending them.
- Zod schemas for brew profiles and schedules mirroring the reference library's
  validation rules, with lenient response types.
- brew.link import, share-link generation, and exact or fuzzy profile lookup by title.
- Environment config loader validated once at startup.
- `GET /api/health`.
```

`README.md`:
```markdown
# aiden-studio

A personal web app for controlling a [Fellow Aiden](https://fellowproducts.com/products/aiden) coffee brewer:
brew profiles, schedules, brew.link import, and share links, from a browser on your own machine.

> **Status:** checkpoint 1 of 4. The Fellow client, configuration, and validation are complete and tested.
> There is no UI yet. See `CHANGELOG.md`.

## How it works

Fellow publishes no API. This app talks to the same cloud endpoints the Fellow mobile app uses, with your
Fellow account credentials, from a small Node server that runs on your machine. The browser never talks to
Fellow and never sees those credentials.

- **Phase 1 (now):** runs on your Mac, reachable only at `http://localhost:3000`.
- **Phase 2 (later):** the same build on a DigitalOcean droplet behind Nginx with login required.

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

`FELLOW_DRY_RUN=true` (the default in `.env.example`) logs every profile and schedule change instead of
sending it to Fellow. Reads still go through. Turn it off once you trust the UI.

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

Every variable is documented in `.env.example`. The important ones:

| Variable | Purpose |
|---|---|
| `FELLOW_EMAIL`, `FELLOW_PASSWORD` | Your Fellow app login. Server-side only. |
| `FELLOW_DRY_RUN` | `true` to log mutations instead of sending them. |
| `AUTH_ENABLED` | `false` skips login. Only allowed when `HOST` is loopback. |
| `HOST`, `PORT` | Bind address. Always set `HOST`; unset means every interface. |

## Project layout

- `server/utils/fellow/` — the Fellow client. Pure TypeScript, no Nuxt imports, so it can become its own package.
- `server/utils/config.ts` — the only place `process.env` is read.
- `server/api/` — thin Nuxt server routes over the client.
- `app/` — the Nuxt UI front end (checkpoint 3).
- `tests/` — Vitest, with msw standing in for Fellow.

See `ARCHITECTURE.md` for the layer split and the list of API behaviors that are inferred rather than verified.

## Hat tip: fellow-aiden

This project stands on the shoulders of [fellow-aiden](https://github.com/9b/fellow-aiden) by
[9b](https://github.com/9b), the Python library that first worked out how to talk to the Aiden. Fellow
documents none of this; everything aiden-studio knows about the endpoints, the required headers, the
profile and schedule validation rules, the server-side fields, and the fuzzy title matching was learned
from that library and its Brew Studio. aiden-studio is an independent TypeScript implementation that
ports the behavior rather than the code, but if it is useful to you, the credit belongs upstream.
fellow-aiden is licensed under GPL-3.0.

## License

MIT. See `LICENSE`.
```

`ARCHITECTURE.md`:
```markdown
# Architecture

## Two layers

1. **`server/utils/fellow/` — the Fellow client.** Pure TypeScript with zero Nuxt or browser imports.
   It uses the global `fetch` and takes its logger, clock, sleep, and randomness as constructor options
   so it is deterministic under test. `FellowHttp` owns authentication, retries, and JSON;
   `FellowClient` owns the typed API, the read cache, and dry-run behavior.
2. **`server/api/` — Nuxt server routes.** Thin wrappers that validate input with the same Zod schemas
   and call the single `useFellowClient()` instance. The browser only ever talks to these routes.

Configuration is parsed once by `server/utils/config.ts`. Nothing else reads `process.env`.

## Extracting the client to its own package

Copy `server/utils/fellow/` into a package whose only dependency is `zod`, export `index.ts`, and pass a
logger that satisfies `FellowLogger` (any pino logger does). The tests under `tests/unit/fellow/` and
`tests/helpers/fellow-fixtures.ts` move with it unchanged apart from import paths.

## UNVERIFIED behaviors

Everything below is inferred, not observed. Each is marked `UNVERIFIED` in code.

| Item | Where | What we assume |
|---|---|---|
| Token refresh | `http.ts` `refreshAccessToken` | Login returns `refreshToken`, but no refresh endpoint is known. We re-login with the password instead. |
| Device settings | `client.ts` `adjustSetting` | `PATCH /devices/{id}` takes `{ [setting]: value }`. No setting name is known. Not exposed by any route. |
| Pulse temperature count | `schemas.ts` | `ssPulseTemperatures.length === ssPulsesNumber` (same for batch). The reference example satisfies it; the API may not require it. |
| Profile PATCH response | `client.ts` `updateProfile` | Shape unknown; nothing is returned. Callers refetch. |
| Schedule PATCH response | `client.ts` `updateSchedule` | Same. |
| DELETE responses | `client.ts` | Bodies are ignored. |
| `profileType` | `schemas.ts` | Any integer; the reference example uses `0`. |
| Shared profile fields | `client.ts` `fetchSharedProfile` | May contain fields beyond the ten we strip; `createProfile` rejects unknown keys, which will surface them. |
```

- [ ] **Step 3: Move `pino-pretty` to dependencies and reinstall**

In `package.json`, move `"pino-pretty": "^13.1.3"` from `devDependencies` to `dependencies`. Run `pnpm install`.

- [ ] **Step 4: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green.

Run: `pnpm build`
Expected: success.

Smoke-test the built server without a `.env` file (the startup guard arrives in checkpoint 2, so the health route must work with any environment):
```sh
HOST=127.0.0.1 PORT=3999 FELLOW_EMAIL=coffee@example.com FELLOW_PASSWORD=x node .output/server/index.mjs &
sleep 2
curl -s http://127.0.0.1:3999/api/health
kill %1
```
Expected: `{"ok":true}`.

- [ ] **Step 5: Commit and tag the checkpoint**

```bash
git add -A
git commit -m "feat: wire Fellow client into Nitro, add health route and project docs"
git tag v0.1.0
```

## Self-review notes

- Spec coverage for checkpoint 1: §1 stack and pnpm rule (Task 1, 10), §3a client behavior (Tasks 3–9), §3a Zod (Task 2), §3b health and status routes (health in Task 10; `/api/status` needs a session and moves to checkpoint 2), §8 client and schema tests (Tasks 2–9), §9 checkpoint 1 scope, §10 README/ARCHITECTURE/`.env.example`/`.nvmrc`/LICENSE/CHANGELOG (Tasks 1, 10). Deferred by design: §4 DB, §5 auth and guard, §6 full logging, §7 UI, launchd.
- Type names used across tasks: `FellowError`/`FellowErrorCode` (2), `FellowLogger`/`noopLogger` (2), `ProfileInputSchema`/`ScheduleInputSchema`/`SchedulePatchSchema`/`DeviceSchema`/`ProfileSchema`/`ScheduleSchema` (2, used in 8–9), `stripServerFields` (3, used in 9), `parseBrewLink` (3, used in 9), `matchProfileByTitle`/`TitleLookupOptions` (4, used in 9), `FellowHttp`/`FellowHttpOptions`/`HttpMethod` (6, used in 8–9), `TtlCache` (8), `FellowClient`/`FellowClientOptions`/`ReadOptions` (8–9), `getConfig`/`AppConfig` (5, used in 10).
