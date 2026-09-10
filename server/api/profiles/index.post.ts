import { readBody, setResponseStatus } from 'h3'
import { asObject, defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const profile = await useFellowClient().createProfile(asObject(await readBody(event)))
  event.context.logger?.info({ action: 'profile.create', profileId: profile.id }, 'Profile created')
  setResponseStatus(event, 201)
  return profile
})
