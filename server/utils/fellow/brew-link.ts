import { FellowError } from './errors'

export interface BrewLink {
  /** The shared profile id, e.g. `ws98`. */
  id: string
  /** Fellow's product "drop" the profile belongs to. brew.link URLs omit it for the Aiden. */
  dropType: string
}

export const DEFAULT_DROP_TYPE = 'aiden'

/**
 * Accepts `https://brew.link/p/<id>`, `https://brew.link/p/<id>/<dropType>`, any URL ending in one of those
 * forms (trailing slash optional), or a bare id. A query string or fragment on a pasted link is ignored.
 * The reference regex was search-anchored and accepted any URL ending in an alphanumeric token; this version
 * is anchored at both ends so `.../q/<id>` is rejected.
 */
const BREW_LINK_PATTERN = /^(?:\S*?\/p\/)?([A-Za-z0-9]+)(?:\/([A-Za-z0-9_-]+))?\/?$/

export function parseBrewLink(linkOrId: string): BrewLink {
  const match = BREW_LINK_PATTERN.exec(linkOrId.trim().replace(/[?#].*$/, ''))
  const id = match?.[1]
  if (!id) {
    throw new FellowError('fellow_invalid_link', `Not a brew.link URL or profile id: ${JSON.stringify(linkOrId)}`)
  }
  return { id, dropType: match[2] ?? DEFAULT_DROP_TYPE }
}
