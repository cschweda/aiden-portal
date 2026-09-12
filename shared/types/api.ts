import type { Device, Profile, Schedule } from '../../server/lib/fellow/schemas'
import type { BrewRecord, BrewSummary, CleaningRecord, CurrentBrew, CurrentCleaning, DescaleMarker, DescaleStatus, HistorySnapshot, HistoryStats, PollerState, TraceSample } from '../../server/lib/history'
import type { LogLevel } from '../../server/utils/aiden-config'
import type { LogRecord } from '../../server/utils/log-reader'

export type { Device, Profile, Schedule }
export type { BrewRecord, BrewSummary, CleaningRecord, CurrentBrew, CurrentCleaning, DescaleMarker, DescaleStatus, HistoryStats, PollerState, TraceSample }

export type HistoryResponse = HistorySnapshot

export interface StatusResponse {
  dryRun: boolean
  version: string
  /** 'ok', 'unknown', or the last FellowError code such as 'fellow_auth_failed'. */
  fellow: string
}

export interface DeviceResponse {
  device: Device
  canStartBrew: boolean
  blockers: string[]
}

export type LogRecordView = LogRecord

export type { LogLevel }

export interface LogsResponse {
  available: boolean
  production: boolean
  file: string
  /** The level being written right now. */
  level: LogLevel
  records: LogRecordView[]
}
