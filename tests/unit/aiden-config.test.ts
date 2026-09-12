import { describe, expect, it } from 'vitest'
import { type AidenConfig, defineAidenConfig } from '../../server/utils/aiden-config'
import { AIDEN } from '../helpers/aiden-fixture'

describe('defineAidenConfig', () => {
  it('returns a valid config unchanged', () => {
    expect(defineAidenConfig(AIDEN)).toEqual(AIDEN)
  })
  it('rejects unknown keys, naming them', () => {
    expect(() => defineAidenConfig({ ...AIDEN, extra: true } as unknown as AidenConfig)).toThrow(/extra/)
  })
  it('insists on https for the Fellow base URL', () => {
    expect(() => defineAidenConfig({ ...AIDEN, fellow: { ...AIDEN.fellow, baseUrl: 'http://fellow.example/v2' } })).toThrow(/https/)
  })
  it('rejects nonsense numbers with the path in the message', () => {
    expect(() => defineAidenConfig({ ...AIDEN, logging: { ...AIDEN.logging, keepDays: 0 } })).toThrow(/logging\.keepDays/)
    expect(() => defineAidenConfig({ ...AIDEN, server: { ...AIDEN.server, port: 70_000 } })).toThrow(/server\.port/)
    expect(() => defineAidenConfig({ ...AIDEN, history: { ...AIDEN.history, idlePollSeconds: 5 } })).toThrow(/history\.idlePollSeconds/)
    expect(() => defineAidenConfig({ ...AIDEN, maintenance: { ...AIDEN.maintenance, descaleAfterLitres: 0 } })).toThrow(/maintenance\.descaleAfterLitres/)
  })
  it('the real aiden.config.ts loads and keeps the app on loopback', async () => {
    const { default: real } = await import('../../aiden.config')
    expect(['127.0.0.1', '::1', 'localhost']).toContain(real.server.host)
    expect(real.fellow.baseUrl.startsWith('https://')).toBe(true)
  })
})
