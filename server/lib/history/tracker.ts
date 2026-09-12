import { brewPhase, isBrewing } from '../fellow/device'
import type { Device } from '../fellow/schemas'
import { plausibleEpoch } from './time'
import type { BrewRecord, TraceSample } from './types'

export interface CurrentBrew {
  id: string
  startedAt: number
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
}

export type TitleLookup = (profileId: string) => string | undefined

/** Five minutes: the device's own start time is used only when it is at most this stale. */
const START_WINDOW_MS = 5 * 60_000

/**
 * Turns successive device reads into brew events. Pure apart from the clock values it is given.
 * A brew observed live becomes a record when the brewer reads idle again; a brew counter that rose while the
 * brewer was idle becomes one inferred record per missing brew.
 */
export class BrewTracker {
  private current: CurrentBrew | null = null
  private idleCycles: number | null
  private readonly maxInferred: number

  constructor(options: TrackerOptions = {}) {
    this.idleCycles = options.baselineCycles ?? null
    this.maxInferred = options.maxInferredPerPoll ?? 5
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
      if (!this.current) {
        const profileId = device.ibSelectedProfileId ?? null
        const startedAt = plausibleEpoch(device.brewStartTime, now - START_WINDOW_MS, now) ?? now
        this.current = {
          id: `b${startedAt}`,
          startedAt,
          profileId,
          profileTitle: profileId ? titleOf?.(profileId) ?? null : null,
          cyclesBefore: this.idleCycles ?? cycles ?? null,
          samples: [],
        }
        events.push({ type: 'started', brew: this.current })
      }
      this.current.samples.push(sampleOf(device, now))
      events.push({ type: 'sample', brew: this.current })
      return events
    }

    if (this.current) {
      events.push({ type: 'completed', record: this.complete(this.current, device, now, cycles) })
      this.current = null
    }
    else if (this.idleCycles !== null && cycles !== undefined && cycles > this.idleCycles) {
      const missing = Math.min(cycles - this.idleCycles, this.maxInferred)
      const endedAt = plausibleEpoch(device.brewEndTime, 0, now) ?? now
      const startedAt = plausibleEpoch(device.brewStartTime, 0, endedAt) ?? endedAt
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
    if (cycles !== undefined) this.idleCycles = cycles
    return events
  }

  private complete(brew: CurrentBrew, device: Device, now: number, cycles: number | undefined): BrewRecord {
    const endedAt = plausibleEpoch(device.brewEndTime, brew.startedAt, now + 60_000) ?? now
    const counted = cycles !== undefined && brew.cyclesBefore !== null && cycles === brew.cyclesBefore + 1
    return {
      id: brew.id,
      startedAt: brew.startedAt,
      endedAt,
      durationS: counted ? Math.max(0, Math.round((endedAt - brew.startedAt) / 1000)) : null,
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
