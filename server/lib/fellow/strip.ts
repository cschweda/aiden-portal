/** Fields Fellow adds to a profile. They must never be sent back on create/update. Same list as the reference library. */
export const SERVER_SIDE_PROFILE_FIELDS = [
  'id',
  'createdAt',
  'deletedAt',
  'lastUsedTime',
  'sharedFrom',
  'isDefaultProfile',
  'instantBrew',
  'folder',
  'duration',
  'lastGBQuantity',
] as const

const SERVER_SIDE_FIELD_SET: ReadonlySet<string> = new Set(SERVER_SIDE_PROFILE_FIELDS)

/** Returns a copy of `profile` without the server-side fields. The input is not mutated. */
export function stripServerFields(profile: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(profile).filter(([key]) => !SERVER_SIDE_FIELD_SET.has(key)))
}
