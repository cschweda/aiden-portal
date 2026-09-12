import { beforeEach, describe, expect, it } from 'vitest'
import { useLogger } from '../../server/utils/logger'
import { createTestApp, useTestEnv } from '../helpers/app'

describe('GET /api/logs', () => {
  beforeEach(() => useTestEnv())

  it('validates its query', async () => {
    const app = createTestApp()
    expect((await app.json('GET', '/api/logs?lines=abc')).status).toBe(400)
    expect((await app.json('GET', '/api/logs?level=loud')).status).toBe(400)
    expect((await app.json('GET', '/api/logs?lines=5000')).status).toBe(400)
  })

  it('reports logs as unavailable outside production without touching the disk', async () => {
    const { status, body } = await createTestApp().json('GET', '/api/logs?lines=50&level=warn')
    expect(status).toBe(200)
    expect(body).toMatchObject({ available: false, records: [], production: false })
    expect(typeof body.file).toBe('string')
    expect(body.level).toBe('silent')
  })
})

describe('PATCH /api/logs/level', () => {
  beforeEach(() => useTestEnv({ LOG_LEVEL: 'info' }))

  it('switches the running level, which the logs route then reports', async () => {
    const app = createTestApp()
    const child = useLogger().child({ module: 'test' })
    const { status, body } = await app.json('PATCH', '/api/logs/level', { level: 'debug' })
    expect(status).toBe(200)
    expect(body).toEqual({ level: 'debug' })
    expect(useLogger().level).toBe('debug')
    expect(child.level).toBe('debug')
    expect((await app.json('GET', '/api/logs')).body.level).toBe('debug')
  })

  it('rejects an unknown level and a missing body', async () => {
    const app = createTestApp()
    expect((await app.json('PATCH', '/api/logs/level', { level: 'loud' })).status).toBe(400)
    expect((await app.json('PATCH', '/api/logs/level', 'debug')).status).toBe(400)
    expect(useLogger().level).toBe('info')
  })

  it('is refused cross-site like every other write', async () => {
    const res = await createTestApp().fetch('/api/logs/level', { method: 'PATCH', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: JSON.stringify({ level: 'debug' }) })
    expect(res.status).toBe(403)
  })
})
