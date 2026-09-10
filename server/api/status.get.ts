import { defineApiRoute } from '../utils/api'
import { getConfig } from '../utils/config'
import { useFellowClient } from '../utils/fellow-client'
import { APP_VERSION } from '../utils/version'

/** What the UI needs to render its header: dry-run badge, version, and whether Fellow is happy. */
export default defineApiRoute(() => ({
  dryRun: getConfig().fellow.dryRun,
  version: APP_VERSION,
  fellow: useFellowClient().lastOutcome,
}))
