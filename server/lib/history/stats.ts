import { DAY_MS } from './time'
import type { BrewRecord } from './types'

export interface PeriodStats {
  brews: number
  waterMl: number
}

export interface FavouriteProfile {
  profileId: string | null
  title: string | null
  brews: number
}

export interface HistoryStats {
  today: PeriodStats
  thisWeek: PeriodStats
  thisMonth: PeriodStats
  /** Everything in the log, and when the log starts. */
  logged: PeriodStats & { since: number | null }
  /** Mean of the trusted durations, seconds. */
  averageDurationS: number | null
  /** Mean gap between consecutive counted brews over the last thirty of them, hours. */
  averageBetweenBrewsH: number | null
  favouriteProfile: FavouriteProfile | null
  lastBrewAt: number | null
}

function sum(records: readonly BrewRecord[]): PeriodStats {
  return { brews: records.length, waterMl: records.reduce((total, r) => total + (r.waterMl ?? 0), 0) }
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
}

/** Local-time period boundaries: the day, the week from Sunday (as Fellow numbers schedule days), and the month. */
export function periodStarts(now: number): { day: number, week: number, month: number } {
  const d = new Date(now)
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const week = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime()
  const month = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  return { day, week, month }
}

export function computeStats(records: readonly BrewRecord[], now: number = Date.now()): HistoryStats {
  const past = records.filter(r => r.endedAt <= now).sort((a, b) => a.endedAt - b.endedAt)
  const starts = periodStarts(now)
  const since = (from: number) => past.filter(r => r.endedAt >= from)

  const counted = past.filter(r => r.counted)
  const recent = counted.slice(-30)
  const gaps: number[] = []
  for (let i = 1; i < recent.length; i++) gaps.push((recent[i]!.endedAt - recent[i - 1]!.endedAt) / (60 * 60_000))

  const byProfile = new Map<string, FavouriteProfile & { latest: number }>()
  for (const r of past) {
    const key = r.profileId ?? ''
    const entry = byProfile.get(key) ?? { profileId: r.profileId, title: r.profileTitle, brews: 0, latest: 0 }
    entry.brews += 1
    if (r.endedAt >= entry.latest) {
      entry.latest = r.endedAt
      entry.title = r.profileTitle ?? entry.title
    }
    byProfile.set(key, entry)
  }
  const favourite = [...byProfile.values()].sort((a, b) => b.brews - a.brews || b.latest - a.latest)[0]

  return {
    today: sum(since(starts.day)),
    thisWeek: sum(since(starts.week)),
    thisMonth: sum(since(starts.month)),
    logged: { ...sum(past), since: past[0]?.endedAt ?? null },
    averageDurationS: mean(counted.filter(r => r.observed && r.durationS !== null).map(r => r.durationS as number)),
    averageBetweenBrewsH: mean(gaps),
    favouriteProfile: favourite ? { profileId: favourite.profileId, title: favourite.title, brews: favourite.brews } : null,
    lastBrewAt: past[past.length - 1]?.endedAt ?? null,
  }
}

/**
 * Litres per day over the brews logged in a window ending now. The days counted are those the log covers: a log that
 * started before the window covers all of it, so quiet days count; a younger log is divided by its own age. Null until
 * the log covers three days and holds three brews with a known volume.
 */
export function litresPerDay(records: readonly BrewRecord[], now: number, windowDays = 30): number | null {
  const from = now - windowDays * DAY_MS
  const inWindow = records.filter(r => r.endedAt >= from && r.endedAt <= now && r.waterMl !== null)
  if (inWindow.length < 3) return null
  const logStart = Math.min(...records.map(r => r.endedAt))
  const spanDays = (now - Math.max(logStart, from)) / DAY_MS
  if (spanDays < 3) return null
  const litres = inWindow.reduce((total, r) => total + (r.waterMl ?? 0), 0) / 1000
  return litres / spanDays
}
