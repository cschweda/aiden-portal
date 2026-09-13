import type { BrewRecord, CleaningRecord, DescaleMarker, TraceSample, TraceTarget } from '../../server/lib/history'
import type { Device, Profile, Schedule } from '../../server/lib/fellow/schemas'
import type { LogRecord } from '../../server/utils/log-reader'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A brew takes this long in the demo: long enough to watch the trace fill in, short enough to sit through. */
export const DEMO_BREW_SECONDS = 100
export const DEMO_SAMPLE_SECONDS = 5

function recipe(over: Partial<Profile> = {}): Record<string, unknown> {
  return {
    profileType: 0,
    ratio: 16,
    bloomEnabled: true,
    bloomRatio: 2,
    bloomDuration: 30,
    bloomTemperature: 96,
    ssPulsesEnabled: true,
    ssPulsesNumber: 3,
    ssPulsesInterval: 23,
    ssPulseTemperatures: [96, 95, 94],
    batchPulsesEnabled: true,
    batchPulsesNumber: 2,
    batchPulsesInterval: 20,
    batchPulseTemperatures: [96, 94],
    overallTemperature: 96,
    isDefaultProfile: false,
    instantBrew: false,
    folder: 'Mine',
    duration: null,
    lastUsedTime: null,
    ...over,
  }
}

/** Six recipes that look like a real library: two Fellow defaults, three of the owner's, one saved Drop. */
export function demoProfiles(): Profile[] {
  return [
    { id: 'p1', title: 'Morning Batch', ...recipe({ ratio: 16.5, overallTemperature: 93, folder: 'Mine', instantBrew: true }) },
    { id: 'p2', title: 'Weekend Pour-over', ...recipe({ ratio: 17, overallTemperature: 96, bloomDuration: 45, ssPulsesNumber: 4, ssPulseTemperatures: [96, 96, 95, 94] }) },
    { id: 'p3', title: 'Single Origin, Ethiopia', ...recipe({ ratio: 16, overallTemperature: 94.5, bloomRatio: 3 }) },
    { id: 'p4', title: 'Cold Brew Concentrate', ...recipe({ ratio: 14, overallTemperature: 50, bloomEnabled: false, bloomTemperature: 50, ssPulsesEnabled: false, ssPulseTemperatures: [50, 50, 50], batchPulseTemperatures: [50, 50], duration: 43_200 }) },
    { id: 'plocal0', title: 'Light Roast', ...recipe({ ratio: 17, overallTemperature: 99, folder: 'Fellow', isDefaultProfile: true, bloomTemperature: 99, ssPulseTemperatures: [99, 99, 99], batchPulseTemperatures: [99, 99] }) },
    { id: 'plocal1', title: 'Medium Roast', ...recipe({ folder: 'Fellow', isDefaultProfile: true }) },
    { id: 'd188', title: 'Prodigal, Mulu Blend', ...recipe({ ratio: 17, overallTemperature: null as unknown as number, folder: 'drops', bloomEnabled: false, ssPulsesNumber: 2, ssPulseTemperatures: [96, 92], batchPulseTemperatures: [96, 92] }) },
  ] as unknown as Profile[]
}

export function demoSchedules(): Schedule[] {
  return [
    { id: 's0', days: [false, true, true, true, true, true, false], secondFromStartOfTheDay: 6 * 3600 + 45 * 60, enabled: true, amountOfWater: 950, profileId: 'p1' },
    { id: 's1', days: [true, false, false, false, false, false, true], secondFromStartOfTheDay: 8 * 3600 + 30 * 60, enabled: false, amountOfWater: 600, profileId: 'p2' },
  ] as unknown as Schedule[]
}

