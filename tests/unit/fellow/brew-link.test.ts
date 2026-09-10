import { describe, expect, it } from 'vitest'
import { parseBrewLink } from '../../../server/utils/fellow/brew-link'
import { FellowError } from '../../../server/utils/fellow/errors'

describe('parseBrewLink', () => {
  it.each([
    ['https://brew.link/p/ws98', 'ws98'],
    ['https://brew.link/p/ws98/', 'ws98'],
    ['http://brew.link/p/AbC123', 'AbC123'],
    ['brew.link/p/ws98', 'ws98'],
    ['https://example.com/deep/path/p/zz9', 'zz9'],
    ['ws98', 'ws98'],
    ['  ws98  ', 'ws98'],
  ])('%s → %s', (input, id) => {
    expect(parseBrewLink(input)).toBe(id)
  })

  it.each([
    '',
    '   ',
    'https://brew.link/p/',
    'https://brew.link/q/ws98',
    'https://brew.link/p/ws98?utm=1',
    'ws-98',
    'https://brew.link/p/ws 98',
  ])('rejects %j', (input) => {
    expect(() => parseBrewLink(input)).toThrow(FellowError)
    try {
      parseBrewLink(input)
    }
    catch (error) {
      expect((error as FellowError).code).toBe('fellow_invalid_link')
    }
  })
})
