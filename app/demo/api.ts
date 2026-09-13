import aiden from '../../aiden.config'
import { brewStartBlockers } from '../../server/lib/fellow/device'
import type { Device, Profile, Schedule } from '../../server/lib/fellow/schemas'
import { coffeeSittingSince, computeStats, descaleStatus, expectBrewDuration, summarise, targetOf } from '../../server/lib/history'
import type { BrewRecord, CleaningRecord, DescaleMarker, TraceSample } from '../../server/lib/history'
import type { LogRecord } from '../../server/utils/log-reader'
import {
  DEMO_BREW_SECONDS,
  DEMO_SAMPLE_SECONDS,
  demoBrews,
  demoCleanings,
  demoDescaleMarker,
  demoDevice,
  demoLogs,
  demoProfiles,
  demoSchedules,
  traceAt,
} from './fixtures'

/**
 * The demo build has no server: this answers every `/api` call in the browser from sample data, using the app's own
 * statistics, descale, and brew-phase logic so what a visitor sees is the real behaviour over invented numbers.
 * Everything lives in memory, so a reload starts the sample world again.
 */

interface DemoBrew { startedAt: number, profileId: string | null, samples: TraceSample[] }

interface DemoState {
  device: Device
  profiles: Profile[]
  schedules: Schedule[]
  brews: BrewRecord[]
  cleanings: CleaningRecord[]
  descale: { current: DescaleMarker | null, history: DescaleMarker[] }
  logs: LogRecord[]
  logLevel: string
  current: DemoBrew | null
  nextId: number
}

// Read from the real configuration, so the demo shows the thresholds the app itself would use.
const THRESHOLDS = { litres: aiden.maintenance.descaleAfterLitres, brews: aiden.maintenance.descaleAfterBrews }

let version = 'demo'

/** The plugin passes the real app version in, so the demo's footer says what it was built from. */
export function setDemoVersion(value: string): void {
  version = `${value} demo`
}

function freshState(now = Date.now()): DemoState {
  const marker = demoDescaleMarker(now)
  return {
    device: demoDevice(now),
    profiles: demoProfiles(),
    schedules: demoSchedules(),
    brews: demoBrews(now),
    cleanings: demoCleanings(now),
    descale: { current: marker, history: [marker] },
    logs: demoLogs(now),
    logLevel: 'info',
    current: null,
    nextId: 900,
  }
}

let state = freshState()

export function resetDemo(): void {
  state = freshState()
}

/** A brew started in the demo advances on the clock: samples appear every few seconds and it finishes on its own. */
function advance(now: number): void {
  const brew = state.current
  if (!brew) return
  const elapsed = (now - brew.startedAt) / 1000
  const wanted = Math.min(Math.floor(elapsed / DEMO_SAMPLE_SECONDS) + 1, Math.ceil(DEMO_BREW_SECONDS / DEMO_SAMPLE_SECONDS))
  while (brew.samples.length < wanted) {
    const t = brew.samples.length * DEMO_SAMPLE_SECONDS
    const { phase, temperatureC, heaterOn, pumpOn } = traceAt(t)
    brew.samples.push({ t: brew.startedAt + t * 1000, phase: phase as TraceSample['phase'], temperatureC, heaterOn, pumpOn })
  }
  const live = traceAt(Math.min(elapsed, DEMO_BREW_SECONDS - 1))
  if (elapsed < DEMO_BREW_SECONDS) {
    Object.assign(state.device, {
      brewing: true,
      state: { value: live.phase === 'bloom' ? 'b' : live.phase === 'drip finish' ? 'd' : `p${live.phase.slice(-1)}` },
      heaterOn: live.heaterOn,
      pumpOn: live.pumpOn,
      brewingWaterTemperatureC: live.temperatureC,
    })
    return
  }
  const waterMl = state.device.ibWaterQuantity ?? 950
  const cycles = (state.device.totalBrewingCycles ?? 0) + 1
  const profile = state.profiles.find(p => p.id === brew.profileId)
  state.brews.push({
    id: `demo-b${brew.startedAt}`,
    startedAt: brew.startedAt,
    endedAt: brew.startedAt + DEMO_BREW_SECONDS * 1000,
    durationS: DEMO_BREW_SECONDS,
    waterMl,
    profileId: brew.profileId,
    profileTitle: profile?.title ?? null,
    observed: true,
    counted: true,
    cyclesAfter: cycles,
    target: targetOf(profile, state.device.singleBrewBasketPresent === true) ?? undefined,
    samples: brew.samples,
  })
  Object.assign(state.device, {
    brewing: false,
    state: null,
    heaterOn: false,
    pumpOn: false,
    brewingWaterTemperatureC: undefined,
    brewingWaterVolumeMl: waterMl,
    totalBrewingCycles: cycles,
    totalWaterVolumeL: (state.device.totalWaterVolumeL ?? 0) + waterMl,
    brewStartTime: String(Math.floor(brew.startedAt / 1000)),
    brewEndTime: String(Math.floor((brew.startedAt + DEMO_BREW_SECONDS * 1000) / 1000)),
  })
  state.current = null
  log('info', 'Brew logged', { durationS: DEMO_BREW_SECONDS, waterMl, profileTitle: profile?.title ?? null })
}

