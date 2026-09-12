/** Fellow's timestamps arrive as numbers or numeric strings, in seconds or milliseconds. */
export function epochMs(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const numeric = typeof value === 'number' ? value : /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return numeric < 1e11 ? numeric * 1000 : numeric
}

/** The device's own timestamp when it falls inside [from, to]; otherwise undefined, so a caller falls back to its clock. */
export function plausibleEpoch(value: string | number | undefined | null, from: number, to: number): number | undefined {
  const ms = epochMs(value)
  return ms !== undefined && ms >= from && ms <= to ? ms : undefined
}

export const DAY_MS = 86_400_000
