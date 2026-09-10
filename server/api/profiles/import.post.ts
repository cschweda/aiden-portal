import { readBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import { type BrewLink, parseBrewLink } from '../../lib/fellow'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

/** An unparseable link is the caller's mistake (400), not a Fellow failure (502), so it is validated up front. */
const ImportBody = z.strictObject({
  link: z.string().min(1).transform((link, ctx): BrewLink => {
    try {
      return parseBrewLink(link)
    }
    catch {
      ctx.addIssue({ code: 'custom', message: 'Not a brew.link URL or profile id' })
      return z.NEVER
    }
  }),
})

export default defineApiRoute(async (event) => {
  const { link } = ImportBody.parse(await readBody(event))
  const profile = await useFellowClient().createProfileFromLink(`${link.id}/${link.dropType}`)
  event.context.logger?.info({ action: 'profile.import', profileId: profile.id, brewId: link.id, dropType: link.dropType }, 'Profile imported from brew.link')
  setResponseStatus(event, 201)
  return profile
})
