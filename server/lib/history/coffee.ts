/**
 * How long ago the coffee was brewed.
 *
 * This used to wait for the brewer to report the carafe leaving its plate, on the reasoning that lifting it out is
 * the only sign the coffee was taken. The brewer cannot be trusted for that: it stops reporting sensor changes
 * while it sits idle, so a carafe carried off to the kitchen counter still reads as present, sometimes for hours.
 * Two fresh reads three minutes apart came back byte for byte identical with the carafe demonstrably gone.
 *
 * So the clock counts from the end of the brew and nothing else, and it gives up at the horizon, past which the
 * coffee is cold whatever became of it.
 */

export interface CoffeeInput {
  /** A brew in progress has no coffee sitting yet. */
  brewing: boolean
  lastBrewEndedAt: number | null
  /** Minutes after which the clock stops and the reading clears. */
  horizonMinutes: number
}

/** When the coffee was brewed, or null when there is nothing worth timing. */
export function coffeeSittingSince({ brewing, lastBrewEndedAt, horizonMinutes }: CoffeeInput, now: number = Date.now()): number | null {
  if (brewing || lastBrewEndedAt === null) return null
  if (lastBrewEndedAt > now) return null
  if (now - lastBrewEndedAt > horizonMinutes * 60_000) return null
  return lastBrewEndedAt
}
