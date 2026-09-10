import type { Device, Profile, Schedule } from '../../server/lib/fellow/schemas'
import type { LogRecord } from '../../server/utils/log-reader'

export type { Device, Profile, Schedule }

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

export interface LogsResponse {
  available: boolean
  production: boolean
  file: string
  records: LogRecordView[]
}
