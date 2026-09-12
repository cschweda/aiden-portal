import { setResponseStatus } from 'h3'
import { brewStartBlockers } from '../../lib/fellow'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'
import { useHistory } from '../../utils/history'

/** Fellow does not validate readiness for you, so a fresh device read gates every start. */
export default defineApiRoute(async (event) => {
  const client = useFellowClient()
  const blockers = brewStartBlockers(await client.getDevice({ fresh: true }))
  if (blockers.length > 0) {
    event.context.logger?.warn({ action: 'brew.start', blockers }, 'Remote start refused')
    setResponseStatus(event, 409)
    return { error: 'brewer_not_ready', blockers }
  }
  const result = await client.startBrew()
  event.context.logger?.info({ action: 'brew.start', dryRun: client.dryRun }, 'Remote start requested')
  if (!client.dryRun) useHistory().pokeSoon()
  setResponseStatus(event, 202)
  return { ok: true, result }
})
