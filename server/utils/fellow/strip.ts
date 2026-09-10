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

export function stripServerFields(profile: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...profile }
  for (const field of SERVER_SIDE_PROFILE_FIELDS) {
    delete copy[field]
  }
  return copy
}
