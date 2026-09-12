import { defineApiRoute } from '../utils/api'
import { useFellowClient } from '../utils/fellow-client'
import { useHistory } from '../utils/history'

/**
 * Stats, the descale tally, the brew running now, the last traced brew, and recent brews. The log is local, so a
 * Fellow failure only costs the brewer's current totals: the last observed device stands in, or nothing at all.
 */
export default defineApiRoute(async (event) => {
  const history = useHistory()
  let device = history.lastObservedDevice ?? { id: 'unknown' }
  try {
    device = await useFellowClient().getDevice()
  }
  catch (error) {
    event.context.logger?.warn({ err: error instanceof Error ? error.message : String(error) }, 'History shown without a fresh device read')
  }
  return history.snapshot(device)
})
