import { describe, expect, it } from 'vitest'
import { matchProfileByTitle, similarityRatio } from '../../../server/lib/fellow/similarity'

describe('similarityRatio (matches Python difflib.SequenceMatcher.ratio)', () => {
  it.each([
    ['fellowaiden', 'debug-fellowaiden', 0.7857142857],
    ['kitten', 'sitting', 0.6153846154],
    ['abcd', 'bcde', 0.75],
    ['morning cup', 'morning cup', 1],
    ['morning cup', 'evening cup', 0.7272727273],
    ['', 'x', 0],
    ['', '', 1],
    ['light roast', 'dark roast', 0.5714285714],
    ['ethiopia natural', 'ethiopian natural', 0.9696969697],
  ])('%j vs %j → %s', (a, b, expected) => {
    expect(similarityRatio(a, b)).toBeCloseTo(expected, 9)
  })

  it('is symmetric for these inputs', () => {
    expect(similarityRatio('kitten', 'sitting')).toBeCloseTo(similarityRatio('sitting', 'kitten'), 9)
  })
})

describe('matchProfileByTitle', () => {
  const profiles = [
    { id: 'p1', title: 'Debug-FellowAiden' },
    { id: 'p2', title: 'Morning Cup' },
    { id: 'p3', title: 'Evening Cup' },
    { id: 'p4', title: 'Kitten' },
  ]

  it('finds an exact title regardless of case', () => {
    expect(matchProfileByTitle(profiles, 'morning cup')?.id).toBe('p2')
  })
  it('returns undefined without fuzzy when nothing matches exactly', () => {
    expect(matchProfileByTitle(profiles, 'FellowAiden')).toBeUndefined()
  })
  it('fuzzy-matches the reference README example', () => {
    expect(matchProfileByTitle(profiles, 'FellowAiden', { fuzzy: true })?.id).toBe('p1')
  })
  it('returns the best fuzzy match, not the first one over the threshold', () => {
    // "evening cup " scores 0.727 against "Morning Cup" and higher against "Evening Cup".
    expect(matchProfileByTitle(profiles, 'evening cup ', { fuzzy: true })?.id).toBe('p3')
  })
  it('treats the threshold as strictly greater-than', () => {
    // kitten vs sitting is 0.615, below 0.65.
    expect(matchProfileByTitle(profiles, 'sitting', { fuzzy: true })).toBeUndefined()
    expect(matchProfileByTitle(profiles, 'sitting', { fuzzy: true, threshold: 0.6 })?.id).toBe('p4')
  })
  it('prefers an exact match even in fuzzy mode', () => {
    expect(matchProfileByTitle(profiles, 'MORNING CUP', { fuzzy: true })?.id).toBe('p2')
  })
  it('handles an empty list', () => {
    expect(matchProfileByTitle([], 'x', { fuzzy: true })).toBeUndefined()
  })
})
