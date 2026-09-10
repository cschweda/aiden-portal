import { http, HttpResponse, type HttpHandler } from 'msw'
import { FellowClient, type FellowClientOptions } from '../../server/utils/fellow/client'
import type { ProfileInput, ScheduleInput } from '../../server/utils/fellow/schemas'

export const BASE = 'https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1'

export const DEVICE = { id: 'dev-123', displayName: 'Kitchen Aiden', firmwareVersion: '1.2.3' }

export const PROFILE_INPUT: ProfileInput = {
  profileType: 0,
  title: 'Debug-FellowAiden',
  ratio: 16,
  bloomEnabled: true,
  bloomRatio: 2,
  bloomDuration: 30,
  bloomTemperature: 96,
  ssPulsesEnabled: true,
  ssPulsesNumber: 3,
  ssPulsesInterval: 23,
  ssPulseTemperatures: [96, 97, 98],
  batchPulsesEnabled: true,
  batchPulsesNumber: 2,
  batchPulsesInterval: 30,
  batchPulseTemperatures: [96, 97],
}

export const PROFILE_P7 = {
  ...PROFILE_INPUT,
  id: 'p7',
  createdAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
  lastUsedTime: null,
  sharedFrom: null,
  isDefaultProfile: false,
  instantBrew: false,
  folder: null,
  duration: 240,
  lastGBQuantity: 30,
}

export const PROFILE_P8 = { ...PROFILE_P7, id: 'p8', title: 'Morning Cup' }

export const SCHEDULE_INPUT: ScheduleInput = {
  days: [true, true, false, true, false, true, false],
  secondFromStartOfTheDay: 28800,
  enabled: true,
  amountOfWater: 950,
  profileId: 'p7',
}

export const SCHEDULE_S0 = { ...SCHEDULE_INPUT, id: 's0' }

export interface Calls { login: number, devices: number, profiles: number, schedules: number }

export function newCalls(): Calls {
  return { login: 0, devices: 0, profiles: 0, schedules: 0 }
}

/** Login plus the three list GETs, all succeeding and counting into `calls`. */
export function happyHandlers(calls: Calls, token = 'token-1'): HttpHandler[] {
  return [
    http.post(`${BASE}/auth/login`, () => {
      calls.login++
      return HttpResponse.json({ accessToken: token, refreshToken: 'refresh-1' })
    }),
    http.get(`${BASE}/devices`, () => {
      calls.devices++
      return HttpResponse.json([DEVICE])
    }),
    http.get(`${BASE}/devices/${DEVICE.id}/profiles`, () => {
      calls.profiles++
      return HttpResponse.json([PROFILE_P7, PROFILE_P8])
    }),
    http.get(`${BASE}/devices/${DEVICE.id}/schedules`, () => {
      calls.schedules++
      return HttpResponse.json([SCHEDULE_S0])
    }),
  ]
}

export function makeClient(overrides: Partial<FellowClientOptions> = {}): FellowClient {
  return new FellowClient({ email: 'coffee@example.com', password: 'hunter2', sleep: async () => {}, random: () => 0, ...overrides })
}
