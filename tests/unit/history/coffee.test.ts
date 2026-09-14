import { describe, expect, it } from 'vitest'
import { coffeeSittingSince } from '../../../server/lib/history'

const NOW = 1_789_200_000_000
const MINUTE = 60_000
const base = { brewing: false, lastBrewEndedAt: NOW - 20 * MINUTE, horizonMinutes: 120 }

describe('coffeeSittingSince', () => {
  it('counts from the end of the brew', () => {
    expect(coffeeSittingSince(base, NOW)).toBe(NOW - 20 * MINUTE)
  })
  it('ignores the carafe entirely, because the brewer stops reporting it while it sits idle', () => {
    // The input has no carafe field left to pass; a brew an hour old still reads, wherever the carafe is.
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: NOW - 60 * MINUTE }, NOW)).toBe(NOW - 60 * MINUTE)
  })
  it('has nothing to time during a brew, or before the first one', () => {
    expect(coffeeSittingSince({ ...base, brewing: true }, NOW)).toBeNull()
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: null }, NOW)).toBeNull()
  })
  it('stops at the horizon, past which the coffee is cold anyway', () => {
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: NOW - 121 * MINUTE }, NOW)).toBeNull()
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: NOW - 119 * MINUTE }, NOW)).not.toBeNull()
    // The horizon is the owner's setting, not a constant.
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: NOW - 119 * MINUTE, horizonMinutes: 60 }, NOW)).toBeNull()
  })
  it('refuses an end time in the future', () => {
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: NOW + MINUTE }, NOW)).toBeNull()
  })
})
