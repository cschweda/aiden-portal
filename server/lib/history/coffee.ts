/**
 * How long the coffee has been sitting in the carafe. The brewer cannot tell a full carafe from an empty one, so
 * lifting it out is the only sign the coffee was taken: the clock runs from the end of the last brew until the
 * carafe comes out, and does not start again when an empty one goes back.
 */

/** Past this, a brew is no longer interesting as "sitting", and a restart cannot tell whether the carafe was emptied. */
export const COFFEE_HORIZON_MS = 6 * 60 * 60_000

export interface CoffeeInput {
  /** As the brewer reports it now. */
  carafePresent?: boolean
  /** A brew in progress has no coffee sitting yet. */
  brewing: boolean
  lastBrewEndedAt: number | null
  /** When the carafe was last seen leaving, as far as this process has watched. */
  carafeRemovedAt: number | null
}

/** When the coffee in the carafe was brewed, or null when nothing is sitting there. */
export function coffeeSittingSince({ carafePresent, brewing, lastBrewEndedAt, carafeRemovedAt }: CoffeeInput, now: number = Date.now()): number | null {
  if (brewing || carafePresent !== true || lastBrewEndedAt === null) return null
  if (lastBrewEndedAt > now) return null
  if (carafeRemovedAt !== null && carafeRemovedAt >= lastBrewEndedAt) return null
  if (now - lastBrewEndedAt > COFFEE_HORIZON_MS) return null
  return lastBrewEndedAt
}
