import { getConfig } from '../utils/config'
import { useHistory } from '../utils/history'
import { useLogger } from '../utils/logger'

/** Starts the background reads that feed the brew log, the trace, and the descale tally. Runs after 00.startup. */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const config = getConfig()
  const logger = useLogger()
  if (!config.history.enabled) {
    logger.info('History polling is off (HISTORY_ENABLED=false); the log only grows while pages are open')
    return
  }
  try {
    const history = useHistory()
    history.start()
    logger.info({ directory: config.history.directory, idlePollSeconds: config.history.idlePollSeconds, brewPollSeconds: config.history.brewPollSeconds, brewsOnDisk: history.store.brews.length }, 'History polling started')
  }
  catch (error) {
    // The brewer controls must work even if the history cannot; the routes report the reason.
    logger.error({ err: error instanceof Error ? error.message : String(error) }, 'History could not start')
  }
})
