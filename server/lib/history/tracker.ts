import { brewPhase, isBrewing } from '../fellow/device'
import type { Device } from '../fellow/schemas'
import { plausibleEpoch } from './time'
import type { BrewRecord, CleaningKind, CleaningRecord, CleaningSample, TraceSample, TraceTarget } from './types'

/** How the start time was learned. Only a brew whose start was seen (or reported by the brewer) gets a trusted duration. */
export type StartOrigin = 'transition' | 'device' | 'first-read'

export interface CurrentBrew {
  id: string
  startedAt: number
  startOrigin: StartOrigin
  profileId: string | null
  profileTitle: string | null
  target: TraceTarget | null
  /** The brew counter before this brew, when known. */
  cyclesBefore: number | null
  samples: TraceSample[]
}

export interface CurrentCleaning {
  id: string
  kind: CleaningKind
  startedAt: number
  startOrigin: StartOrigin
  cyclesBefore: number | null
  waterBefore: number | null
  samples: CleaningSample[]
}

export type BrewEvent
  = { type: 'started', brew: CurrentBrew }
    | { type: 'sample', brew: CurrentBrew }
    | { type: 'completed', record: BrewRecord }
    | { type: 'inferred', record: BrewRecord }
    | { type: 'cleaningStarted', cleaning: CurrentCleaning }
    | { type: 'cleaningSample', cleaning: CurrentCleaning }
    | { type: 'cleaningCompleted', record: CleaningRecord }

export interface TrackerOptions {
  /** The brew counter as last seen before this process started (the last stored record's `cyclesAfter`). */
  baselineCycles?: number | null
  /** Inferred brews recorded from one counter jump; anything beyond is dropped. */
  maxInferredPerPoll?: number
  /** With an empty log, record the last brew the brewer still reports (its end time, water, selected profile) on the first idle read. */
  seedLastBrew?: boolean
}

/** The profile a brew is running, as far as the app knows it. Only the fields a trace needs are read. */
export interface TrackedProfile {
  title?: string
  bloomEnabled?: boolean | null
  bloomTemperature?: number | null
  overallTemperature?: number | null
  ssPulseTemperatures?: number[] | null
  batchPulseTemperatures?: number[] | null
}

export type ProfileLookup = (profileId: string) => TrackedProfile | undefined

/** The recipe's temperatures for the basket that is in, or null when the profile says nothing useful. */
export function targetOf(profile: TrackedProfile | undefined, singleServe: boolean): TraceTarget | null {
  if (!profile) return null
  const pulses = (singleServe ? profile.ssPulseTemperatures : profile.batchPulseTemperatures) ?? []
  const bloomC = profile.bloomEnabled === false ? null : profile.bloomTemperature ?? null
  const overallC = profile.overallTemperature ?? pulses[0] ?? null
  if (bloomC === null && pulses.length === 0 && overallC === null) return null
  return { bloomC, pulsesC: [...pulses], overallC }
}

/**
 * How far back the brewer's own `brewStartTime` is believed for a brew it says is running now. Observed on a real
 * brewer: `brewStartTime` is the current brew's start and stays put until the next brew, while `brewEndTime`
 * drifts on its own. A generous window matters because a restart mid-brew (every reinstall does one) would
 * otherwise lose the start and with it the duration; six hours also covers a cold-brew steep.
 */
