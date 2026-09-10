import { describe, expect, it } from 'vitest'
import { isLoopbackHost, parseEnv } from '../../server/utils/config'

const MINIMAL = { FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2' }

describe('parseEnv', () => {
  it('applies documented defaults', () => {
    const config = parseEnv(MINIMAL)
    expect(config).toEqual({
      fellow: { email: 'coffee@example.com', password: 'hunter2', dryRun: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      logLevel: 'debug',
      host: undefined,
      port: 3000,
      isProduction: false,
    })
  })

  it('reads every variable', () => {
    const config = parseEnv({
      ...MINIMAL,
      FELLOW_DRY_RUN: 'true',
      FELLOW_TIMEZONE: 'America/Chicago',
      ALLOWED_HOSTS: ' Localhost , aiden.example.com ',
      LOG_LEVEL: 'warn',
      HOST: '127.0.0.1',
      PORT: '4000',
      NODE_ENV: 'production',
    })
    expect(config.fellow.dryRun).toBe(true)
    expect(config.fellow.timezone).toBe('America/Chicago')
    expect(config.allowedHosts).toEqual(['localhost', 'aiden.example.com'])
    expect(config.logLevel).toBe('warn')
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(4000)
    expect(config.isProduction).toBe(true)
  })

  it('defaults the log level to info in production', () => {
    expect(parseEnv({ ...MINIMAL, NODE_ENV: 'production' }).logLevel).toBe('info')
  })

  it('treats empty strings as unset', () => {
    const config = parseEnv({ ...MINIMAL, HOST: '', LOG_LEVEL: '', PORT: '' })
    expect(config.host).toBeUndefined()
    expect(config.port).toBe(3000)
    expect(config.logLevel).toBe('debug')
  })

  it.each(['1', 'yes', 'on', 'TRUE'])('parses %s as true', (value) => {
    expect(parseEnv({ ...MINIMAL, FELLOW_DRY_RUN: value }).fellow.dryRun).toBe(true)
  })

  it('names every invalid variable in one error', () => {
    const attempt = () => parseEnv({ FELLOW_EMAIL: 'not-an-email', FELLOW_PASSWORD: '', PORT: 'abc', FELLOW_DRY_RUN: 'maybe' })
    expect(attempt).toThrow(/FELLOW_EMAIL/)
    expect(attempt).toThrow(/FELLOW_PASSWORD/)
    expect(attempt).toThrow(/FELLOW_DRY_RUN/)
    expect(attempt).toThrow(/PORT/)
  })

  it('rejects a timezone that is not an IANA zone', () => {
    expect(() => parseEnv({ ...MINIMAL, FELLOW_TIMEZONE: 'Mars/Olympus_Mons' })).toThrow(/FELLOW_TIMEZONE/)
  })

  it('rejects an unknown log level', () => {
    expect(() => parseEnv({ ...MINIMAL, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
  })

  it('rejects an out-of-range port', () => {
    expect(() => parseEnv({ ...MINIMAL, PORT: '70000' })).toThrow(/PORT/)
  })
})

describe('isLoopbackHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
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
