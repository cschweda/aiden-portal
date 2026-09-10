import { describe, expect, it } from 'vitest'
import {
  DeviceSchema,
  ProfileInputSchema,
  ProfileSchema,
  RATIO_VALUES,
  ScheduleInputSchema,
  SchedulePatchSchema,
  TEMPERATURE_VALUES,
} from '../../../server/utils/fellow/schemas'
import { PROFILE_INPUT, SCHEDULE_INPUT } from '../../helpers/fellow-fixtures'

const profile = (overrides: Record<string, unknown> = {}) => ({ ...PROFILE_INPUT, ...overrides })
const schedule = (overrides: Record<string, unknown> = {}) => ({ ...SCHEDULE_INPUT, ...overrides })
const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success

describe('value sets', () => {
  it('ratio runs 14..20 in 0.5 steps', () => {
    expect(RATIO_VALUES).toEqual([14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20])
  })
  it('temperature runs 50..99 in 0.5 steps', () => {
    expect(TEMPERATURE_VALUES).toHaveLength(99)
    expect(TEMPERATURE_VALUES[0]).toBe(50)
    expect(TEMPERATURE_VALUES[98]).toBe(99)
  })
})

describe('ProfileInputSchema', () => {
  it('accepts the reference example', () => {
    expect(ProfileInputSchema.parse(PROFILE_INPUT)).toEqual(PROFILE_INPUT)
  })
  it.each([[13.5, false], [14, true], [14.25, false], [20, true], [20.5, false]])('ratio %s → %s', (ratio, ok) => {
    expect(accepts(ProfileInputSchema, profile({ ratio }))).toBe(ok)
  })
  it.each([[49.5, false], [50, true], [99, true], [99.5, false]])('bloomTemperature %s → %s', (t, ok) => {
    expect(accepts(ProfileInputSchema, profile({ bloomTemperature: t }))).toBe(ok)
  })
  it.each([[0.5, false], [1, true], [3, true], [3.5, false]])('bloomRatio %s → %s', (r, ok) => {
    expect(accepts(ProfileInputSchema, profile({ bloomRatio: r }))).toBe(ok)
  })
  it.each([[0, false], [1, true], [120, true], [121, false], [30.5, false]])('bloomDuration %s → %s', (d, ok) => {
    expect(accepts(ProfileInputSchema, profile({ bloomDuration: d }))).toBe(ok)
  })
  it.each([[0, false], [1, true], [50, true], [51, false]])('title length %s → %s', (len, ok) => {
    expect(accepts(ProfileInputSchema, profile({ title: 'a'.repeat(len) }))).toBe(ok)
  })
  it('rejects characters outside the title alphabet', () => {
    expect(accepts(ProfileInputSchema, profile({ title: 'bad"title' }))).toBe(false)
    expect(accepts(ProfileInputSchema, profile({ title: 'Ok! @#$%&*-+?/.,:)(' }))).toBe(true)
  })
  it('rejects unknown keys', () => {
    const result = ProfileInputSchema.safeParse(profile({ id: 'p1' }))
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(i => i.code)).toContain('unrecognized_keys')
  })
  it('requires one temperature per pulse', () => {
    expect(accepts(ProfileInputSchema, profile({ ssPulsesNumber: 2 }))).toBe(false)
    expect(accepts(ProfileInputSchema, profile({ batchPulseTemperatures: [96] }))).toBe(false)
    expect(accepts(ProfileInputSchema, profile({ ssPulsesNumber: 1, ssPulseTemperatures: [90] }))).toBe(true)
  })
  it('validates each pulse temperature', () => {
    expect(accepts(ProfileInputSchema, profile({ ssPulseTemperatures: [96, 97, 99.5] }))).toBe(false)
  })
  it.each([[0, false], [1, true], [10, true], [11, false]])('ssPulsesNumber %s → %s', (n, ok) => {
    const temps = Array.from({ length: Math.max(n, 0) }, () => 90)
    expect(accepts(ProfileInputSchema, profile({ ssPulsesNumber: n, ssPulseTemperatures: temps }))).toBe(ok)
  })
  it.each([[4, false], [5, true], [60, true], [61, false]])('batchPulsesInterval %s → %s', (i, ok) => {
    expect(accepts(ProfileInputSchema, profile({ batchPulsesInterval: i }))).toBe(ok)
  })
})

describe('ScheduleInputSchema', () => {
  it('accepts the reference example', () => {
    expect(ScheduleInputSchema.parse(SCHEDULE_INPUT)).toEqual(SCHEDULE_INPUT)
  })
  it.each([[6, false], [7, true], [8, false]])('days length %s → %s', (len, ok) => {
    expect(accepts(ScheduleInputSchema, schedule({ days: Array.from({ length: len }, () => true) }))).toBe(ok)
  })
  it('rejects non-boolean days', () => {
    expect(accepts(ScheduleInputSchema, schedule({ days: [1, 0, 1, 0, 1, 0, 1] }))).toBe(false)
  })
  it.each([[-1, false], [0, true], [86399, true], [86400, false]])('secondFromStartOfTheDay %s → %s', (s, ok) => {
    expect(accepts(ScheduleInputSchema, schedule({ secondFromStartOfTheDay: s }))).toBe(ok)
  })
  it.each([[149, false], [150, true], [1500, true], [1501, false]])('amountOfWater %s → %s', (w, ok) => {
    expect(accepts(ScheduleInputSchema, schedule({ amountOfWater: w }))).toBe(ok)
  })
  it.each([['p1', true], ['plocal3', true], ['x1', false], ['p', false], ['P1', false]])('profileId %s → %s', (id, ok) => {
    expect(accepts(ScheduleInputSchema, schedule({ profileId: id }))).toBe(ok)
  })
  it('rejects unknown keys', () => {
    expect(accepts(ScheduleInputSchema, schedule({ id: 's1' }))).toBe(false)
  })
})

describe('SchedulePatchSchema', () => {
  it('accepts a partial update', () => {
    expect(SchedulePatchSchema.parse({ enabled: false })).toEqual({ enabled: false })
  })
  it('still rejects unknown keys', () => {
    expect(accepts(SchedulePatchSchema, { enabled: false, bogus: 1 })).toBe(false)
  })
})

describe('response schemas are lenient', () => {
  it('passes unknown profile fields through', () => {
    const parsed = ProfileSchema.parse({ id: 'p1', title: 'x', brandNewField: 42 })
    expect(parsed.brandNewField).toBe(42)
  })
  it('requires an id', () => {
    expect(ProfileSchema.safeParse({ title: 'x' }).success).toBe(false)
  })
  it('does not enforce value sets on reads', () => {
    expect(ProfileSchema.safeParse({ id: 'p1', title: 'x', ratio: 12.25 }).success).toBe(true)
  })
  it('accepts a device with only an id', () => {
    expect(DeviceSchema.parse({ id: 'd1', weird: true })).toEqual({ id: 'd1', weird: true })
  })
})