export function demoDevice(now: number): Device {
  return {
    id: 'demo-aiden-0001',
    displayName: 'Aiden',
    serialNumber: 'DEMO-0000-0001',
    sku: 'EBRMB-NA',
    firmwareVersion: '1.5.16',
    wifiMacAddress: 'aa:bb:cc:dd:ee:01',
    isConnected: true,
    brewing: false,
    state: null,
    rinsing: false,
    cleaning: false,
    lidClosed: true,
    carafePresent: true,
    missingWater: false,
    singleBrewBasketPresent: false,
    batchBrewBasketPresent: true,
    heaterOn: false,
    pumpOn: false,
    brewError: false,
    brewingWaterTemperatureC: undefined,
    brewingWaterVolumeMl: 950,
    brewStartTime: String(Math.floor((now - 5 * HOUR) / 1000)),
    brewEndTime: String(Math.floor((now - 5 * HOUR + 6 * MINUTE) / 1000)),
    connectionTimestamp: String(now - 3 * DAY),
    totalBrewingCycles: 214,
    totalWaterVolumeL: 176_400,
    firmwareUpgradeRequired: false,
    unsynced: [],
    ibSelectedProfileId: 'p1',
    ibWaterQuantity: 950,
    elevation: 180,
    chimeVolume: 7,
    metricUnit: true,
    preciseUnit: false,
    displayClock: true,
    displayClock24hrMode: false,
    isAdvanceMode: false,
    languageCode: 'en-us',
    deviceTimezone: 'America/New_York',
    enabledFlags: ['base', 'profiles', 'notifications', 'schedules', 'remoteBrewing'],
  } as Device
}

const TRACE_PHASES: Array<{ until: number, phase: string, temperature: number }> = [
  { until: 30, phase: 'bloom', temperature: 96 },
  { until: 55, phase: 'pulse 1', temperature: 95 },
  { until: 80, phase: 'pulse 2', temperature: 93.5 },
  { until: DEMO_BREW_SECONDS, phase: 'drip finish', temperature: 91 },
]

/** Where a brew is at `elapsed` seconds: the phase, the water temperature, and whether the pump and heater run. */
export function traceAt(elapsed: number) {
  const step = TRACE_PHASES.find(p => elapsed < p.until) ?? TRACE_PHASES[TRACE_PHASES.length - 1]!
  const wobble = Math.round(Math.sin(elapsed / 7) * 2) / 4
  return {
    phase: step.phase,
    temperatureC: Math.round((step.temperature + wobble) * 2) / 2,
    heaterOn: step.phase !== 'drip finish',
    pumpOn: elapsed % 25 < 18,
  }
}

function traceSamples(startedAt: number): TraceSample[] {
  const samples: TraceSample[] = []
  for (let t = 0; t < DEMO_BREW_SECONDS; t += DEMO_SAMPLE_SECONDS) {
    const { phase, temperatureC, heaterOn, pumpOn } = traceAt(t)
    samples.push({ t: startedAt + t * 1000, phase: phase as TraceSample['phase'], temperatureC, heaterOn, pumpOn })
  }
  return samples
}

/** Three weeks of brews, mostly mornings, a few with a full trace so the History page has something to draw. */
/** What each demo recipe asks for, so the trace can show the target beside the measurement. */
const DEMO_TARGETS: Record<string, TraceTarget> = {
  p1: { bloomC: 96, pulsesC: [95, 93], overallC: 93 },
  p2: { bloomC: 96, pulsesC: [96, 96, 95, 94], overallC: 96 },
  p3: { bloomC: 95, pulsesC: [94.5, 94.5, 94.5], overallC: 94.5 },
}

