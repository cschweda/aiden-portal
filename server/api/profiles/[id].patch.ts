import { getRouterParam, readBody } from 'h3'
import { ProfileIdSchema } from '../../lib/fellow'
import { asObject, defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const id = ProfileIdSchema.parse(getRouterParam(event, 'id'))
  await useFellowClient().updateProfile(id, asObject(await readBody(event)))
  event.context.logger?.info({ action: 'profile.update', profileId: id }, 'Profile updated')
  return { ok: true }
})
