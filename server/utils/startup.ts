import { type AppConfig, isLoopbackHost } from './config'

/** Reasons the server must not start. Empty means go. The guard sees the bind address only, never proxies. */
export function checkStartupSafety(config: AppConfig): string[] {
  const problems: string[] = []
  if (config.host === undefined) {
    problems.push('HOST is not set, so Nitro would listen on every interface. Set HOST=127.0.0.1 in .env.')
  }
  else if (!isLoopbackHost(config.host)) {
    problems.push(`HOST=${config.host} is not a loopback address. Phase 1 has no login, so the app may only listen on 127.0.0.1, ::1, or localhost.`)
  }
  return problems
}
