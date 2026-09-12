import type { BrewPhase } from '../fellow/device'

export interface TraceSample {
  /** Epoch milliseconds. */
  t: number
  phase: BrewPhase
  temperatureC?: number
  heaterOn?: boolean
  pumpOn?: boolean
}

export interface BrewRecord {
  id: string
  startedAt: number
  endedAt: number
  /** Seconds. Null unless the poller watched the brew and the counter rose by exactly one. */
  durationS: number | null
  waterMl: number | null
  /** The profile selected on the brewer when the brew was first seen; Fellow never says which one ran. */
  profileId: string | null
  profileTitle: string | null
  /** Seen running by the poller, as opposed to inferred from the brew counter afterwards. */
  observed: boolean
  /** The brew counter rose by exactly one across this brew. */
  counted: boolean
  /** The brew counter after this brew: the baseline for spotting brews the poller missed. */
  cyclesAfter: number | null
  samples: TraceSample[]
}

export interface DescaleMarker {
  at: number
  brews: number | null
  /** Fellow's `totalWaterVolumeL` at the time, which is millilitres despite its name. */
  waterMl: number | null
}

export interface DescaleState {
  current: DescaleMarker | null
  history: DescaleMarker[]
}
