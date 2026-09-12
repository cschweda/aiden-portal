import { brewPhase, isBrewing } from '../fellow/device'
import type { Device } from '../fellow/schemas'
import { plausibleEpoch } from './time'
import type { BrewRecord, TraceSample } from './types'

/** How the start time was learned. Only a brew whose start was seen (or reported by the brewer) gets a trusted duration. */
export type StartOrigin = 'transition' | 'device' | 'first-read'

export interface CurrentBrew {
  id: string
  startedAt: number
  startOrigin: StartOrigin
  profileId: string | null
  profileTitle: string | null
  /** The brew counter before this brew, when known. */
  cyclesBefore: number | null
  samples: TraceSample[]
}

export type BrewEvent
  = { type: 'started', brew: CurrentBrew }
    | { type: 'sample', brew: CurrentBrew }
    | { type: 'completed', record: BrewRecord }
    | { type: 'inferred', record: BrewRecord }

export interface TrackerOptions {
  /** The brew counter as last seen before this process started (the last stored record's `cyclesAfter`). */
  baselineCycles?: number | null
  /** Inferred brews recorded from one counter jump; anything beyond is dropped. */
  maxInferredPerPoll?: number
  /** With an empty log, record the last brew the brewer still reports (its end time, water, selected profile) on the first idle read. */
  seedLastBrew?: boolean
}

export type TitleLookup = (profileId: string) => string | undefined

/** Five minutes: the device's own start time is used only when it is at most this stale. */
const START_WINDOW_MS = 5 * 60_000
/** A brew still running after a day is a stuck state, not a brew; it is closed uncounted and watching starts over. */
export const MAX_BREW_MS = 24 * 60 * 60_000
/** Samples kept per brew; beyond this every other sample is dropped, halving the resolution of a very long steep. */
export const MAX_SAMPLES = 2000
/**
 * The brewer's `brewEndTime` advances on its own while idle (seen moving four hours with no brew), so for a brew the
 * poller did not watch it is believed only within this long after `brewStartTime`; otherwise the end is unknown and
 * set to the start.
 */
const UNWATCHED_END_WINDOW_MS = 3 * 60 * 60_000

/**
 * Turns successive device reads into brew events. Pure apart from the clock values it is given.
 * A brew observed live becomes a record when the brewer reads idle again; a brew counter that rose while the
 * brewer was idle becomes one inferred record per missing brew.
 */
export class BrewTracker {
  private current: CurrentBrew | null = null
  private idleCycles: number | null
  private sawIdle = false
  /** A brew was completed without a counter reading; the next idle read's +1 belongs to it, not to a missed brew. */
  private pendingIncrement = false
  private seedPending: boolean
  private readonly maxInferred: number

  constructor(options: TrackerOptions = {}) {
    this.idleCycles = options.baselineCycles ?? null
    this.maxInferred = options.maxInferredPerPoll ?? 5
    this.seedPending = options.seedLastBrew ?? false
  }

  get currentBrew(): CurrentBrew | null {
    return this.current
  }

  /** The brew counter the tracker will compare the next idle read against. */
  get baselineCycles(): number | null {
    return this.idleCycles
  }

