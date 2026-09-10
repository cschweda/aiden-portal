import { getConfig } from './config'
import { FellowClient } from '../lib/fellow'
import { useLogger } from './logger'

let instance: FellowClient | undefined

/** The single Fellow client for this process. Credentials come from config and never leave the server. */
export function useFellowClient(): FellowClient {
  if (!instance) {
    const { fellow } = getConfig()
    instance = new FellowClient({
      email: fellow.email,
      password: fellow.password,
      timezone: fellow.timezone,
      dryRun: fellow.dryRun,
      logger: useLogger().child({ module: 'fellow' }),
    })
  }
  return instance
}

export function resetFellowClientForTests(): void {
  instance = undefined
}
