import { setResponseStatus } from 'h3'
import { defineApiRoute } from '../utils/api'
import { useFellowClient } from '../utils/fellow-client'
import { useHistory } from '../utils/history'

/** Records that the brewer was descaled now, from a fresh read of its totals. Nothing is sent to Fellow. */
export default defineApiRoute(async (event) => {
  const history = useHistory()
  if (history.store.loadError) {
    setResponseStatus(event, 409)
    return { error: 'history_unavailable', message: `The history directory cannot be written: ${history.store.loadError}` }
  }
  const device = await useFellowClient().getDevice({ fresh: true })
  if (typeof device.totalBrewingCycles !== 'number' || typeof device.totalWaterVolumeL !== 'number') {
    setResponseStatus(event, 409)
    return { error: 'brewer_totals_unavailable', message: 'The brewer did not report its brew and water totals, so there is nothing to count from' }
  }
  const status = history.markDescaled(device)
  event.context.logger?.info({ action: 'descale.mark' }, 'Descale tally reset')
  return status
})
