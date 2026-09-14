import type { AidenConfig } from '../../server/utils/aiden-config'

/** A complete aiden.config.ts value for tests, independent of whatever the owner puts in the real file. */
export const AIDEN: AidenConfig = {
  app: { name: 'test-studio' },
  server: { host: '127.0.0.1', port: 3000, allowedHosts: ['localhost', '127.0.0.1', '[::1]'], tailnetUsers: [] },
  fellow: {
    dryRun: false,
    timezone: null,
    baseUrl: 'https://fellow.example/v2',
    timeoutMs: 15_000,
    retry: { attempts: 3, backoffBaseMs: 250 },
    cacheTtlMs: 30_000,
  },
  logging: { level: null, directory: 'logs', keepDays: 14, maxFileMb: 50 },
  ui: { colorMode: 'dark', confirmBrewStart: true },
  history: { directory: 'data', idlePollSeconds: 60, brewPollSeconds: 5 },
  maintenance: { descaleAfterLitres: 60, descaleAfterBrews: 0, coffeeFreshMinutes: 30, coffeeHorizonMinutes: 120 },
}
