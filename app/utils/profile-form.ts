import type { ProfileInput } from '../../server/lib/fellow/schemas'
import { stripServerFields } from '../../server/lib/fellow/strip'

/** Editor limits, mirroring the value sets in the Zod schema. */
export const PROFILE_LIMITS = {
  ratio: { min: 14, max: 20, step: 0.5 },
  overallTemperature: { min: 50, max: 99, step: 0.5 },
  bloomRatio: { min: 1, max: 3, step: 0.5 },
  bloomDuration: { min: 1, max: 120, step: 1 },
  bloomTemperature: { min: 50, max: 99, step: 0.5 },
  pulsesNumber: { min: 1, max: 10, step: 1 },
  pulsesInterval: { min: 5, max: 60, step: 1 },
  pulseTemperature: { min: 50, max: 99, step: 0.5 },
} as const

/** A sensible starting recipe. The title is left empty for the user to fill in. */
export function blankProfile(): ProfileInput {
  return {
    profileType: 0,
    title: '',
    ratio: 16,
    overallTemperature: 94,
    bloomEnabled: true,
    bloomRatio: 2,
    bloomDuration: 30,
    bloomTemperature: 94,
    ssPulsesEnabled: true,
    ssPulsesNumber: 1,
    ssPulsesInterval: 20,
    ssPulseTemperatures: [94],
    batchPulsesEnabled: true,
    batchPulsesNumber: 1,
    batchPulsesInterval: 20,
    batchPulseTemperatures: [94],
  }
}

function fitTemperatures(temperatures: readonly number[], count: number, fallback: number): number[] {
  const fitted = temperatures.slice(0, count)
  const seed = fitted[fitted.length - 1] ?? fallback
  while (fitted.length < count) fitted.push(seed)
  return fitted
}

/** Makes the per-pulse temperature arrays follow the pulse counts: new pulses copy the last one, or the overall temperature. */
export function syncPulseTemperatures(profile: ProfileInput): ProfileInput {
  return {
    ...profile,
    ssPulseTemperatures: fitTemperatures(profile.ssPulseTemperatures, profile.ssPulsesNumber, profile.overallTemperature),
    batchPulseTemperatures: fitTemperatures(profile.batchPulseTemperatures, profile.batchPulsesNumber, profile.overallTemperature),
  }
}

/** Fellow leaves `overallTemperature` null when the stages differ; the first pulse temperature is the closest single value. */
function deriveOverallTemperature(profile: Record<string, unknown>): number | undefined {
  for (const key of ['ssPulseTemperatures', 'batchPulseTemperatures'] as const) {
    const temperatures = profile[key]
    if (Array.isArray(temperatures) && typeof temperatures[0] === 'number') return temperatures[0]
  }
  return typeof profile.bloomTemperature === 'number' ? profile.bloomTemperature : undefined
}

/**
 * A fetched profile (with server fields) or a partial one, made editable: server fields dropped, null and missing values
 * replaced by the blank recipe's (a null overall temperature by the first pulse temperature), arrays synced.
 */
export function toProfileInput(profile: Record<string, unknown>): ProfileInput {
  const blank = blankProfile()
  const known = stripServerFields(profile)
  const merged: Record<string, unknown> = { ...blank }
  for (const key of Object.keys(blank)) {
    if (known[key] !== undefined && known[key] !== null) merged[key] = known[key]
  }
  if (typeof known.overallTemperature !== 'number') merged.overallTemperature = deriveOverallTemperature(known) ?? blank.overallTemperature
  return syncPulseTemperatures(merged as ProfileInput)
}

function pulses(enabled: boolean | undefined, count: number | undefined, label: string): string | undefined {
  if (enabled === undefined && count === undefined) return undefined
  if (!enabled) return `${label} off`
  const n = count ?? 1
  return `${label} ${n} pulse${n === 1 ? '' : 's'}`
}

/** The single brew temperature, or the pulse temperatures as "96°" / "96–92°" when Fellow reports no overall value. */
function describeTemperature(profile: Partial<ProfileInput>): string | undefined {
  if (typeof profile.overallTemperature === 'number') return `${profile.overallTemperature}°`
  const candidates = profile.ssPulsesEnabled === false
    ? [profile.batchPulseTemperatures, profile.ssPulseTemperatures]
    : [profile.ssPulseTemperatures, profile.batchPulseTemperatures]
  const temperatures = candidates.find(list => Array.isArray(list) && list.length > 0)
  if (!temperatures) return undefined
  const first = temperatures[0]
  const last = temperatures[temperatures.length - 1]
  return temperatures.every(t => t === first) ? `${first}°` : `${first}–${last}°`
}

/** One line for lists: "1:16 · 94° · bloom 2:1 30s at 96° · SS 3 pulses · batch 2 pulses". */
export function describeProfile(profile: Partial<ProfileInput>): string {
  const parts: Array<string | undefined> = [
    profile.ratio === undefined ? undefined : `1:${profile.ratio}`,
    describeTemperature(profile),
    profile.bloomEnabled === undefined
      ? undefined
      : profile.bloomEnabled
        ? `bloom ${profile.bloomRatio ?? '?'}:1 ${profile.bloomDuration ?? '?'}s at ${profile.bloomTemperature ?? '?'}°`
        : 'no bloom',
    pulses(profile.ssPulsesEnabled, profile.ssPulsesNumber, 'SS'),
    pulses(profile.batchPulsesEnabled, profile.batchPulsesNumber, 'batch'),
  ]
  const present = parts.filter((part): part is string => part !== undefined)
  return present.length > 0 ? present.join(' · ') : '—'
}
