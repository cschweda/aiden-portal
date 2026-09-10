import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../server/utils/version'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

describe('GET /api/status', () => {
  beforeEach(() => useTestEnv())

  it('reports dry run, version, and an unknown Fellow state before any call', async () => {
    useTestEnv({ FELLOW_DRY_RUN: 'true' })
    const { status, body } = await createTestApp().json('GET', '/api/status')
    expect(status).toBe(200)
    expect(body).toEqual({ dryRun: true, version: APP_VERSION, fellow: 'unknown' })
  })

  it('reflects the last Fellow outcome', async () => {
    server.use(...happyHandlers(newCalls()))
    const app = createTestApp()
    await app.json('GET', '/api/device')
    expect((await app.json('GET', '/api/status')).body.fellow).toBe('ok')
  })

  it('shows auth_failed after Fellow rejects the credentials', async () => {
    server.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({ message: 'no' }, { status: 401 })))
    const app = createTestApp()
    const device = await app.json('GET', '/api/device')
    expect(device.status).toBe(502)
    expect(device.body).toEqual({ error: 'fellow_auth_failed', message: expect.any(String) })
    expect((await app.json('GET', '/api/status')).body.fellow).toBe('fellow_auth_failed')
  })
})
