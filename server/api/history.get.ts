import { defineApiRoute } from '../utils/api'
import { useFellowClient } from '../utils/fellow-client'
import { useHistory } from '../utils/history'

/** Stats, the descale tally, the brew running now, the last traced brew, and recent brews. */
export default defineApiRoute(async () => {
  const device = await useFellowClient().getDevice()
  return useHistory().snapshot(device)
})
