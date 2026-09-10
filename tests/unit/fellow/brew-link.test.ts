import { describe, expect, it } from 'vitest'
import { parseBrewLink } from '../../../server/utils/fellow/brew-link'
import { FellowError } from '../../../server/utils/fellow/errors'

describe('parseBrewLink', () => {
  it.each([
    ['https://brew.link/p/ws98', 'ws98', 'aiden'],
    ['https://brew.link/p/ws98/', 'ws98', 'aiden'],
    ['http://brew.link/p/AbC123', 'AbC123', 'aiden'],
    ['brew.link/p/ws98', 'ws98', 'aiden'],
    ['https://example.com/deep/path/p/zz9', 'zz9', 'aiden'],
    ['https://brew.link/p/ws98/aiden', 'ws98', 'aiden'],
    ['https://brew.link/p/ws98/some_other-drop/', 'ws98', 'some_other-drop'],
    ['ws98', 'ws98', 'aiden'],
    ['  ws98  ', 'ws98', 'aiden'],
  ])('%s → id %s, drop type %s', (input, id, dropType) => {
    expect(parseBrewLink(input)).toEqual({ id, dropType })
  })

  it.each([
    '',
    '   ',
    'https://brew.link/p/',
    'https://brew.link/q/ws98',
    'https://brew.link/p/ws98?utm=1',
    'ws-98',
    'https://brew.link/p/ws 98',
    'https://brew.link/p/ws98/drop/extra',
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
