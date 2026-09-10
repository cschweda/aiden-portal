import { getRouterParam } from 'h3'
import { ProfileIdSchema } from '../../lib/fellow'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const id = ProfileIdSchema.parse(getRouterParam(event, 'id'))
  await useFellowClient().deleteProfile(id)
  event.context.logger?.info({ action: 'profile.delete', profileId: id }, 'Profile deleted')
  return { ok: true }
})
