import { describe, expect, it } from 'vitest'
import { coffeeSittingSince, COFFEE_HORIZON_MS } from '../../../server/lib/history'

const NOW = 1_789_300_000_000
const MINUTE = 60_000
const base = { carafePresent: true, brewing: false, lastBrewEndedAt: NOW - 20 * MINUTE, carafeRemovedAt: null }

describe('coffeeSittingSince', () => {
  it('runs from the end of the last brew while the carafe is in place', () => {
    expect(coffeeSittingSince(base, NOW)).toBe(NOW - 20 * MINUTE)
  })
  it('stops when the carafe comes out, and does not restart when it goes back', () => {
    expect(coffeeSittingSince({ ...base, carafePresent: false }, NOW)).toBeNull()
    expect(coffeeSittingSince({ ...base, carafeRemovedAt: NOW - 5 * MINUTE }, NOW)).toBeNull()
  })
  it('ignores a removal that happened before the brew it is timing', () => {
    expect(coffeeSittingSince({ ...base, carafeRemovedAt: NOW - 40 * MINUTE }, NOW)).toBe(NOW - 20 * MINUTE)
  })
  it('says nothing while a brew is running, or when no brew is known', () => {
    expect(coffeeSittingSince({ ...base, brewing: true }, NOW)).toBeNull()
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: null }, NOW)).toBeNull()
  })
  it('gives up on a brew too old to reason about, which is what a restart sees', () => {
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: NOW - COFFEE_HORIZON_MS - MINUTE }, NOW)).toBeNull()
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: NOW - COFFEE_HORIZON_MS + MINUTE }, NOW)).not.toBeNull()
  })
  it('says nothing when the brewer does not report the carafe, or reports a brew from the future', () => {
    expect(coffeeSittingSince({ ...base, carafePresent: undefined }, NOW)).toBeNull()
    expect(coffeeSittingSince({ ...base, lastBrewEndedAt: NOW + MINUTE }, NOW)).toBeNull()
  })
})
