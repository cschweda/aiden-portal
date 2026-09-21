import { describe, expect, it } from 'vitest'
import { lastBrewHeadline, lastBrewWhen } from '../../../app/utils/brew-card'

// Local-time constructors, so "today" and "yesterday" mean the same thing wherever the tests run.
const at = (day: number, hour: number, minute: number) => new Date(2026, 8, day, hour, minute).getTime()
const NOW = at(21, 7, 30)

describe('lastBrewHeadline', () => {
  it('names the profile that was brewed with the water it drew', () => {
    expect(lastBrewHeadline({ profileTitle: 'Light Roast', profileId: 'plocal0', waterMl: 900 })).toBe('Light Roast · 900 mL')
  })
  it('says so when the brewer never named the profile, and shows a bare id when that is all there is', () => {
    expect(lastBrewHeadline({ profileTitle: null, profileId: null, waterMl: 900 })).toBe('profile not reported · 900 mL')
    expect(lastBrewHeadline({ profileTitle: null, profileId: 'p9', waterMl: 900 })).toBe('p9 · 900 mL')
  })
  it('leaves the water off a brew that has none recorded', () => {
    expect(lastBrewHeadline({ profileTitle: 'Light Roast', profileId: 'plocal0', waterMl: null })).toBe('Light Roast')
  })
})

describe('lastBrewWhen', () => {
  it('says today for a brew earlier the same day, with how long it took', () => {
    expect(lastBrewWhen({ startedAt: at(21, 6, 41), durationS: 375 }, NOW)).toBe('today 06:41 · took 6:15')
  })
  it('says yesterday across midnight, even when less than a day has passed, and admits an untimed brew', () => {
    expect(lastBrewWhen({ startedAt: at(20, 23, 50), durationS: null }, at(21, 0, 10))).toBe('yesterday 23:50 · not timed')
  })
  it('gives the date for anything older', () => {
    expect(lastBrewWhen({ startedAt: at(18, 6, 27), durationS: 340 }, NOW)).toMatch(/^18\s\w{3,5},?\s06:27 · took 5:40$/)
  })
})
