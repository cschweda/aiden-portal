import { getRouterParam } from 'h3'
import { ProfileIdSchema } from '../../../lib/fellow'
import { defineApiRoute } from '../../../utils/api'
import { useFellowClient } from '../../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const id = ProfileIdSchema.parse(getRouterParam(event, 'id'))
  const link = await useFellowClient().generateShareLink(id)
  event.context.logger?.info({ action: 'profile.share', profileId: id }, 'Share link generated')
  return { link }
})
