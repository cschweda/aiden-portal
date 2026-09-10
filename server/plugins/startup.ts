import { existsSync, statSync } from 'node:fs'
import { FellowError } from '../lib/fellow'
import { getConfig } from '../utils/config'
import { useFellowClient } from '../utils/fellow-client'
import { currentLogFile, useLogger } from '../utils/logger'
import { checkStartupSafety } from '../utils/startup'

/** Refuses to start off loopback, pins Nitro's bind address to the config, logs the startup line, probes Fellow. */
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

  // Nitro reads these when it listens, which happens after plugins have run. Setting them here makes
  // aiden.config.ts (or the documented overrides) the address that is really bound, never a stray variable.
  process.env.NITRO_HOST = config.host
  process.env.NITRO_PORT = String(config.port)

  const logger = useLogger()
  const fellowTarget = new URL(config.fellow.baseUrl)
  logger.info({
    app: config.app.name,
    fellowHost: fellowTarget.host,
    host: config.host,
    port: config.port,
    dryRun: config.fellow.dryRun,
    timezone: config.fellow.timezone,
    allowedHosts: config.allowedHosts,
    logLevel: config.logging.level,
    cacheTtlMs: config.fellow.cacheTtlMs,
  }, 'aiden-studio starting')
  console.log(`${config.app.name} on http://${config.host}:${config.port} | dry run: ${config.fellow.dryRun} | logs: ${config.isProduction ? currentLogFile(config) : 'stdout'}`)

  if (fellowTarget.protocol !== 'https:') {
    logger.warn({ baseUrl: fellowTarget.origin }, 'FELLOW_BASE_URL points at a plain-http address: this is a mock, not Fellow')
    console.log(`Talking to a MOCK brewer at ${fellowTarget.origin}, not to Fellow.`)
  }
  warnIfEnvFileIsShared(logger)

  useFellowClient().getDevice().then(
    device => logger.info({ deviceId: device.id, displayName: device.displayName }, 'Fellow brewer reachable'),
    (error: unknown) => logger.warn({ code: error instanceof FellowError ? error.code : 'unknown' }, 'Fellow probe failed; the dashboard will show the error'),
  )
})

/** The .env file holds the owner's real Fellow password; other local accounts should not be able to read it. */
function warnIfEnvFileIsShared(logger: ReturnType<typeof useLogger>): void {
  if (process.platform === 'win32' || !existsSync('.env')) return
  try {
    const mode = statSync('.env').mode & 0o777
    if ((mode & 0o077) !== 0) {
      logger.warn({ mode: mode.toString(8) }, '.env is readable by other accounts on this machine; run: chmod 600 .env')
    }
  }
  catch {
    // Unreadable stat is not worth failing over.
  }
}
