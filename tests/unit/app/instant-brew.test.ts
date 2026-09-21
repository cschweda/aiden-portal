import { describe, expect, it } from 'vitest'
import { lastBrewedLabel, presetHeadline, startConfirmation } from '../../../app/utils/instant-brew'

// Local-time constructors, so "today" and "yesterday" mean the same thing wherever the tests run.
const at = (day: number, hour: number, minute: number) => new Date(2026, 8, day, hour, minute).getTime()
const NOW = at(21, 7, 30)

describe('presetHeadline', () => {
  it('names the preset with the water it would brew', () => {
    expect(presetHeadline('Medium Roast', 'plocal1', 300)).toBe('Medium Roast · 300 mL')
  })
  it('leaves the water off when the brewer does not report one', () => {
    expect(presetHeadline('Medium Roast', 'plocal1', undefined)).toBe('Medium Roast')
  })
  it('falls back to the id for a preset the profile list does not name', () => {
    expect(presetHeadline(undefined, 'p42', 300)).toBe('p42 · 300 mL')
  })
  it('is null when the brewer reports no preset at all, whatever the water', () => {
    expect(presetHeadline(undefined, undefined, 300)).toBeNull()
  })
})

describe('lastBrewedLabel', () => {
  const light = { profileTitle: 'Light Roast', profileId: 'plocal0' }

  it('says today for a brew earlier the same day', () => {
    expect(lastBrewedLabel({ ...light, startedAt: at(21, 6, 41) }, NOW)).toBe('Light Roast · today 06:41')
  })
  it('says yesterday across midnight, even when less than a day has passed', () => {
    expect(lastBrewedLabel({ ...light, startedAt: at(20, 23, 50) }, at(21, 0, 10))).toBe('Light Roast · yesterday 23:50')
  })
  it('gives the date for anything older', () => {
    expect(lastBrewedLabel({ ...light, startedAt: at(18, 6, 27) }, NOW)).toMatch(/^Light Roast · 18\s\w{3,5},?\s06:27$/)
  })
  it('says so when the brewer never named the profile, and shows a bare id when that is all there is', () => {
    expect(lastBrewedLabel({ profileTitle: null, profileId: null, startedAt: at(21, 6, 41) }, NOW)).toBe('profile not reported · today 06:41')
    expect(lastBrewedLabel({ profileTitle: null, profileId: 'p9', startedAt: at(21, 6, 41) }, NOW)).toBe('p9 · today 06:41')
  })
  it('is null when nothing has been brewed yet', () => {
    expect(lastBrewedLabel(null, NOW)).toBeNull()
    expect(lastBrewedLabel(undefined, NOW)).toBeNull()
  })
})

describe('startConfirmation', () => {
  it('names the preset and its water, with when the brewer last reported, never the last brew', () => {
    const text = startConfirmation('Aiden', 'Medium Roast · 300 mL', at(21, 7, 0))
    expect(text).toContain('Aiden')
    expect(text).toContain('Medium Roast · 300 mL')
    expect(text).toContain('07:00')
  })
  it('still names the preset when nothing says when the brewer last reported', () => {
    const text = startConfirmation('Aiden', 'Medium Roast · 300 mL', null)
    expect(text).toContain('Medium Roast · 300 mL')
    expect(text).not.toMatch(/\d{2}:\d{2}/)
  })
  it('admits it when the brewer has reported no preset', () => {
    expect(startConfirmation('Aiden', null, at(21, 7, 0))).toContain('has not reported')
  })
})
