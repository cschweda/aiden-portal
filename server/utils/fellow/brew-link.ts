import { FellowError } from './errors'

/**
 * Accepts `https://brew.link/p/<id>`, any URL ending in `/p/<id>` (trailing slash optional), or a bare id.
 * The reference regex `(?:.*?/p/)?([a-zA-Z0-9]+)/?$` was search-anchored and accepted any URL ending in an
 * alphanumeric token; this version is anchored at both ends so `.../q/<id>` is rejected.
 */
const BREW_LINK_PATTERN = /^(?:\S*?\/p\/)?([A-Za-z0-9]+)\/?$/

export function parseBrewLink(linkOrId: string): string {
  const match = BREW_LINK_PATTERN.exec(linkOrId.trim())
  const id = match?.[1]
  if (!id) {
    throw new FellowError('fellow_invalid_link', `Not a brew.link URL or profile id: ${JSON.stringify(linkOrId)}`)
  }
  return id
}
