import { brewStartBlockers } from '../lib/fellow'
import { defineApiRoute, parseFresh } from '../utils/api'
import { useFellowClient } from '../utils/fellow-client'
import { useHistory } from '../utils/history'

export default defineApiRoute(async (event) => {
  const fresh = parseFresh(event)
  const device = await useFellowClient().getDevice({ fresh })
  // A fresh read is a real observation of the brewer, so the brew log learns from it as it does from the poller.
  if (fresh) useHistory().observe(device, Date.now())
  const blockers = brewStartBlockers(device)
  return { device, canStartBrew: blockers.length === 0, blockers }
})
