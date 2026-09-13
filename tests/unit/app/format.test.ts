import { describe, expect, it } from 'vitest'
import { describeCountdown } from '../../../app/utils/countdown'
import { formatAgo, formatClock, formatDate, formatDateTime, formatDuration, formatElevation, formatHours, formatLitres, formatLitresFromMl, formatMillilitres, formatTemperature, formatTime, toDate } from '../../../app/utils/format'

describe('format helpers', () => {
  it('formats temperatures with half degrees', () => {
    expect(formatTemperature(94)).toBe('94°C')
    expect(formatTemperature(91.5)).toBe('91.5°C')
    expect(formatTemperature(undefined)).toBe('—')
  })
  it('formats litres to one decimal', () => {
    expect(formatLitres(12.345)).toBe('12.3 L')
    expect(formatLitres(0)).toBe('0.0 L')
    expect(formatLitres(undefined)).toBe('—')
  })
  it('formats a timestamp as a local clock time and tolerates junk', () => {
    expect(formatTime(Date.UTC(2026, 8, 10, 12, 34, 56))).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(formatTime('2026-09-10T12:34:56Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(formatTime(undefined)).toBe('—')
    expect(formatTime('garbage')).toBe('—')
  })
  it('formats millilitres whole and millilitre totals in litres', () => {
    expect(formatMillilitres(825)).toBe('825 mL')
    expect(formatMillilitres(908.14)).toBe('908 mL')
    expect(formatMillilitres(undefined)).toBe('—')
    expect(formatLitresFromMl(63570)).toBe('63.6 L')
    expect(formatLitresFromMl(undefined)).toBe('—')
  })
  it('reads epoch seconds, epoch milliseconds, numeric strings, and date strings', () => {
    expect(toDate(1789213533)?.getTime()).toBe(1789213533000)
    expect(toDate('1789213533')?.getTime()).toBe(1789213533000)
    expect(toDate('1789199401998')?.getTime()).toBe(1789199401998)
    expect(toDate(1789199401998)?.getTime()).toBe(1789199401998)
    expect(toDate('2026-09-12T10:00:00Z')?.toISOString()).toBe('2026-09-12T10:00:00.000Z')
    expect(toDate(undefined)).toBeUndefined()
    expect(toDate(null)).toBeUndefined()
    expect(toDate('')).toBeUndefined()
    expect(toDate('soon')).toBeUndefined()
  })
  it('formats a date and time without seconds', () => {
    expect(formatDateTime(1789213533)).toMatch(/^\d{1,2}\s\w{3,5},?\s\d{2}:\d{2}$/)
    expect(formatDateTime('garbage')).toBe('—')
    expect(formatDate(Date.UTC(2026, 8, 24, 12))).toMatch(/^\d{1,2}\s\w{3,5}\s2026$/)
    expect(formatDate(null)).toBe('—')
  })
  it('says how long ago, coarsely', () => {
    const now = 1_800_000_000_000
    expect(formatAgo(now - 20_000, now)).toBe('just now')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe('2 h ago')
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe('3 d ago')
    expect(formatAgo(String(Math.floor(now / 1000) - 3600), now)).toBe('1 h ago')
    expect(formatAgo(now + 10 * 60_000, now)).toBe('in 10 min')
    expect(formatAgo(undefined, now)).toBe('—')
  })
  it('describes a countdown from an expectation', () => {
    expect(describeCountdown({ seconds: 340, basis: 'measured', brews: 3 }, 260)).toBe('about 1:20 to go (from 3 previous brews)')
    expect(describeCountdown({ seconds: 340, basis: 'recipe' }, 355)).toBe('running 0:15 over the usual 5:40 (from the recipe)')
    expect(describeCountdown(null, 10)).toBe('')
  })
  it('shows an elevation in metres and feet', () => {
    expect(formatElevation(233)).toBe('233 m (764 ft)')
    expect(formatElevation(0)).toBe('0 m (0 ft)')
    expect(formatElevation(undefined)).toBe('—')
  })
  it('formats durations, clocks, and hours', () => {
    expect(formatDuration(42)).toBe('42 s')
    expect(formatDuration(340)).toBe('5 min 40 s')
    expect(formatDuration(600)).toBe('10 min')
    expect(formatDuration(4320)).toBe('1 h 12 min')
    expect(formatDuration(null)).toBe('—')
    expect(formatClock(30)).toBe('0:30')
    expect(formatClock(725)).toBe('12:05')
    expect(formatClock(3750)).toBe('1:02:30')
    expect(formatHours(2.5)).toBe('2.5 h')
    expect(formatHours(76)).toBe('3 d 4 h')
    expect(formatHours(null)).toBe('—')
  })
})
