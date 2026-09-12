import type { DescaleStatus } from './descale'
import type { HistoryStats } from './stats'
import type { CurrentBrew, CurrentCleaning } from './tracker'
import type { BrewRecord, CleaningRecord, DescaleMarker } from './types'

export interface PollerState {
  enabled: boolean
  running: boolean
  idlePollSeconds: number
  brewPollSeconds: number
  lastPollAt: number | null
  lastError: string | null
  failures: number
}

/** A brew record without its samples, for lists. */
export type BrewSummary = Omit<BrewRecord, 'samples'> & { sampleCount: number }

export interface HistorySnapshot {
  stats: HistoryStats
  descale: DescaleStatus
  descaleHistory: DescaleMarker[]
  /** The brew running now, with its samples so far. */
  current: CurrentBrew | null
  /** The newest brew that has a trace. */
  lastTraced: BrewRecord | null
  recent: BrewSummary[]
  polling: PollerState
  skippedLines: number
  /** Why the data directory cannot be used, or null. */
  storeError: string | null
  cleanings: {
    /** The cleaning or rinse cycle running now. */
    current: CurrentCleaning | null
    /** Newest first. */
    recent: CleaningRecord[]
    count: number
    averageDurationS: number | null
    lastEndedAt: number | null
  }
}

export function summarise(record: BrewRecord): BrewSummary {
  const { samples, ...rest } = record
  return { ...rest, sampleCount: samples.length }
}
