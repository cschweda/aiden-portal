import { describe, expect, it } from 'vitest'
import { type ProfileInput, ProfileInputSchema } from '../../../server/lib/fellow/schemas'
import { blankProfile, describeProfile, PROFILE_LIMITS, syncPulseTemperatures, toProfileInput } from '../../../app/utils/profile-form'
import { PROFILE_INPUT, PROFILE_P7 } from '../../helpers/fellow-fixtures'

describe('blankProfile', () => {
  it('is a valid profile the editor can start from, apart from the empty title', () => {
    const profile = blankProfile()
    expect(profile.title).toBe('')
    expect([...new Set(ProfileInputSchema.safeParse(profile).error?.issues.map(i => i.path.join('.')))]).toEqual(['title'])
    expect(ProfileInputSchema.safeParse({ ...profile, title: 'Named' }).success).toBe(true)
    expect(profile.ssPulseTemperatures).toHaveLength(profile.ssPulsesNumber)
    expect(profile.batchPulseTemperatures).toHaveLength(profile.batchPulsesNumber)
  })
  it('returns a fresh object each time', () => {
    expect(blankProfile()).not.toBe(blankProfile())
  })
})

describe('PROFILE_LIMITS', () => {
  it('matches the schema value sets', () => {
    expect(PROFILE_LIMITS.ratio).toEqual({ min: 14, max: 20, step: 0.5 })
    expect(PROFILE_LIMITS.overallTemperature).toEqual({ min: 50, max: 99, step: 0.5 })
    expect(PROFILE_LIMITS.bloomDuration).toEqual({ min: 1, max: 120, step: 1 })
    expect(PROFILE_LIMITS.pulsesInterval).toEqual({ min: 5, max: 60, step: 1 })
  })
})

describe('syncPulseTemperatures', () => {
  it('grows the arrays by repeating the last temperature', () => {
    const synced = syncPulseTemperatures({ ...PROFILE_INPUT, ssPulsesNumber: 5, ssPulseTemperatures: [90, 92] })
    expect(synced.ssPulseTemperatures).toEqual([90, 92, 92, 92, 92])
  })
  it('shrinks the arrays from the end', () => {
    const synced = syncPulseTemperatures({ ...PROFILE_INPUT, batchPulsesNumber: 1, batchPulseTemperatures: [96, 97] })
    expect(synced.batchPulseTemperatures).toEqual([96])
  })
  it('seeds an empty array from the overall temperature', () => {
    const synced = syncPulseTemperatures({ ...PROFILE_INPUT, overallTemperature: 91.5, ssPulsesNumber: 2, ssPulseTemperatures: [] })
    expect(synced.ssPulseTemperatures).toEqual([91.5, 91.5])
  })
  it('does not mutate its input and leaves matching arrays alone', () => {
    const input = { ...PROFILE_INPUT, ssPulseTemperatures: [96, 97, 98] }
    const synced = syncPulseTemperatures(input)
    expect(synced).not.toBe(input)
    expect(synced.ssPulseTemperatures).toEqual([96, 97, 98])
    expect(input.ssPulseTemperatures).toEqual([96, 97, 98])
  })
})

describe('toProfileInput', () => {
  it('strips server fields so a fetched profile can be edited and sent back', () => {
    expect(toProfileInput(PROFILE_P7)).toEqual(PROFILE_INPUT)
  })
  it('fills anything missing from the blank profile and syncs the arrays', () => {
    const partial = toProfileInput({ id: 'p1', title: 'Half', ratio: 17, ssPulsesNumber: 2 })
    expect(ProfileInputSchema.safeParse(partial).success).toBe(true)
    expect(partial.title).toBe('Half')
    expect(partial.ratio).toBe(17)
    expect(partial.ssPulseTemperatures).toHaveLength(2)
  })
  it('derives the overall temperature from the first pulse when Fellow reports null, and skips other nulls', () => {
    const dark = toProfileInput({ ...PROFILE_P7, overallTemperature: null, bloomTemperature: 99, ssPulsesNumber: 3, ssPulseTemperatures: [85, 85, 85], batchPulsesNumber: 1, batchPulseTemperatures: [85], lastUsedTime: null })
    expect(dark.overallTemperature).toBe(85)
    expect(dark.ssPulseTemperatures).toEqual([85, 85, 85])
    expect(dark.bloomTemperature).toBe(99)
    expect(ProfileInputSchema.safeParse(dark).success).toBe(true)
    const cold = toProfileInput({ id: 'p3', title: 'Cold', overallTemperature: null, ssPulsesNumber: null, ssPulseTemperatures: null, batchPulsesNumber: null, batchPulseTemperatures: null, bloomTemperature: 99 })
    expect(cold.overallTemperature).toBe(99)
    expect(ProfileInputSchema.safeParse(cold).success).toBe(true)
  })
})

describe('describeProfile', () => {
  it('summarises the recipe in one line', () => {
    expect(describeProfile(PROFILE_INPUT)).toBe('1:16 · 94° · bloom 2:1 30s at 96° · SS 3 pulses · batch 2 pulses')
  })
  it('says when bloom and pulses are off', () => {
    expect(describeProfile({ ...PROFILE_INPUT, bloomEnabled: false, ssPulsesEnabled: false, batchPulsesEnabled: false, ssPulsesNumber: 1 }))
      .toBe('1:16 · 94° · no bloom · SS off · batch off')
  })
  it('copes with a partial profile', () => {
    expect(describeProfile({})).toBe('—')
  })
  it('falls back to the pulse temperatures when Fellow reports no overall temperature', () => {
    const noOverall = { ...PROFILE_INPUT, overallTemperature: null } as unknown as Partial<ProfileInput>
    expect(describeProfile({ ...noOverall, ssPulseTemperatures: [85, 85, 85] })).toContain('· 85° ·')
    expect(describeProfile({ ...noOverall, ssPulseTemperatures: [96, 92] })).toContain('· 96–92° ·')
    expect(describeProfile({ ...noOverall, ssPulsesEnabled: false, ssPulseTemperatures: [96, 92], batchPulseTemperatures: [85] })).toContain('· 85° ·')
    expect(describeProfile({ ratio: 14, overallTemperature: undefined })).toBe('1:14')
  })
})
