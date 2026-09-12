import { mkdirSync } from 'node:fs'
import pino from 'pino'
import pretty from 'pino-pretty'
// Imported for its side effect on the build only: Nitro's dependency tracing copies the package into
// .output because of this line, and the pino transport below then resolves it by name at runtime.
import 'pino-roll'
import type { LogLevel } from './aiden-config'
import { type AppConfig, getConfig } from './config'

const SECRET_KEYS = ['password', 'accessToken', 'refreshToken', 'authorization', 'cookie']
/** Top-level and up to two levels deep, which covers request bodies, headers, and config dumps. */
const REDACTED_PATHS = SECRET_KEYS.flatMap(key => [key, `*.${key}`, `*.*.${key}`])

/** pino-roll keeps this symlink pointing at the active file; the /logs page tails it. */
export function currentLogFile(config: AppConfig): string {
  return `${config.logging.directory}/current.log`
}

export function buildLoggerOptions(config: AppConfig): pino.LoggerOptions {
  return {
    level: config.logging.level,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  }
}

/** Production: rotating file only. Development: pretty stdout. Tests pass their own destination. */
export function createLogger(config: AppConfig, destination?: pino.DestinationStream): pino.Logger {
  const options = buildLoggerOptions(config)
  if (destination) return pino(options, destination)
  if (config.isProduction) {
    // Owner-only directory: the lines are redacted, but profile names and brewer ids are nobody else's business.
    mkdirSync(config.logging.directory, { recursive: true, mode: 0o700 })
    return pino(options, pino.transport({
      target: 'pino-roll',
      options: {
        file: `${config.logging.directory}/aiden`,
        extension: '.log',
        frequency: 'daily',
        size: `${config.logging.maxFileMb}m`,
        dateFormat: 'yyyy-MM-dd',
        limit: { count: config.logging.keepDays, removeOtherLogFiles: true },
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

/** The level in force now: the configured one until `setLogLevel` changes it for the life of the process. */
export function currentLogLevel(): LogLevel {
  return useLogger().level as LogLevel
}

/** Changes the level at runtime. pino applies it to the child loggers already made (the Fellow client's, each request's). */
export function setLogLevel(level: LogLevel): void {
  useLogger().level = level
}

export function resetLoggerForTests(): void {
  instance = undefined
}
