import pino from 'pino'
import pretty from 'pino-pretty'
// Imported for its side effect on the build only: Nitro's dependency tracing copies the package into
// .output because of this line, and the pino transport below then resolves it by name at runtime.
import 'pino-roll'
import { type AppConfig, getConfig } from './config'

const SECRET_KEYS = ['password', 'accessToken', 'refreshToken', 'authorization', 'cookie']
/** Top-level and up to two levels deep, which covers request bodies, headers, and config dumps. */
const REDACTED_PATHS = SECRET_KEYS.flatMap(key => [key, `*.${key}`, `*.*.${key}`])

export const LOG_DIRECTORY = 'logs'
/** pino-roll keeps this symlink pointing at the active file; the /logs page tails it. */
export const CURRENT_LOG_FILE = `${LOG_DIRECTORY}/current.log`

export function buildLoggerOptions(config: AppConfig): pino.LoggerOptions {
  return {
    level: config.logLevel,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  }
}

/** Production: rotating file only. Development: pretty stdout. Tests pass their own destination. */
export function createLogger(config: AppConfig, destination?: pino.DestinationStream): pino.Logger {
  const options = buildLoggerOptions(config)
  if (destination) return pino(options, destination)
  if (config.isProduction) {
    return pino(options, pino.transport({
      target: 'pino-roll',
      options: {
        file: `${LOG_DIRECTORY}/aiden`,
        extension: '.log',
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        limit: { count: 14, removeOtherLogFiles: true },
        symlink: true,
        mkdir: true,
      },
    }))
  }
  return pino(options, pretty({ colorize: true, translateTime: 'HH:MM:ss' }))
}

let instance: pino.Logger | undefined

export function useLogger(): pino.Logger {
  instance ??= createLogger(getConfig())
  return instance
}

export function resetLoggerForTests(): void {
  instance = undefined
}