function log(level: 'info' | 'warn' | 'error', msg: string, rest: Record<string, unknown> = {}): void {
  const levels = { info: 30, warn: 40, error: 50 } as const
  state.logs.unshift({ time: Date.now(), level: levels[level], levelName: level, msg, requestId: `demo-${state.nextId++}`, rest })
}

class DemoError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error ?? 'demo_error'))
  }
}

function historySnapshot(now: number) {
  const marker = state.descale.current
  const current = state.current
    ? {
        id: `b${state.current.startedAt}`,
        startedAt: state.current.startedAt,
        startOrigin: 'transition' as const,
        profileId: state.current.profileId,
        profileTitle: state.profiles.find(p => p.id === state.current?.profileId)?.title ?? null,
        cyclesBefore: state.device.totalBrewingCycles ?? null,
        target: targetOf(state.profiles.find(p => p.id === state.current?.profileId), state.device.singleBrewBasketPresent === true),
        samples: state.current.samples,
        expected: expectBrewDuration(state.brews, state.current.profileId, state.profiles.find(p => p.id === state.current?.profileId), {
          waterMl: state.device.ibWaterQuantity ?? null,
          singleServe: state.device.singleBrewBasketPresent === true,
        }),
      }
    : null
  return {
    stats: computeStats(state.brews, now),
    descale: descaleStatus(marker, state.device, THRESHOLDS, state.brews, now, state.cleanings),
    descaleHistory: state.descale.history,
    current,
    lastTraced: [...state.brews].reverse().find(b => b.samples.length > 0) ?? null,
    recent: state.brews.slice(-50).reverse().map(summarise),
    // The sample cadence is the demo's own; the idle cadence is the app's.
    polling: { enabled: true, running: true, idlePollSeconds: aiden.history.idlePollSeconds, brewPollSeconds: DEMO_SAMPLE_SECONDS, lastPollAt: now, lastError: null, failures: 0 },
    skippedLines: 0,
    storeError: null,
    coffee: {
      sittingSince: coffeeSittingSince({
        carafePresent: state.device.carafePresent,
        brewing: state.current !== null,
        lastBrewEndedAt: state.brews[state.brews.length - 1]?.endedAt ?? null,
        carafeRemovedAt: null,
      }, now),
      freshMinutes: aiden.maintenance.coffeeFreshMinutes,
    },
    cleanings: {
      current: null,
      recent: [...state.cleanings].reverse(),
      count: state.cleanings.length,
      averageDurationS: state.cleanings.reduce((total, c) => total + (c.durationS ?? 0), 0) / Math.max(1, state.cleanings.length),
      lastEndedAt: state.cleanings[state.cleanings.length - 1]?.endedAt ?? null,
    },
  }
}

function profileOr404(id: string): Profile {
  const profile = state.profiles.find(p => p.id === id)
  if (!profile) throw new DemoError(404, { error: 'not_found' })
  return profile
}

