import { describe, expect, it } from 'vitest'
import { TtlCache } from '../../../server/lib/fellow/cache'

describe('TtlCache', () => {
  it('returns what was set until the TTL passes', () => {
    let now = 1_000
    const cache = new TtlCache(30_000, () => now)
    cache.set('k', { a: 1 })
    expect(cache.get('k')).toEqual({ a: 1 })
    now += 29_999
    expect(cache.get('k')).toEqual({ a: 1 })
    now += 1
    expect(cache.get('k')).toBeUndefined()
  })

  it('returns undefined for unknown keys and after clear', () => {
    const cache = new TtlCache(1_000, () => 0)
    expect(cache.get('nope')).toBeUndefined()
    cache.set('k', 1)
    cache.clear()
    expect(cache.get('k')).toBeUndefined()
  })

  it('set returns the value for chaining', () => {
    const cache = new TtlCache(1_000, () => 0)
    expect(cache.set('k', 'v')).toBe('v')
  })
})
