import { formatDateTime, formatHourMinute, formatMillilitres } from './format'

/** The newest brew in the log, as far as the Instant Brew card needs it. */
export interface LastBrew {
  profileTitle: string | null
  profileId: string | null
  startedAt: number
}

/**
 * The Instant Brew preset as the brewer last reported it: "Medium Roast · 300 mL". The water belongs in it because a
 * remote start sends neither profile nor quantity; the brewer runs this pair, which has nothing to do with the brew
 * last dialled in on the machine. Null when the brewer reports no preset.
 */
export function presetHeadline(title: string | undefined, profileId: string | undefined, waterMl: number | undefined): string | null {
  const name = title ?? profileId
  if (name === undefined) return null
  return waterMl === undefined ? name : `${name} · ${formatMillilitres(waterMl)}`
}

/** Local calendar days between two moments, so ten minutes either side of midnight is still "yesterday". */
function daysApart(earlier: Date, later: Date): number {
  const from = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate()).getTime()
  const to = new Date(later.getFullYear(), later.getMonth(), later.getDate()).getTime()
  return Math.round((to - from) / 86_400_000)
}

/** "Light Roast · today 06:41", or null when nothing has been brewed. A brew the brewer never named says so. */
export function lastBrewedLabel(brew: LastBrew | null | undefined, now: number): string | null {
  if (!brew) return null
  const name = brew.profileTitle ?? brew.profileId ?? 'profile not reported'
  const days = daysApart(new Date(brew.startedAt), new Date(now))
  const when = days === 0
    ? `today ${formatHourMinute(brew.startedAt)}`
    : days === 1
      ? `yesterday ${formatHourMinute(brew.startedAt)}`
      : formatDateTime(brew.startedAt)
  return `${name} · ${when}`
}

/**
 * What the confirmation promises. Only the preset, and only as last reported: seen on a real brewer, a preset changed
 * on the machine while it sat idle had not reached Fellow minutes later, so the card can lag the machine and the
 * machine's own setting is what a start runs.
 */
export function startConfirmation(brewerName: string, headline: string | null, reportedAt: number | null | undefined): string {
  const opening = `${brewerName} will run its Instant Brew preset now.`
  if (headline === null) return `${opening} It has not reported what that is.`
  const asOf = reportedAt ? `When it last reported a change, at ${formatHourMinute(reportedAt)}, that was ${headline}` : `It last reported that as ${headline}`
  return `${opening} ${asOf}; a preset changed on the brewer since may not show here yet.`
}
