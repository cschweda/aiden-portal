import { type AppConfig, isLoopbackHost } from './config'

/**
 * Reasons the server must not start. Empty means go. `config.host` already reflects NITRO_HOST, HOST, and
 * aiden.config.ts in Nitro's own precedence, so this judges the address that will really be bound.
 * The guard sees the bind address only, never proxies in front of it.
 */
export function checkStartupSafety(config: AppConfig): string[] {
  const problems: string[] = []
  if (!isLoopbackHost(config.host)) {
    problems.push(`The bind address ${config.host} is not loopback. Phase 1 has no login, so the app may only listen on 127.0.0.1, ::1, or localhost (server.host in aiden.config.ts, or HOST / NITRO_HOST in the environment).`)
  }
  return problems
}
