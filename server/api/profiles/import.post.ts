import { readBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import { parseBrewLink } from '../../lib/fellow'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

/** An unparseable link is the caller's mistake (400), not a Fellow failure (502), so it is validated up front. */
const ImportBody = z.strictObject({
  link: z.string().min(1).refine(isBrewLink, { error: 'Not a brew.link URL or profile id' }),
})

function isBrewLink(link: string): boolean {
  try {
    parseBrewLink(link)
    return true
  }
  catch {
    return false
  }
}

export default defineApiRoute(async (event) => {
  const { link } = ImportBody.parse(await readBody(event))
  const profile = await useFellowClient().createProfileFromLink(link)
  event.context.logger?.info({ action: 'profile.import', profileId: profile.id, brewId: parseBrewLink(link).id }, 'Profile imported from brew.link')
  setResponseStatus(event, 201)
  return profile
})
