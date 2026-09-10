/**
 * Ratcliff/Obershelp similarity: 2 × (matched characters) / (total characters).
 * This is a port of Python's difflib.SequenceMatcher.ratio() for the no-junk case (inputs under 200
 * characters), which is what the reference library uses for fuzzy profile lookup.
 */
export function similarityRatio(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  const total = x.length + y.length
  if (total === 0) return 1
  return (2 * matchingCharacters(x, y)) / total
}

type Range = [alo: number, ahi: number, blo: number, bhi: number]

function matchingCharacters(a: string[], b: string[]): number {
  const pending: Range[] = [[0, a.length, 0, b.length]]
  let matched = 0
  while (pending.length > 0) {
    const [alo, ahi, blo, bhi] = pending.pop()!
    const [i, j, k] = longestMatch(a, b, alo, ahi, blo, bhi)
    if (k === 0) continue
    matched += k
    if (alo < i && blo < j) pending.push([alo, i, blo, j])
    if (i + k < ahi && j + k < bhi) pending.push([i + k, ahi, j + k, bhi])
  }
  return matched
}

/** Longest common block within the given windows; ties go to the earliest start in a, then in b (as in difflib). */
function longestMatch(a: string[], b: string[], alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
  let bestI = alo
  let bestJ = blo
  let bestSize = 0
  let lengthEndingAt = new Map<number, number>()
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>()
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue
      const k = (lengthEndingAt.get(j - 1) ?? 0) + 1
      next.set(j, k)
      if (k > bestSize) {
        bestI = i - k + 1
        bestJ = j - k + 1
        bestSize = k
      }
    }
    lengthEndingAt = next
  }
  return [bestI, bestJ, bestSize]
}

export interface TitleLookupOptions {
  fuzzy?: boolean
  /** Similarity must be strictly greater than this. Default 0.65, as in the reference library. */
  threshold?: number
}

export function matchProfileByTitle<T extends { title: string }>(
  profiles: readonly T[],
  title: string,
  { fuzzy = false, threshold = 0.65 }: TitleLookupOptions = {},
): T | undefined {
  const wanted = title.toLowerCase()
  const exact = profiles.find(p => p.title.toLowerCase() === wanted)
  if (exact || !fuzzy) return exact

  let best: T | undefined
  let bestScore = threshold
  for (const profile of profiles) {
    const score = similarityRatio(profile.title.toLowerCase(), wanted)
    if (score > bestScore) {
      best = profile
      bestScore = score
    }
  }
  return best
}
