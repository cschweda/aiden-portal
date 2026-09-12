import { defineApiRoute } from '../utils/api'
import { useFellowClient } from '../utils/fellow-client'
import { useHistory } from '../utils/history'

/** Records that the brewer was descaled now, from a fresh read of its totals. Nothing is sent to Fellow. */
export default defineApiRoute(async (event) => {
  const device = await useFellowClient().getDevice({ fresh: true })
  const status = useHistory().markDescaled(device)
  event.context.logger?.info({ action: 'descale.mark' }, 'Descale tally reset')
  return status
})
