import type { ScheduleInput } from '../../server/lib/fellow/schemas'

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const pad = (n: number) => String(n).padStart(2, '0')

/** Seconds since midnight (brewer local time) → "HH:MM". */
export function secondsToTime(seconds: number): string {
  const clamped = Math.max(0, Math.min(86399, Math.floor(seconds)))
  return `${pad(Math.floor(clamped / 3600))}:${pad(Math.floor((clamped % 3600) / 60))}`
}

/** "HH:MM" → seconds since midnight. Throws on anything that is not a clock time. */
export function timeToSeconds(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) throw new Error(`Not a clock time: ${JSON.stringify(time)}`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error(`Not a clock time: ${JSON.stringify(time)}`)
  return hours * 3600 + minutes * 60
}

/** "Every day", "Weekdays", "Weekends", "Mon, Wed, Fri", or "Never". */
export function describeDays(days: readonly boolean[]): string {
  const on = days.map((d, i) => (d ? i : -1)).filter(i => i >= 0)
  const key = on.join(',')
  if (on.length === 7) return 'Every day'
  if (key === '1,2,3,4,5') return 'Weekdays'
  if (key === '0,6') return 'Weekends'
  if (on.length === 0) return 'Never'
  return on.map(i => DAY_LABELS[i]).join(', ')
}

/** Weekdays at 07:00, 950 ml, for the given profile. */
export function blankSchedule(profileId: string): ScheduleInput {
  return {
    days: [false, true, true, true, true, true, false],
    secondFromStartOfTheDay: 7 * 3600,
    enabled: true,
    amountOfWater: 950,
    profileId,
  }
}
