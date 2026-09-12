import { getConfig } from '../utils/config'
import { useHistory } from '../utils/history'
import { useLogger } from '../utils/logger'

/** Starts the background reads that feed the brew log, the trace, and the descale tally. Runs after 00.startup. */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const config = getConfig()
  const history = useHistory()
  if (!config.history.enabled) {
    useLogger().info('History polling is off (HISTORY_ENABLED=false); the log only grows while pages are open')
    return
  }
  history.start()
  useLogger().info({ directory: config.history.directory, idlePollSeconds: config.history.idlePollSeconds, brewPollSeconds: config.history.brewPollSeconds, brewsOnDisk: history.store.brews.length }, 'History polling started')
})
