import { describe, expect, it } from 'vitest'
import { DRIP_FINISH_S, expectBrewDuration, measuredDuration, POUR_ML_PER_S, recipeDuration } from '../../../server/lib/history'
import type { BrewRecord } from '../../../server/lib/history'

const brew = (profileId: string, durationS: number | null, overrides: Partial<BrewRecord> = {}): BrewRecord => ({
  id: `b${Math.random()}`, startedAt: 1, endedAt: 2, durationS, waterMl: 825, profileId, profileTitle: null, observed: true, counted: true, cyclesAfter: null, samples: [], ...overrides,
})
const recipe = { bloomEnabled: true, bloomDuration: 30, ssPulsesEnabled: true, ssPulsesNumber: 3, ssPulsesInterval: 23, batchPulsesEnabled: true, batchPulsesNumber: 1, batchPulsesInterval: null }

describe('measuredDuration', () => {
  it('averages the last ten trusted durations of the profile only', () => {
    const records = [brew('p1', 300), brew('p2', 900), brew('p1', 340), brew('p1', null), brew('p1', 500, { observed: false }), brew('p1', 500, { counted: false })]
    expect(measuredDuration(records, 'p1')).toEqual({ seconds: 320, basis: 'measured', brews: 2 })
    expect(measuredDuration(records, 'p3')).toBeNull()
    expect(measuredDuration(records, null)).toBeNull()
    const many = Array.from({ length: 12 }, (_, i) => brew('p1', i < 2 ? 1000 : 300))
    expect(measuredDuration(many, 'p1')).toEqual({ seconds: 300, basis: 'measured', brews: 10 })
  })
})

describe('recipeDuration', () => {
  it('adds bloom, the pour, the pauses between pulses, and the drip finish', () => {
    const batch = recipeDuration(recipe, { waterMl: 825, singleServe: false })
    expect(batch).toEqual({ seconds: Math.round(30 + 825 / POUR_ML_PER_S + DRIP_FINISH_S), basis: 'recipe' })
    const single = recipeDuration(recipe, { waterMl: 300, singleServe: true })
    expect(single).toEqual({ seconds: Math.round(30 + 300 / POUR_ML_PER_S + 2 * 23 + DRIP_FINISH_S), basis: 'recipe' })
    expect(recipeDuration({ ...recipe, bloomEnabled: false, ssPulsesEnabled: false }, { waterMl: null, singleServe: true })?.seconds).toBe(Math.round(500 / POUR_ML_PER_S + DRIP_FINISH_S))
    expect(recipeDuration(null, { waterMl: 825, singleServe: false })).toBeNull()
  })
})

describe('expectBrewDuration', () => {
  it('prefers a measurement and falls back to the recipe', () => {
    expect(expectBrewDuration([brew('p1', 340)], 'p1', recipe, { waterMl: 825, singleServe: false })).toMatchObject({ basis: 'measured', seconds: 340 })
    expect(expectBrewDuration([], 'p1', recipe, { waterMl: 825, singleServe: false })).toMatchObject({ basis: 'recipe' })
    expect(expectBrewDuration([], 'p1', null, { waterMl: 825, singleServe: false })).toBeNull()
  })
})
