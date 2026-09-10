import { describe, expect, it } from 'vitest'
import { ScheduleInputSchema } from '../../../server/lib/fellow/schemas'
import { blankSchedule, DAY_LABELS, describeDays, secondsToTime, timeToSeconds } from '../../../app/utils/schedule-form'

describe('secondsToTime / timeToSeconds', () => {
  it.each([[0, '00:00'], [28800, '08:00'], [28860, '08:01'], [86340, '23:59'], [86399, '23:59']])('%s → %s', (seconds, time) => {
    expect(secondsToTime(seconds)).toBe(time)
  })
  it.each([['00:00', 0], ['08:00', 28800], ['23:59', 86340], ['7:05', 25500]])('%s → %s', (time, seconds) => {
    expect(timeToSeconds(time)).toBe(seconds)
  })
  it.each(['24:00', '12:60', 'noon', '', '08:00:30'])('rejects %j', (time) => {
    expect(() => timeToSeconds(time)).toThrow()
  })
  it('round-trips whole minutes', () => {
    for (const s of [0, 60, 3600, 45000, 86340]) expect(timeToSeconds(secondsToTime(s))).toBe(s)
  })
})

describe('describeDays', () => {
  const on = (...idx: number[]) => DAY_LABELS.map((_, i) => idx.includes(i))
  it.each([
    [on(0, 1, 2, 3, 4, 5, 6), 'Every day'],
    [on(1, 2, 3, 4, 5), 'Weekdays'],
    [on(0, 6), 'Weekends'],
    [on(1, 3, 5), 'Mon, Wed, Fri'],
    [on(), 'Never'],
  ])('%j → %s', (days, expected) => {
    expect(describeDays(days)).toBe(expected)
  })
})

describe('blankSchedule', () => {
  it('is a valid weekday 07:00 schedule for the given profile', () => {
    const schedule = blankSchedule('p7')
    expect(ScheduleInputSchema.safeParse(schedule).success).toBe(true)
    expect(secondsToTime(schedule.secondFromStartOfTheDay)).toBe('07:00')
    expect(describeDays(schedule.days)).toBe('Weekdays')
    expect(schedule.profileId).toBe('p7')
  })
})
