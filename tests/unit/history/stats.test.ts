import { describe, expect, it } from 'vitest'
import { computeStats, litresPerDay, periodStarts } from '../../../server/lib/history'
import type { BrewRecord } from '../../../server/lib/history'

// Wednesday 16 September 2026, noon, local time.
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime()
const at = (y: number, m: number, d: number, h = 8) => new Date(y, m - 1, d, h).getTime()
const brew = (startedAt: number, overrides: Partial<BrewRecord> = {}): BrewRecord => ({
  id: `b${startedAt}`,
  startedAt,
  endedAt: startedAt + 300_000,
  durationS: 300,
  waterMl: 800,
  profileId: 'plocal1',
  profileTitle: 'Medium Roast',
  observed: true,
  counted: true,
  cyclesAfter: null,
  samples: [],
  ...overrides,
})

describe('periodStarts', () => {
  it('starts the week on Sunday and the month on the first, in local time', () => {
    const starts = periodStarts(NOW)
    expect(new Date(starts.day).getHours()).toBe(0)
    expect(new Date(starts.week).getDay()).toBe(0)
    expect(new Date(starts.week).getDate()).toBe(13)
    expect(new Date(starts.month).getDate()).toBe(1)
  })
})

describe('computeStats', () => {
  const records = [
    brew(at(2026, 9, 16, 7)),
    brew(at(2026, 9, 16, 9), { waterMl: null, profileId: 'plocal2', profileTitle: 'Dark Roast' }),
    brew(at(2026, 9, 14)),
    brew(at(2026, 9, 12), { profileId: 'plocal2', profileTitle: 'Dark Roast', observed: false, durationS: null }),
    brew(at(2026, 8, 30), { durationS: 420 }),
    brew(at(2026, 9, 20)),
  ]
  const stats = computeStats(records, NOW)
  it('buckets brews by the local day, week, and month they started in, ignoring records from the future', () => {
    expect(stats.today).toEqual({ brews: 2, waterMl: 800 })
    expect(stats.thisWeek).toEqual({ brews: 3, waterMl: 1600 })
    expect(stats.thisMonth).toEqual({ brews: 4, waterMl: 2400 })
    expect(stats.logged).toEqual({ brews: 5, waterMl: 3200, since: at(2026, 8, 30) })
  })
  it('averages durations only from observed, counted brews', () => {
    expect(stats.averageDurationS).toBe((300 + 300 + 300 + 420) / 4)
  })
  it('averages the gaps between counted brews in hours', () => {
    const ordered = [at(2026, 8, 30), at(2026, 9, 12), at(2026, 9, 14), at(2026, 9, 16, 7), at(2026, 9, 16, 9)]
    const gaps = ordered.slice(1).map((t, i) => (t - ordered[i]!) / 3_600_000)
    expect(stats.averageBetweenBrewsH).toBeCloseTo(gaps.reduce((a, b) => a + b) / gaps.length, 6)
  })
  it('names the most used profile, breaking ties by the latest brew', () => {
    expect(stats.topProfiles[0]).toEqual({ profileId: 'plocal1', title: 'Medium Roast', brews: 3 })
    const tied = computeStats([brew(at(2026, 9, 1)), brew(at(2026, 9, 2), { profileId: 'plocal2', profileTitle: 'Dark Roast' })], NOW)
    expect(tied.topProfiles[0]?.title).toBe('Dark Roast')
    expect(stats.lastBrewAt).toBe(at(2026, 9, 16, 9))
  })
  it('ranks the profiles used most, keeping three at most', () => {
    expect(stats.topProfiles).toEqual([
      { profileId: 'plocal1', title: 'Medium Roast', brews: 3 },
      { profileId: 'plocal2', title: 'Dark Roast', brews: 2 },
    ])
    const many = computeStats([
      brew(at(2026, 9, 1), { profileId: 'p4', profileTitle: 'Fourth' }),
      brew(at(2026, 9, 2), { profileId: 'p3', profileTitle: 'Third' }),
      brew(at(2026, 9, 3), { profileId: 'p3', profileTitle: 'Third' }),
      brew(at(2026, 9, 4), { profileId: 'p2', profileTitle: 'Second' }),
      brew(at(2026, 9, 5), { profileId: 'p2', profileTitle: 'Second' }),
      brew(at(2026, 9, 6), { profileId: 'p2', profileTitle: 'Second' }),
      brew(at(2026, 9, 7), { profileId: 'p1', profileTitle: 'First' }),
      brew(at(2026, 9, 8), { profileId: 'p1', profileTitle: 'First' }),
      brew(at(2026, 9, 9), { profileId: 'p1', profileTitle: 'First' }),
      brew(at(2026, 9, 10), { profileId: 'p1', profileTitle: 'First' }),
    ], NOW)
    expect(many.topProfiles.map(p => `${p.title} ${p.brews}`)).toEqual(['First 4', 'Second 3', 'Third 2'])
  })
  it('copes with an empty log', () => {
    const empty = computeStats([], NOW)
    expect(empty.today).toEqual({ brews: 0, waterMl: 0 })
    expect(empty.averageDurationS).toBeNull()
    expect(empty.averageBetweenBrewsH).toBeNull()
    expect(empty.topProfiles).toEqual([])
    expect(empty.logged.since).toBeNull()
  })
})

describe('litresPerDay', () => {
  const day = 86_400_000
  it('needs three brews spanning three days', () => {
    expect(litresPerDay([brew(NOW - day), brew(NOW - 2 * day)], NOW)).toBeNull()
    expect(litresPerDay([brew(NOW - 1000), brew(NOW - 2000), brew(NOW - 3000)], NOW)).toBeNull()
  })
  it('divides the litres in the window by the days the log covers', () => {
    const records = [brew(NOW - 10 * day), brew(NOW - 7 * day), brew(NOW - 4 * day), brew(NOW - day)]
    expect(litresPerDay(records, NOW)).toBeCloseTo(3.2 / 10, 6)
  })
  it('caps the window at thirty days', () => {
    const records = [brew(NOW - 60 * day, { waterMl: 5000 }), brew(NOW - 20 * day), brew(NOW - 10 * day), brew(NOW - day)]
    expect(litresPerDay(records, NOW)).toBeCloseTo(2.4 / 30, 6)
  })
})
