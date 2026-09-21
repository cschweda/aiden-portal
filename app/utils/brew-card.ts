import { formatClock, formatDateTime, formatHourMinute, formatMillilitres } from './format'

/** The newest brew in the log, as far as the dashboard's brew card needs it. */
export interface LastBrew {
  profileTitle: string | null
  profileId: string | null
  waterMl: number | null
  startedAt: number
  durationS: number | null
}

/** "Light Roast · 900 mL". A brew the brewer never named says so rather than borrowing a name. */
export function lastBrewHeadline(brew: Pick<LastBrew, 'profileTitle' | 'profileId' | 'waterMl'>): string {
  const name = brew.profileTitle ?? brew.profileId ?? 'profile not reported'
  return brew.waterMl === null ? name : `${name} · ${formatMillilitres(brew.waterMl)}`
}

/** Local calendar days between two moments, so ten minutes either side of midnight is still "yesterday". */
function daysApart(earlier: Date, later: Date): number {
  const from = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate()).getTime()
  const to = new Date(later.getFullYear(), later.getMonth(), later.getDate()).getTime()
  return Math.round((to - from) / 86_400_000)
}

/** "today 06:41 · took 6:15". A brew whose duration is not trusted reads "not timed". */
export function lastBrewWhen(brew: Pick<LastBrew, 'startedAt' | 'durationS'>, now: number): string {
  const days = daysApart(new Date(brew.startedAt), new Date(now))
  const when = days === 0
    ? `today ${formatHourMinute(brew.startedAt)}`
    : days === 1
      ? `yesterday ${formatHourMinute(brew.startedAt)}`
      : formatDateTime(brew.startedAt)
  return `${when} · ${brew.durationS === null ? 'not timed' : `took ${formatClock(brew.durationS)}`}`
}
