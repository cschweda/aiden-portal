import { z } from 'zod'

/** Inclusive half-step range, e.g. halfSteps(14, 20) → [14, 14.5, …, 20]. Mirrors the reference library's *_ENUM lists. */
export function halfSteps(min: number, max: number): number[] {
  return Array.from({ length: (max - min) * 2 + 1 }, (_, i) => min + i * 0.5)
}

export const RATIO_VALUES = halfSteps(14, 20)
export const BLOOM_RATIO_VALUES = halfSteps(1, 3)
export const TEMPERATURE_VALUES = halfSteps(50, 99)
export const TITLE_REGEX = /^[A-Za-z0-9 !@#$%&*\-+?/.,:)(]+$/
export const PROFILE_ID_REGEX = /^(p|plocal)\d+$/

function halfStep(values: number[], label: string) {
  const first = values[0]
  const last = values[values.length - 1]
  return z.literal(values, { error: `${label} must be between ${first} and ${last} in 0.5 steps` })
}

const temperatures = z.array(halfStep(TEMPERATURE_VALUES, 'temperature'))

export const ProfileInputSchema = z
  .strictObject({
    profileType: z.int(),
    title: z.string().min(1).max(50).regex(TITLE_REGEX, {
      error: 'title allows only A-Z, a-z, 0-9, space and !@#$%&*-+?/.,:)(',
    }),
    ratio: halfStep(RATIO_VALUES, 'ratio'),
    bloomEnabled: z.boolean(),
    bloomRatio: halfStep(BLOOM_RATIO_VALUES, 'bloomRatio'),
    bloomDuration: z.int().min(1).max(120),
    bloomTemperature: halfStep(TEMPERATURE_VALUES, 'bloomTemperature'),
    overallTemperature: halfStep(TEMPERATURE_VALUES, 'overallTemperature'),
    ssPulsesEnabled: z.boolean(),
    ssPulsesNumber: z.int().min(1).max(10),
    ssPulsesInterval: z.int().min(5).max(60),
    ssPulseTemperatures: temperatures,
    batchPulsesEnabled: z.boolean(),
    batchPulsesNumber: z.int().min(1).max(10),
    batchPulsesInterval: z.int().min(5).max(60),
    batchPulseTemperatures: temperatures,
  })
  // UNVERIFIED: the reference example has one temperature per pulse, but nothing proves the Fellow API requires it.
  .refine(p => p.ssPulseTemperatures.length === p.ssPulsesNumber, {
    path: ['ssPulseTemperatures'],
    error: 'must contain exactly ssPulsesNumber temperatures',
  })
  .refine(p => p.batchPulseTemperatures.length === p.batchPulsesNumber, {
    path: ['batchPulseTemperatures'],
    error: 'must contain exactly batchPulsesNumber temperatures',
  })

export type ProfileInput = z.infer<typeof ProfileInputSchema>

export const ScheduleInputSchema = z.strictObject({
  days: z.array(z.boolean()).length(7, { error: 'days must have exactly 7 entries, Sunday to Saturday' }),
  secondFromStartOfTheDay: z.int().min(0).max(86399),
  enabled: z.boolean(),
  amountOfWater: z.int().min(150).max(1500),
  profileId: z.string().regex(PROFILE_ID_REGEX, { error: 'profileId must be p<n> or plocal<n>' }),
})

export type ScheduleInput = z.infer<typeof ScheduleInputSchema>

export const SchedulePatchSchema = ScheduleInputSchema.partial()

export type SchedulePatch = z.infer<typeof SchedulePatchSchema>

// Responses are lenient on purpose: the API is undocumented and may grow fields. Only `id` is load-bearing.
// A known field with an unexpected type is dropped rather than failing the whole read.
const lenientBoolean = z.boolean().optional().catch(undefined)
const lenientString = z.string().optional().catch(undefined)
const lenientNumber = z.number().optional().catch(undefined)

/** Fields that only the account-wide device list reports; the per-device detail route omits them. */
export const DEVICE_INVENTORY_FIELDS = ['id', 'displayName', 'serialNumber', 'wifiMacAddress', 'btMacAddress', 'sku', 'firmwareVersion'] as const

export const DeviceSchema = z.looseObject({
  id: z.string(),
  displayName: lenientString,
  serialNumber: lenientString,
  sku: lenientString,
  firmwareVersion: lenientString,
  wifiMacAddress: lenientString,
  btMacAddress: lenientString,
  isConnected: lenientBoolean,
  brewing: lenientBoolean,
  rinsing: lenientBoolean,
  cleaning: lenientBoolean,
  lidClosed: lenientBoolean,
  carafePresent: lenientBoolean,
  missingWater: lenientBoolean,
  singleBrewBasketPresent: lenientBoolean,
  batchBrewBasketPresent: lenientBoolean,
  ibSelectedProfileId: lenientString,
  brewingProfileId: lenientString,
  brewStartTime: lenientNumber,
  totalBrewingCycles: lenientNumber,
  totalWaterVolumeL: lenientNumber,
  /** Live brew state object while a brew is in progress; null or absent when idle. Shape unknown. */
  state: z.unknown().optional(),
})
export const ProfileSchema = z.looseObject({ id: z.string(), title: z.string() })
export const ScheduleSchema = z.looseObject({ id: z.string() })

export type Device = z.infer<typeof DeviceSchema>
export type Profile = z.infer<typeof ProfileSchema> & Partial<ProfileInput>
export type Schedule = z.infer<typeof ScheduleSchema> & Partial<ScheduleInput>