/** Routes a request to the sample world. Paths and shapes match `server/api/` exactly. */
function route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>, now: number): unknown {
  const segments = path.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const [head, ...rest] = segments

  if (head === 'health') return { ok: true }
  if (head === 'status') return { dryRun: false, version, fellow: 'ok' }

  if (head === 'device') {
    const blockers = brewStartBlockers(state.device)
    return { device: state.device, canStartBrew: blockers.length === 0, blockers }
  }

  if (head === 'profiles') {
    if (method === 'GET' && rest.length === 0) return state.profiles
    if (method === 'POST' && rest[0] === 'import') {
      const link = String(body.link ?? '')
      if (!/^https?:\/\/brew\.link\/p\/[A-Za-z0-9_-]+/.test(link)) throw new DemoError(400, { error: 'validation_failed', issues: [{ path: 'link', message: 'Expected a brew.link profile link' }] })
      const imported = { ...state.profiles[1], id: `p${state.nextId++}`, title: 'Imported from brew.link', folder: 'Mine' } as Profile
      state.profiles.push(imported)
      log('info', 'Profile imported', { profileId: imported.id })
      return imported
    }
    if (method === 'POST' && rest.length === 0) {
      const created = { ...body, id: `p${state.nextId++}`, isDefaultProfile: false, instantBrew: false, folder: 'Mine' } as unknown as Profile
      state.profiles.push(created)
      log('info', 'Profile created', { profileId: created.id, title: created.title })
      return created
    }
    if (rest[1] === 'share' && method === 'POST') {
      profileOr404(rest[0]!)
      return { link: `https://brew.link/p/demo${rest[0]}` }
    }
    if (method === 'PATCH') {
      const profile = profileOr404(rest[0]!)
      Object.assign(profile, body)
      log('info', 'Profile updated', { profileId: profile.id })
      return profile
    }
    if (method === 'DELETE') {
      profileOr404(rest[0]!)
      state.profiles = state.profiles.filter(p => p.id !== rest[0])
      log('info', 'Profile deleted', { profileId: rest[0] })
      return { ok: true }
    }
  }

  if (head === 'schedules') {
    if (method === 'GET') return state.schedules
    if (method === 'POST') {
      const created = { ...body, id: `s${state.nextId++}` } as unknown as Schedule
      state.schedules.push(created)
      log('info', 'Schedule created', { scheduleId: created.id })
      return created
    }
    const schedule = state.schedules.find(s => s.id === rest[0])
    if (!schedule) throw new DemoError(404, { error: 'not_found' })
    if (method === 'PATCH') {
      Object.assign(schedule, body)
      log('info', 'Schedule updated', { scheduleId: schedule.id })
      return schedule
    }
    if (method === 'DELETE') {
      state.schedules = state.schedules.filter(s => s.id !== rest[0])
      log('info', 'Schedule deleted', { scheduleId: rest[0] })
      return { ok: true }
    }
  }

  if (head === 'brew' && rest[0] === 'start' && method === 'POST') {
    const blockers = brewStartBlockers(state.device)
    if (blockers.length > 0) throw new DemoError(409, { error: 'brewer_not_ready', blockers })
    state.current = { startedAt: now, profileId: state.device.ibSelectedProfileId ?? null, samples: [] }
    advance(now)
    log('info', 'Remote start requested', { action: 'brew.start', dryRun: false })
    return { ok: true, result: { status: 'started', profileId: state.device.ibSelectedProfileId } }
  }

  if (head === 'history') {
    if (rest[0] === 'brews') {
      const found = state.brews.find(b => b.id === rest[1])
      if (!found) throw new DemoError(404, { error: 'not_found' })
      return found
    }
    return historySnapshot(now)
  }

  if (head === 'descale' && method === 'POST') {
    const marker: DescaleMarker = { at: now, brews: state.device.totalBrewingCycles ?? null, waterMl: state.device.totalWaterVolumeL ?? null }
    state.descale = { current: marker, history: [...state.descale.history, marker] }
    log('info', 'Marked descaled', { action: 'descale.mark' })
    return descaleStatus(marker, state.device, THRESHOLDS, state.brews, now, state.cleanings)
  }

  if (head === 'logs') {
    if (rest[0] === 'level' && method === 'PATCH') {
      state.logLevel = String(body.level ?? 'info')
      log('warn', 'Log level changed until the service restarts', { action: 'logs.level', level: state.logLevel })
      return { level: state.logLevel }
    }
    const lines = Number(query.get('lines') ?? 200)
    const minLevel = query.get('level')
    const requestId = query.get('requestId')
    const floor = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 }[minLevel ?? ''] ?? 0
    const records = state.logs
      .filter(record => record.level >= floor && (!requestId || record.requestId?.includes(requestId)))
      .slice(0, lines)
    return { available: true, production: true, file: 'logs/current.log', level: state.logLevel, records }
  }

  throw new DemoError(404, { error: 'not_found' })
}

/** The one entry point: a `$fetch`-shaped call answered from memory, with a little latency so it feels real. */
export async function demoFetch<T>(path: string, options: { method?: string, body?: unknown, query?: Record<string, unknown> } = {}): Promise<T> {
  const now = Date.now()
  advance(now)
  const [pathname, search] = path.split('?')
  const query = new URLSearchParams(search ?? '')
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const method = (options.method ?? 'GET').toUpperCase()
  const body = (typeof options.body === 'object' && options.body !== null ? options.body : {}) as Record<string, unknown>
  await new Promise(resolve => setTimeout(resolve, 90 + Math.random() * 120))
  try {
    return route(method, pathname ?? '', query, body, now) as T
  }
  catch (error) {
    if (error instanceof DemoError) {
      // Shaped like ofetch's error, which the app's error helper already understands.
      throw Object.assign(new Error(`Demo ${error.status}`), { status: error.status, statusCode: error.status, data: error.body, response: { status: error.status, _data: error.body } })
    }
    throw error
  }
}
