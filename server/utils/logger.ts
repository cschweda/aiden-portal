import pino from 'pino'
import pretty from 'pino-pretty'
import { getConfig } from './config'

const SECRET_KEYS = ['password', 'accessToken', 'refreshToken', 'authorization', 'cookie']
/** Top-level and up to two levels deep, which covers request bodies, headers, and config dumps. */
const REDACTED_PATHS = SECRET_KEYS.flatMap(key => [key, `*.${key}`, `*.*.${key}`])

let instance: pino.Logger | undefined

/** Process-wide pino logger. Pretty in development, JSON lines in production. Extended in checkpoint 2. */
export function useLogger(): pino.Logger {
  if (!instance) {
    const config = getConfig()
    const options: pino.LoggerOptions = {
      level: config.logLevel,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    }
    instance = config.isProduction
      ? pino(options)
      : pino(options, pretty({ colorize: true, translateTime: 'HH:MM:ss' }))
  }
  return instance
}
