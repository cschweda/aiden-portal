import { z } from 'zod'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

function isIanaTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  }
  catch {
    return false
  }
}

const EnvSchema = z.object({
  FELLOW_EMAIL: z.email(),
  FELLOW_PASSWORD: z.string().min(1),
  FELLOW_DRY_RUN: z.stringbool().default(false),
  FELLOW_TIMEZONE: z.string().optional().refine(zone => zone === undefined || isIanaTimeZone(zone), {
    error: 'must be an IANA time zone such as America/Chicago',
  }),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,[::1]'),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.string().optional(),
})

export interface AppConfig {
  /** `timezone` is sent to Fellow at login; defaults to this machine's zone. */
  fellow: { email: string, password: string, dryRun: boolean, timezone: string }
  /** Lower-cased hostnames accepted in the Host header (port ignored). */
  allowedHosts: string[]
  logLevel: LogLevel
  host: string | undefined
  port: number
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

export function parseEnv(env: Record<string, string | undefined>): AppConfig {
  const result = EnvSchema.safeParse(withoutEmptyValues(env))
  if (!result.success) {
    const problems = result.error.issues.map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`)
  }
  const raw = result.data
  const isProduction = raw.NODE_ENV === 'production'
  return {
    fellow: {
      email: raw.FELLOW_EMAIL,
      password: raw.FELLOW_PASSWORD,
      dryRun: raw.FELLOW_DRY_RUN,
      timezone: raw.FELLOW_TIMEZONE ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    },
    allowedHosts: raw.ALLOWED_HOSTS.split(',').map(h => h.trim().toLowerCase()).filter(h => h.length > 0),
    logLevel: raw.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    host: raw.HOST,
    port: raw.PORT,
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
