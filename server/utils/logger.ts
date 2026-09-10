import pino from 'pino'
import pretty from 'pino-pretty'
import { getConfig } from './config'

let instance: pino.Logger | undefined

/** Process-wide pino logger. Pretty in development, JSON lines in production. Extended in checkpoint 2. */
export function useLogger(): pino.Logger {
  if (!instance) {
    const config = getConfig()
    instance = config.isProduction
      ? pino({ level: config.logLevel })
      : pino({ level: config.logLevel }, pretty({ colorize: true, translateTime: 'HH:MM:ss' }))
  }
  return instance
}
