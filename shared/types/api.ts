import type { Device, Profile, Schedule } from '../../server/lib/fellow/schemas'

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

export interface LogRecordView {
  time: number
  level: number
  levelName: string
  msg: string
  requestId?: string
  rest: Record<string, unknown>
}

export interface LogsResponse {
  available: boolean
  file: string
  records: LogRecordView[]
}
