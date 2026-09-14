import { z } from 'zod'

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

/**
 * Shape of `aiden.config.ts` at the repo root: every non-secret setting in one place.
 * Secrets never live here; they come from `.env`. `null` means "decide at runtime" where noted.
 */
export const AidenConfigSchema = z.strictObject({
  app: z.strictObject({
    /** Shown in the page title and the startup line. */
    name: z.string().min(1),
  }),
  server: z.strictObject({
    /** Address to listen on. Phase 1 has no login, so the startup guard insists on a loopback address. */
    host: z.string().min(1),
    port: z.int().min(1).max(65535),
    /** Hostnames accepted in the Host header, as they appear there (port ignored, IPv6 in brackets). */
    allowedHosts: z.array(z.string().min(1)).min(1),
    /**
     * Tailscale logins allowed to make changes when the request arrives through `tailscale serve`, which stamps the
     * signed-in user on it. Empty means any member of the tailnet. Reads are never restricted by this.
     */
    tailnetUsers: z.array(z.string().min(1)),
  }),
  fellow: z.strictObject({
    /** Log mutations instead of sending them. Reads still go to Fellow. */
    dryRun: z.boolean(),
    /** IANA zone sent at login; null means this machine's zone. */
    timezone: z.string().nullable(),
    baseUrl: z.url({ protocol: /^https$/, error: 'baseUrl must be an https URL' }),
    timeoutMs: z.int().min(1_000).max(120_000),
    retry: z.strictObject({
      /** Attempts for GET and DELETE on 408/5xx and network errors. POST and PATCH always get one. */
      attempts: z.int().min(1).max(10),
      backoffBaseMs: z.int().min(0).max(10_000),
    }),
    /** How long device, profile, and schedule reads are reused before Fellow is asked again. */
    cacheTtlMs: z.int().min(0).max(600_000),
  }),
  logging: z.strictObject({
    /** null means info in production and debug in development. */
    level: z.enum(LOG_LEVELS).nullable(),
    /** Production log directory, relative to the working directory. */
    directory: z.string().min(1),
    /** Daily files kept before the oldest is deleted. */
    keepDays: z.int().min(1).max(365),
    /** A file also rotates when it reaches this size, so a noisy day cannot fill the disk. */
    maxFileMb: z.int().min(1).max(1024),
  }),
  ui: z.strictObject({
    colorMode: z.enum(['dark', 'light', 'system']),
    /** Ask before sending a remote Instant Brew start. */
    confirmBrewStart: z.boolean(),
  }),
  history: z.strictObject({
    /** Where the brew log and the descale marker live, relative to the working directory. */
    directory: z.string().min(1),
    /** How often the service reads the brewer while it is idle. */
    idlePollSeconds: z.int().min(15).max(3600),
    /** How often it reads during a brew, for the trace. */
    brewPollSeconds: z.int().min(2).max(60),
  }),
  maintenance: z.strictObject({
    /** Litres brewed since the last descale at which the tally reads due. */
    descaleAfterLitres: z.number().positive(),
    /** Brews since the last descale at which the tally reads due; 0 turns this threshold off. */
    descaleAfterBrews: z.int().min(0),
    /** After this many minutes, the dashboard stops calling the coffee fresh. */
    coffeeFreshMinutes: z.int().min(1).max(720),
    /** After this many minutes since the brew, the clock stops: the coffee is cold and the reading says nothing. */
    coffeeHorizonMinutes: z.int().min(1).max(1440),
  }),
})

export type AidenConfig = z.infer<typeof AidenConfigSchema>

/** Validates the config file at import time, so a typo fails the build or the first test run with a clear message. */
export function defineAidenConfig(config: AidenConfig): AidenConfig {
  const result = AidenConfigSchema.safeParse(config)
  if (!result.success) {
    const problems = result.error.issues.map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new Error(`aiden.config.ts is invalid:\n${problems.join('\n')}`)
  }
  return result.data
}