export function demoBrews(now: number): BrewRecord[] {
  const brews: BrewRecord[] = []
  const profiles = ['p1', 'p1', 'p2', 'p1', 'p3', 'p1', 'p2']
  const titles: Record<string, string> = { p1: 'Morning Batch', p2: 'Weekend Pour-over', p3: 'Single Origin, Ethiopia' }
  let cycles = 214 - 26
  for (let day = 20; day >= 0; day--) {
    const perDay = day % 7 === 0 ? 2 : day % 3 === 0 ? 0 : 1
    for (let i = 0; i < perDay; i++) {
      const profileId = profiles[(day + i) % profiles.length]!
      const startedAt = now - day * DAY - (9 - i * 4) * HOUR + (day % 5) * 7 * MINUTE
      if (startedAt > now) continue
      const durationS = 95 + ((day * 7 + i * 13) % 40)
      cycles += 1
      const traced = day <= 2
      brews.push({
        id: `demo-b${startedAt}`,
        startedAt,
        endedAt: startedAt + durationS * 1000,
        durationS,
        waterMl: profileId === 'p2' ? 600 : 950,
        profileId,
        profileTitle: titles[profileId] ?? null,
        observed: true,
        counted: true,
        cyclesAfter: cycles,
        target: DEMO_TARGETS[profileId],
        samples: traced ? traceSamples(startedAt) : [],
      })
    }
  }
  brews.sort((a, b) => a.startedAt - b.startedAt)
  // The newest brew is recent, so the demo shows coffee sitting in the carafe.
  const newest = brews[brews.length - 1]
  if (newest) {
    newest.startedAt = now - 24 * MINUTE
    newest.endedAt = newest.startedAt + (newest.durationS ?? 110) * 1000
    newest.samples = traceSamples(newest.startedAt)
  }
  return brews
}

/** One descale program, twelve days ago: a cleaning phase and two rinses, as the brewer really reports them. */
export function demoCleanings(now: number): CleaningRecord[] {
  const base = now - 12 * DAY - 9 * HOUR
  const phases: Array<[string, number, number]> = [['clean', 0, 824], ['rinse', 16 * MINUTE, 463], ['rinse', 26 * MINUTE, 468]]
  return phases.map(([kind, offset, durationS], i) => ({
    id: `demo-c${base + offset}`,
    kind: kind as CleaningRecord['kind'],
    startedAt: base + offset,
    endedAt: base + offset + durationS * 1000,
    durationS,
    waterMl: 1500,
    cyclesDelta: 1,
    waterDeltaMl: 1500,
    cyclesAfter: 214 - 26 + i + 1,
    observedStart: true,
    samples: [],
  }))
}

export function demoDescaleMarker(now: number): DescaleMarker {
  return { at: now - 12 * DAY - 8 * HOUR, brews: 214 - 23, waterMl: 176_400 - 21_300 }
}

const LOG_LINES: Array<[number, string, Record<string, unknown>]> = [
  [30, 'API request', { method: 'GET', path: '/api/device' }],
  [30, 'API request', { method: 'GET', path: '/api/history' }],
  [30, 'Fellow brewer reachable', { deviceId: 'demo-aiden-0001', displayName: 'Aiden' }],
  [30, 'Brew logged', { observed: true, counted: true, durationS: 108, waterMl: 950, profileTitle: 'Morning Batch' }],
  [30, 'Remote start requested', { action: 'brew.start', dryRun: false }],
  [40, 'History poll failed; backing off', { code: 'fellow_network_error', failures: 1 }],
  [30, 'History polling recovered', { failures: 1 }],
  [30, 'Authenticated with Fellow', { module: 'fellow' }],
  [50, 'Fellow rejected the email or password', { code: 'fellow_auth_failed', status: 401 }],
  [30, 'Marked descaled', { action: 'descale.mark', brews: 191 }],
]

/** Log lines that read like the real ones, newest first, with a request id shared by the lines of one request. */
export function demoLogs(now: number): LogRecord[] {
  const records: LogRecord[] = []
  for (let i = 0; i < 60; i++) {
    const [level, msg, fields] = LOG_LINES[i % LOG_LINES.length]!
    const requestId = `demo-${String(1000 + Math.floor(i / 2))}-${(i % 2) + 1}`
    records.push({ level, levelName: level >= 50 ? 'error' : level >= 40 ? 'warn' : 'info', time: now - i * 4 * MINUTE, msg, requestId, rest: fields })
  }
  return records
}
