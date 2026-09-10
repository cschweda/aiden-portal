import { brewStartBlockers } from '../lib/fellow'
import { defineApiRoute, parseFresh } from '../utils/api'
import { useFellowClient } from '../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const device = await useFellowClient().getDevice({ fresh: parseFresh(event) })
  const blockers = brewStartBlockers(device)
  return { device, canStartBrew: blockers.length === 0, blockers }
})
