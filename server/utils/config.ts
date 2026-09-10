import { z } from 'zod'
import aidenConfig from '../../aiden.config'
import { type AidenConfig, LOG_LEVELS, type LogLevel } from './aiden-config'
import { hostnameOf } from './hosts'

export type { LogLevel } from './aiden-config'

function isIanaTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  }
  catch {
    return false
  }
}

const port = z.coerce.number().int().min(1).max(65535)

/** Secrets are required; everything else is an optional override of aiden.config.ts. */
const EnvSchema = z.object({
  FELLOW_EMAIL: z.email(),
  FELLOW_PASSWORD: z.string().min(1),
  FELLOW_DRY_RUN: z.stringbool().optional(),
  FELLOW_TIMEZONE: z.string().optional(),
  ALLOWED_HOSTS: z.string().optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  NITRO_HOST: z.string().optional(),
  HOST: z.string().optional(),
  NITRO_PORT: port.optional(),
  PORT: port.optional(),
  NODE_ENV: z.string().optional(),
})

export interface AppConfig {
  app: { name: string }
  fellow: {
    email: string
    password: string
    dryRun: boolean
    /** Always resolved: the override, the file, or this machine's zone. */
    timezone: string
    baseUrl: string
    timeoutMs: number
    retry: { attempts: number, backoffBaseMs: number }
    cacheTtlMs: number
  }
  /** The address Nitro will bind: NITRO_HOST, else HOST, else the file. The guard judges this value. */
  host: string
  port: number
  /** Lower-cased hostnames accepted in the Host header (port ignored). */
  allowedHosts: string[]
  logging: { level: LogLevel, directory: string, keepDays: number, maxFileMb: number }
  ui: AidenConfig['ui']
  isProduction: boolean
}

/** Drops empty-string values so `HOST=` in a .env file behaves like an unset variable. */
function withoutEmptyValues(env: Record<string, string | undefined>): Record<string, string> {
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') cleaned[key] = value
  }
  return cleaned
}

/**
 * Merges aiden.config.ts (every setting) with the environment (secrets, plus the documented overrides).
 * Nitro binds `NITRO_HOST || HOST` and `NITRO_PORT || PORT`, and that precedence is mirrored here so the
 * startup guard always judges the address that will really be bound.
 */
export function parseEnv(env: Record<string, string | undefined>, aiden: AidenConfig = aidenConfig): AppConfig {
  const result = EnvSchema.safeParse(withoutEmptyValues(env))
  if (!result.success) {
    const problems = result.error.issues.map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`)
  }
  const raw = result.data
  const isProduction = raw.NODE_ENV === 'production'

  const timezone = raw.FELLOW_TIMEZONE ?? aiden.fellow.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  if (!isIanaTimeZone(timezone)) {
    const source = raw.FELLOW_TIMEZONE ? 'FELLOW_TIMEZONE' : 'aiden.config.ts fellow.timezone'
    throw new Error(`Invalid time zone "${timezone}" in ${source}; use an IANA zone such as America/Chicago`)
  }

  const allowedHosts = (raw.ALLOWED_HOSTS ? raw.ALLOWED_HOSTS.split(',') : aiden.server.allowedHosts)
    .map(hostnameOf)
    .filter(host => host.length > 0)

  return {
    app: { name: aiden.app.name },
    fellow: {
      email: raw.FELLOW_EMAIL,
      password: raw.FELLOW_PASSWORD,
      dryRun: raw.FELLOW_DRY_RUN ?? aiden.fellow.dryRun,
      timezone,
      baseUrl: aiden.fellow.baseUrl,
      timeoutMs: aiden.fellow.timeoutMs,
      retry: { ...aiden.fellow.retry },
      cacheTtlMs: aiden.fellow.cacheTtlMs,
    },
    host: raw.NITRO_HOST ?? raw.HOST ?? aiden.server.host,
    port: raw.NITRO_PORT ?? raw.PORT ?? aiden.server.port,
    allowedHosts,
    logging: {
      level: raw.LOG_LEVEL ?? aiden.logging.level ?? (isProduction ? 'info' : 'debug'),
      directory: aiden.logging.directory,
      keepDays: aiden.logging.keepDays,
      maxFileMb: aiden.logging.maxFileMb,
    },
    ui: { ...aiden.ui },
    isProduction,
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/** True for 127.0.0.1, ::1 (bracketed or not), and localhost, in any case. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return LOOPBACK_HOSTS.has(normalized)
}

let cached: AppConfig | undefined

/** The one place the app reads process.env. Parsed once; throws on the first call if the environment is invalid. */
export function getConfig(): AppConfig {
  cached ??= parseEnv(process.env)
  return cached
}

export function resetConfigForTests(): void {
  cached = undefined
}