  observe(device: Device, now: number, titleOf?: TitleLookup): BrewEvent[] {
    const brewing = isBrewing(device)
    if (brewing === undefined) return []
    const cycles = typeof device.totalBrewingCycles === 'number' ? device.totalBrewingCycles : undefined
    const events: BrewEvent[] = []

    if (brewing) {
      if (this.current && now - this.current.startedAt > MAX_BREW_MS) {
        events.push({ type: 'completed', record: this.complete(this.current, device, now, undefined) })
        this.current = null
        this.sawIdle = false
      }
      if (!this.current) {
        const profileId = device.ibSelectedProfileId ?? null
        const deviceStart = plausibleEpoch(device.brewStartTime, now - START_WINDOW_MS, now)
        const startedAt = deviceStart ?? now
        this.current = {
          id: `b${startedAt}`,
          startedAt,
          startOrigin: deviceStart !== undefined ? 'device' : this.sawIdle ? 'transition' : 'first-read',
          profileId,
          profileTitle: profileId ? titleOf?.(profileId) ?? null : null,
          cyclesBefore: this.idleCycles ?? cycles ?? null,
          samples: [],
        }
        events.push({ type: 'started', brew: this.current })
      }
      this.current.samples.push(sampleOf(device, now))
      if (this.current.samples.length > MAX_SAMPLES) this.current.samples = this.current.samples.filter((_, i) => i % 2 === 0)
      events.push({ type: 'sample', brew: this.current })
      return events
    }

    this.sawIdle = true
    if (this.seedPending && !this.current && this.idleCycles === null) {
      this.seedPending = false
      const startedAt = plausibleEpoch(device.brewStartTime, 0, now)
      if (startedAt !== undefined) {
        const endedAt = plausibleEpoch(device.brewEndTime, startedAt, Math.min(now, startedAt + UNWATCHED_END_WINDOW_MS)) ?? startedAt
        const profileId = device.ibSelectedProfileId ?? null
        events.push({
          type: 'inferred',
          record: {
            id: `s${cycles ?? 0}-${startedAt}`,
            startedAt,
            endedAt,
            durationS: null,
            waterMl: device.brewingWaterVolumeMl ?? null,
            profileId,
            profileTitle: profileId ? titleOf?.(profileId) ?? null : null,
            observed: false,
            counted: true,
            cyclesAfter: cycles ?? null,
            samples: [],
          },
        })
      }
    }
    if (this.current) {
      events.push({ type: 'completed', record: this.complete(this.current, device, now, cycles) })
      this.current = null
      if (cycles === undefined) this.pendingIncrement = true
    }
    else if (this.idleCycles !== null && cycles !== undefined && cycles > this.idleCycles) {
      const missing = Math.min(cycles - this.idleCycles - (this.pendingIncrement ? 1 : 0), this.maxInferred)
      const startedAt = plausibleEpoch(device.brewStartTime, 0, now) ?? now
      const endedAt = plausibleEpoch(device.brewEndTime, startedAt, Math.min(now, startedAt + UNWATCHED_END_WINDOW_MS)) ?? startedAt
      for (let i = 0; i < missing; i++) {
        const cyclesAfter = cycles - missing + i + 1
        const last = i === missing - 1
        const profileId = device.ibSelectedProfileId ?? null
        events.push({
          type: 'inferred',
          record: {
            id: `i${cyclesAfter}-${endedAt}`,
            startedAt,
            endedAt,
            durationS: null,
            waterMl: last ? device.brewingWaterVolumeMl ?? null : null,
            profileId,
            profileTitle: profileId ? titleOf?.(profileId) ?? null : null,
            observed: false,
            counted: true,
            cyclesAfter,
            samples: [],
          },
        })
      }
    }
    if (cycles !== undefined) {
      this.idleCycles = cycles
      this.pendingIncrement = false
    }
    return events
  }

  private complete(brew: CurrentBrew, device: Device, now: number, cycles: number | undefined): BrewRecord {
    const endedAt = plausibleEpoch(device.brewEndTime, brew.startedAt, now + 60_000) ?? now
    const counted = cycles !== undefined && brew.cyclesBefore !== null && cycles === brew.cyclesBefore + 1
    const trustedStart = brew.startOrigin !== 'first-read'
    return {
      id: brew.id,
      startedAt: brew.startedAt,
      endedAt,
      durationS: counted && trustedStart ? Math.max(0, Math.round((endedAt - brew.startedAt) / 1000)) : null,
      waterMl: device.brewingWaterVolumeMl ?? null,
      profileId: brew.profileId,
      profileTitle: brew.profileTitle,
      observed: true,
      counted,
      cyclesAfter: cycles ?? null,
      samples: brew.samples,
    }
  }
}

function sampleOf(device: Device, now: number): TraceSample {
  const sample: TraceSample = { t: now, phase: brewPhase(device) }
  if (typeof device.brewingWaterTemperatureC === 'number') sample.temperatureC = device.brewingWaterTemperatureC
  if (typeof device.heaterOn === 'boolean') sample.heaterOn = device.heaterOn
  if (typeof device.pumpOn === 'boolean') sample.pumpOn = device.pumpOn
  return sample
}
