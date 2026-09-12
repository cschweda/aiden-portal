import type { BrewRecord } from './types'

/** The recipe fields the estimate reads; a Fellow profile satisfies this. */
export interface RecipeTiming {
  bloomEnabled?: boolean | null
  bloomDuration?: number | null
  ssPulsesEnabled?: boolean | null
  ssPulsesNumber?: number | null
  ssPulsesInterval?: number | null
  batchPulsesEnabled?: boolean | null
  batchPulsesNumber?: number | null
  batchPulsesInterval?: number | null
}

export interface BrewExpectation {
  seconds: number
  /** Measured from this profile's previous watched brews, or worked out from the recipe. */
  basis: 'measured' | 'recipe'
  /** How many brews the measurement rests on. */
  brews?: number
}

/**
 * Calibrated against one watched batch brew (825 mL, 30 s bloom, one pulse, 5 min 40 s): the Aiden pours at roughly
 * this rate and takes about this long to finish dripping. Both are UNVERIFIED beyond that one brew; measured
 * durations replace this as soon as the log has them.
 */
export const POUR_ML_PER_S = 3.5
export const DRIP_FINISH_S = 60

/** The mean of the last ten trusted durations of one profile, when at least one exists. */
export function measuredDuration(records: readonly BrewRecord[], profileId: string | null): BrewExpectation | null {
  if (!profileId) return null
  const durations = records
    .filter(r => r.profileId === profileId && r.observed && r.counted && r.durationS !== null && r.durationS > 0)
    .slice(-10)
    .map(r => r.durationS as number)
  if (durations.length === 0) return null
  return { seconds: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length), basis: 'measured', brews: durations.length }
}

/** Bloom, the pour at the assumed rate, the pauses between pulses, and the drip finish. */
export function recipeDuration(recipe: RecipeTiming | null | undefined, options: { waterMl: number | null, singleServe: boolean }): BrewExpectation | null {
  if (!recipe) return null
  const water = options.waterMl ?? 500
  const bloom = recipe.bloomEnabled ? recipe.bloomDuration ?? 0 : 0
  const enabled = options.singleServe ? recipe.ssPulsesEnabled : recipe.batchPulsesEnabled
  const pulses = enabled ? (options.singleServe ? recipe.ssPulsesNumber : recipe.batchPulsesNumber) ?? 1 : 1
  const interval = (options.singleServe ? recipe.ssPulsesInterval : recipe.batchPulsesInterval) ?? 0
  const seconds = bloom + water / POUR_ML_PER_S + Math.max(0, pulses - 1) * interval + DRIP_FINISH_S
  return { seconds: Math.round(seconds), basis: 'recipe' }
}

export function expectBrewDuration(records: readonly BrewRecord[], profileId: string | null, recipe: RecipeTiming | null | undefined, options: { waterMl: number | null, singleServe: boolean }): BrewExpectation | null {
  return measuredDuration(records, profileId) ?? recipeDuration(recipe, options)
}