const START_WINDOW_MS = 6 * 60 * 60_000
/** A descale runs for the better part of an hour, so its reported start is believed up to two hours back. */
const CLEANING_START_WINDOW_MS = 2 * 60 * 60_000
/** A cleaning cycle still running after this long is a stuck flag; it is closed and watching starts over. */
export const MAX_CLEANING_MS = 6 * 60 * 60_000
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
  private currentCleaning: CurrentCleaning | null = null
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

  get currentCleaningCycle(): CurrentCleaning | null {
    return this.currentCleaning
  }

  /** The brew counter the tracker will compare the next idle read against. */
  get baselineCycles(): number | null {
    return this.idleCycles
  }

  observe(device: Device, now: number, profileOf?: ProfileLookup): BrewEvent[] {
    const brewing = isBrewing(device)
    if (brewing === undefined) return []
    const cycles = typeof device.totalBrewingCycles === 'number' ? device.totalBrewingCycles : undefined
    const events: BrewEvent[] = []

    // A cleaning or rinse cycle: the brewer sets `brewing` too, so brews are not tracked while it runs, and any
    // movement of the counters across the cycle belongs to the cycle, never to an inferred brew.
    const cleaningKind: CleaningKind | null = device.cleaning === true ? 'clean' : device.rinsing === true ? 'rinse' : null
    if (cleaningKind) {
      if (this.current) {
        events.push({ type: 'completed', record: this.complete(this.current, device, now, undefined) })
        this.current = null
      }
      if (this.currentCleaning && now - this.currentCleaning.startedAt > MAX_CLEANING_MS) {
        events.push({ type: 'cleaningCompleted', record: this.completeCleaning(this.currentCleaning, device, now) })
        this.currentCleaning = null
      }
      if (!this.currentCleaning) {
        const deviceStart = plausibleEpoch(device.brewStartTime, now - CLEANING_START_WINDOW_MS, now)
        const startedAt = deviceStart ?? now
        this.currentCleaning = {
          id: `c${startedAt}`,
          kind: cleaningKind,
          startedAt,
          startOrigin: deviceStart !== undefined ? 'device' : this.sawIdle ? 'transition' : 'first-read',
          cyclesBefore: this.idleCycles ?? cycles ?? null,
          waterBefore: typeof device.totalWaterVolumeL === 'number' ? device.totalWaterVolumeL : null,
          samples: [],
        }
        events.push({ type: 'cleaningStarted', cleaning: this.currentCleaning })
      }
      const sample: CleaningSample = { t: now }
      if (typeof device.heaterOn === 'boolean') sample.heaterOn = device.heaterOn
      if (typeof device.pumpOn === 'boolean') sample.pumpOn = device.pumpOn
      this.currentCleaning.samples.push(sample)
      if (this.currentCleaning.samples.length > MAX_SAMPLES) this.currentCleaning.samples = this.currentCleaning.samples.filter((_, i) => i % 2 === 0)
      events.push({ type: 'cleaningSample', cleaning: this.currentCleaning })
      return events
    }
    if (this.currentCleaning) {
      events.push({ type: 'cleaningCompleted', record: this.completeCleaning(this.currentCleaning, device, now) })
      this.currentCleaning = null
      // Whatever the counters did across the cycle is the cycle's; the next read starts from here.
      if (cycles !== undefined) this.idleCycles = cycles
      this.pendingIncrement = false
    }

    if (brewing) {
      if (this.current && now - this.current.startedAt > MAX_BREW_MS) {
        events.push({ type: 'completed', record: this.complete(this.current, device, now, undefined) })
        this.current = null
        this.sawIdle = false
      }
      if (!this.current) {
        const profileId = device.ibSelectedProfileId ?? null
        const profile = profileId ? profileOf?.(profileId) : undefined
        const deviceStart = plausibleEpoch(device.brewStartTime, now - START_WINDOW_MS, now)
        const startedAt = deviceStart ?? now
        this.current = {
          id: `b${startedAt}`,
          startedAt,
          startOrigin: deviceStart !== undefined ? 'device' : this.sawIdle ? 'transition' : 'first-read',
          profileId,
          profileTitle: profileId ? profile?.title ?? null : null,
          target: targetOf(profile, device.singleBrewBasketPresent === true),
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
            profileTitle: profileId ? profileOf?.(profileId)?.title ?? null : null,
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
            profileTitle: profileId ? profileOf?.(profileId)?.title ?? null : null,
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

  private completeCleaning(cleaning: CurrentCleaning, device: Device, now: number): CleaningRecord {
    const cycles = typeof device.totalBrewingCycles === 'number' ? device.totalBrewingCycles : null
    const water = typeof device.totalWaterVolumeL === 'number' ? device.totalWaterVolumeL : null
    const observedStart = cleaning.startOrigin !== 'first-read'
    return {
      id: cleaning.id,
      kind: cleaning.kind,
      startedAt: cleaning.startedAt,
      endedAt: now,
      durationS: observedStart ? Math.max(0, Math.round((now - cleaning.startedAt) / 1000)) : null,
      waterMl: device.brewingWaterVolumeMl ?? null,
      cyclesDelta: cycles !== null && cleaning.cyclesBefore !== null ? cycles - cleaning.cyclesBefore : null,
      waterDeltaMl: water !== null && cleaning.waterBefore !== null ? water - cleaning.waterBefore : null,
      cyclesAfter: cycles,
      observedStart,
      samples: cleaning.samples,
    }
  }

  /**
   * The real start of a brew the poller joined already running. Such a brew is anchored on the clock at pickup,
   * which a restart mid-brew (every reinstall does one) puts near the end of it. The brewer does report the true
   * start, but while the brew runs it can still be holding the previous one, which is why the pickup rejected it;
   * once the brew is over it has caught up, so it is asked again here and believed when it lands between the same
   * six-hour window and the pickup. Only the start is revisited: the end keeps the pickup as its lower bound, so
   * nothing that reads `endedAt` (the coffee clock) can move.
   */
  private recoverStart(brew: CurrentBrew, device: Device, now: number): number | undefined {
    if (brew.startOrigin !== 'first-read') return undefined
    return plausibleEpoch(device.brewStartTime, now - START_WINDOW_MS, brew.startedAt)
  }

  private complete(brew: CurrentBrew, device: Device, now: number, cycles: number | undefined): BrewRecord {
    const endedAt = plausibleEpoch(device.brewEndTime, brew.startedAt, now + 60_000) ?? now
    const recovered = this.recoverStart(brew, device, now)
    const startedAt = recovered ?? brew.startedAt
    const counted = cycles !== undefined && brew.cyclesBefore !== null && cycles === brew.cyclesBefore + 1
    const trustedStart = brew.startOrigin !== 'first-read' || recovered !== undefined
    return {
      id: brew.id,
      startedAt,
      endedAt,
      durationS: counted && trustedStart ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : null,
      waterMl: device.brewingWaterVolumeMl ?? null,
      profileId: brew.profileId,
      profileTitle: brew.profileTitle,
      observed: true,
      counted,
      cyclesAfter: cycles ?? null,
      ...(brew.target ? { target: brew.target } : {}),
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
