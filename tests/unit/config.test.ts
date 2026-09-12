import { describe, expect, it } from 'vitest'
import { isLoopbackHost, parseEnv } from '../../server/utils/config'
import { AIDEN } from '../helpers/aiden-fixture'

const MINIMAL = { FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2' }
const machineZone = Intl.DateTimeFormat().resolvedOptions().timeZone

describe('parseEnv', () => {
  it('takes every setting from aiden.config.ts and only the secrets from the environment', () => {
    expect(parseEnv(MINIMAL, AIDEN)).toEqual({
      app: { name: 'test-studio' },
      fellow: {
        email: 'coffee@example.com',
        password: 'hunter2',
        dryRun: false,
        timezone: machineZone,
        baseUrl: 'https://fellow.example/v2',
        timeoutMs: 15_000,
        retry: { attempts: 3, backoffBaseMs: 250 },
        cacheTtlMs: 30_000,
      },
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      tailnetUsers: [],
      logging: { level: 'debug', directory: 'logs', keepDays: 14, maxFileMb: 50 },
      ui: { colorMode: 'dark', confirmBrewStart: true },
      history: { enabled: true, directory: 'data', idlePollSeconds: 60, brewPollSeconds: 5 },
      maintenance: { descaleAfterLitres: 60, descaleAfterBrews: 0 },
      isProduction: false,
    })
  })

  it('lets HISTORY_ENABLED stop the poller and HISTORY_DIRECTORY move the data', () => {
    const config = parseEnv({ ...MINIMAL, HISTORY_ENABLED: 'false', HISTORY_DIRECTORY: '/tmp/aiden-test-data' }, AIDEN)
    expect(config.history.enabled).toBe(false)
    expect(config.history.directory).toBe('/tmp/aiden-test-data')
    expect(parseEnv({ ...MINIMAL, HISTORY_ENABLED: '', HISTORY_DIRECTORY: '' }, AIDEN).history).toEqual({ enabled: true, directory: 'data', idlePollSeconds: 60, brewPollSeconds: 5 })
  })

  it('lets the documented environment keys override the file', () => {
    const config = parseEnv({
      ...MINIMAL,
      FELLOW_DRY_RUN: 'true',
      FELLOW_TIMEZONE: 'America/Chicago',
      ALLOWED_HOSTS: ' Localhost:3000 , aiden.example.com ',
      LOG_LEVEL: 'warn',
      HOST: 'localhost',
      PORT: '4000',
      NODE_ENV: 'production',
    }, AIDEN)
    expect(config.fellow.dryRun).toBe(true)
    expect(config.fellow.timezone).toBe('America/Chicago')
    expect(config.allowedHosts).toEqual(['localhost', 'aiden.example.com'])
    expect(config.logging.level).toBe('warn')
    expect(config.host).toBe('localhost')
    expect(config.port).toBe(4000)
    expect(config.isProduction).toBe(true)
  })

  it('uses the file\'s explicit values when the environment leaves them blank', () => {
    const aiden = { ...AIDEN, fellow: { ...AIDEN.fellow, dryRun: true, timezone: 'Europe/Oslo' }, logging: { ...AIDEN.logging, level: 'trace' as const } }
    const config = parseEnv({ ...MINIMAL, FELLOW_DRY_RUN: '', FELLOW_TIMEZONE: '', LOG_LEVEL: '', HOST: '', PORT: '' }, aiden)
    expect(config.fellow.dryRun).toBe(true)
    expect(config.fellow.timezone).toBe('Europe/Oslo')
    expect(config.logging.level).toBe('trace')
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(3000)
  })

  it('defaults the log level to info in production when the file says null', () => {
    expect(parseEnv({ ...MINIMAL, NODE_ENV: 'production' }, AIDEN).logging.level).toBe('info')
  })

  it('mirrors Nitro\'s precedence: NITRO_HOST and NITRO_PORT beat HOST and PORT', () => {
    const config = parseEnv({ ...MINIMAL, NITRO_HOST: '0.0.0.0', HOST: '127.0.0.1', NITRO_PORT: '5000', PORT: '4000' }, AIDEN)
    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBe(5000)
  })

  it('lower-cases the tailnet logins allowed to make changes', () => {
    const aiden = { ...AIDEN, server: { ...AIDEN.server, tailnetUsers: [' Owner@GitHub ', ''] } }
    expect(parseEnv(MINIMAL, aiden).tailnetUsers).toEqual(['owner@github'])
    expect(parseEnv({ ...MINIMAL, TAILNET_USERS: 'a@github, B@Github' }, aiden).tailnetUsers).toEqual(['a@github', 'b@github'])
  })

  it('normalises allowed hosts from either source', () => {
    const aiden = { ...AIDEN, server: { ...AIDEN.server, allowedHosts: ['LOCALHOST:3000', '[::1]:3000'] } }
    expect(parseEnv(MINIMAL, aiden).allowedHosts).toEqual(['localhost', '[::1]'])
  })

  it.each(['1', 'yes', 'on', 'TRUE'])('parses %s as true', (value) => {
    expect(parseEnv({ ...MINIMAL, FELLOW_DRY_RUN: value }, AIDEN).fellow.dryRun).toBe(true)
  })

  it('names every invalid variable in one error', () => {
    const attempt = () => parseEnv({ FELLOW_EMAIL: 'not-an-email', FELLOW_PASSWORD: '', PORT: 'abc', FELLOW_DRY_RUN: 'maybe' }, AIDEN)
    expect(attempt).toThrow(/FELLOW_EMAIL/)
    expect(attempt).toThrow(/FELLOW_PASSWORD/)
    expect(attempt).toThrow(/FELLOW_DRY_RUN/)
    expect(attempt).toThrow(/PORT/)
  })

  it('rejects a bad time zone from either source, saying which', () => {
    expect(() => parseEnv({ ...MINIMAL, FELLOW_TIMEZONE: 'Mars/Olympus_Mons' }, AIDEN)).toThrow(/FELLOW_TIMEZONE/)
    const aiden = { ...AIDEN, fellow: { ...AIDEN.fellow, timezone: 'Nowhere/Nope' } }
    expect(() => parseEnv(MINIMAL, aiden)).toThrow(/aiden\.config\.ts/)
  })

  it('lets FELLOW_BASE_URL point at a loopback mock over plain http, but nowhere else', () => {
    expect(parseEnv({ ...MINIMAL, FELLOW_BASE_URL: 'http://127.0.0.1:3900/v2' }, AIDEN).fellow.baseUrl).toBe('http://127.0.0.1:3900/v2')
    expect(parseEnv({ ...MINIMAL, FELLOW_BASE_URL: 'http://localhost:3900/v2' }, AIDEN).fellow.baseUrl).toBe('http://localhost:3900/v2')
    expect(parseEnv({ ...MINIMAL, FELLOW_BASE_URL: 'http://[::1]:3900/v2' }, AIDEN).fellow.baseUrl).toBe('http://[::1]:3900/v2')
    expect(() => parseEnv({ ...MINIMAL, FELLOW_BASE_URL: 'http://localhost.evil.example/v2' }, AIDEN)).toThrow(/FELLOW_BASE_URL/)
    expect(parseEnv({ ...MINIMAL, FELLOW_BASE_URL: 'https://api.example/v2' }, AIDEN).fellow.baseUrl).toBe('https://api.example/v2')
    expect(() => parseEnv({ ...MINIMAL, FELLOW_BASE_URL: 'http://api.example/v2' }, AIDEN)).toThrow(/FELLOW_BASE_URL/)
    expect(() => parseEnv({ ...MINIMAL, FELLOW_BASE_URL: 'ftp://127.0.0.1/v2' }, AIDEN)).toThrow(/FELLOW_BASE_URL/)
  })

  it('accepts silent as a log level for tests', () => {
    expect(parseEnv({ ...MINIMAL, LOG_LEVEL: 'silent' }, AIDEN).logging.level).toBe('silent')
  })

  it('rejects an unknown log level and an out-of-range port', () => {
    expect(() => parseEnv({ ...MINIMAL, LOG_LEVEL: 'loud' }, AIDEN)).toThrow(/LOG_LEVEL/)
    expect(() => parseEnv({ ...MINIMAL, PORT: '70000' }, AIDEN)).toThrow(/PORT/)
  })
})

describe('isLoopbackHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['[::1]', true],
    ['localhost', true],
    ['LOCALHOST', true],
    ['0.0.0.0', false],
    ['::', false],
    ['192.168.1.10', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected)
  })
})
