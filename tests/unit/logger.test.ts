import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { parseEnv } from '../../server/utils/config'
import { buildLoggerOptions, createLogger } from '../../server/utils/logger'
import { AIDEN } from '../helpers/aiden-fixture'

function capture() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString())
      callback()
    },
  })
  return { stream, records: () => lines.filter(l => l.trim()).map(l => JSON.parse(l) as Record<string, unknown>) }
}

const config = parseEnv({ FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2', LOG_LEVEL: 'debug' }, AIDEN)

describe('logger', () => {
  it('redacts secrets at the top level and up to two levels down', () => {
    const { stream, records } = capture()
    const logger = createLogger(config, stream)
    logger.info({
      password: 'hunter2-SECRET',
      accessToken: 'tok-SECRET',
      body: { refreshToken: 'ref-SECRET', nested: { authorization: 'Bearer SECRET', cookie: 'c=SECRET' } },
      keep: 'visible',
    }, 'hello')
    const [record] = records()
    expect(record).toMatchObject({
      msg: 'hello',
      password: '[redacted]',
      accessToken: '[redacted]',
      body: { refreshToken: '[redacted]', nested: { authorization: '[redacted]', cookie: '[redacted]' } },
      keep: 'visible',
    })
    expect(JSON.stringify(record)).not.toContain('SECRET')
  })

  it('honours the configured level', () => {
    const { stream, records } = capture()
    const logger = createLogger(parseEnv({ FELLOW_EMAIL: 'a@b.co', FELLOW_PASSWORD: 'x', LOG_LEVEL: 'warn' }, AIDEN), stream)
    logger.info({}, 'dropped')
    logger.warn({}, 'kept')
    expect(records().map(r => r.msg)).toEqual(['kept'])
  })

  it('carries a child requestId on every line', () => {
    const { stream, records } = capture()
    const child = createLogger(config, stream).child({ requestId: 'req-1' })
    child.debug({ a: 1 }, 'one')
    child.error({ b: 2 }, 'two')
    expect(records().map(r => r.requestId)).toEqual(['req-1', 'req-1'])
  })

  it('exposes options with the redaction paths for reuse', () => {
    const options = buildLoggerOptions(config)
    expect(options.level).toBe('debug')
    expect((options.redact as { paths: string[] }).paths).toEqual(expect.arrayContaining(['password', '*.password', '*.*.password']))
  })
})
