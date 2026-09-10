import { FellowError } from '../lib/fellow'
import { getConfig } from '../utils/config'
import { useFellowClient } from '../utils/fellow-client'
import { CURRENT_LOG_FILE, useLogger } from '../utils/logger'
import { checkStartupSafety } from '../utils/startup'

/** Refuses to start off loopback, prints the one startup line, and probes Fellow without blocking. */
export default defineNitroPlugin(() => {
  let config: ReturnType<typeof getConfig>
  try {
    config = getConfig()
  }
  catch (error) {
    console.error(`aiden-studio cannot start: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  const problems = checkStartupSafety(config)
  if (problems.length > 0) {
    console.error(`aiden-studio refused to start:\n${problems.map(p => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }

  const logger = useLogger()
  logger.info({
    host: config.host,
    port: config.port,
    dryRun: config.fellow.dryRun,
    timezone: config.fellow.timezone,
    allowedHosts: config.allowedHosts,
    logLevel: config.logLevel,
  }, 'aiden-studio starting')
  console.log(`aiden-studio on http://${config.host}:${config.port} | dry run: ${config.fellow.dryRun} | logs: ${config.isProduction ? CURRENT_LOG_FILE : 'stdout'}`)

  useFellowClient().getDevice().then(
    device => logger.info({ deviceId: device.id, displayName: device.displayName }, 'Fellow brewer reachable'),
    (error: unknown) => logger.warn({ code: error instanceof FellowError ? error.code : 'unknown' }, 'Fellow probe failed; the dashboard will show the error'),
  )
})
