import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'

describe('GET /api/logs', () => {
  beforeEach(() => useTestEnv())

  it('validates its query', async () => {
    const app = createTestApp()
    expect((await app.json('GET', '/api/logs?lines=abc')).status).toBe(400)
    expect((await app.json('GET', '/api/logs?level=loud')).status).toBe(400)
    expect((await app.json('GET', '/api/logs?lines=5000')).status).toBe(400)
  })

  it('reports no file in development without failing', async () => {
    const { status, body } = await createTestApp().json('GET', '/api/logs?lines=50&level=warn')
    expect(status).toBe(200)
    expect(body).toMatchObject({ available: false, records: [] })
    expect(typeof body.file).toBe('string')
  })
})
