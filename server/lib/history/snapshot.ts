import type { DescaleStatus } from './descale'
import type { BrewExpectation } from './estimate'
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

/** The running brew as the pages see it: the tracker's record plus how long it is expected to take. */
export type CurrentBrewView = CurrentBrew & { expected: BrewExpectation | null }

export interface HistorySnapshot {
  stats: HistoryStats
  descale: DescaleStatus
  descaleHistory: DescaleMarker[]
  /** The brew running now, with its samples so far. */
  current: CurrentBrewView | null
  /** The newest brew that has a trace. */
  lastTraced: BrewRecord | null
  recent: BrewSummary[]
  polling: PollerState
  skippedLines: number
  /** Why the data directory cannot be used, or null. */
  storeError: string | null
  /**
   * When the brewer last reported a change to anything it senses. It stops reporting while it sits idle, so a
   * reading fetched a second ago can describe the machine as it was hours earlier.
   */
  sensorsChangedAt: number | null
  coffee: {
    /** When the coffee now in the carafe was brewed, or null when there is none to time. */
    sittingSince: number | null
    /** Minutes after which the dashboard stops calling it fresh. */
    freshMinutes: number
  }
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
