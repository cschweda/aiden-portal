import type { BrewExpectation } from '../../server/lib/history'
import { formatClock } from './format'

/** "about 1:20 to go" or "running 0:15 over" plus where the expectation came from; empty without one. */
export function describeCountdown(expected: BrewExpectation | null | undefined, elapsedS: number): string {
  if (!expected) return ''
  const remaining = Math.round(expected.seconds - elapsedS)
  const basis = expected.basis === 'measured'
    ? `from ${expected.brews} previous brew${expected.brews === 1 ? '' : 's'}`
    : 'from the recipe'
  if (remaining >= 0) return `about ${formatClock(remaining)} to go (${basis})`
  return `running ${formatClock(-remaining)} over the usual ${formatClock(expected.seconds)} (${basis})`
}
