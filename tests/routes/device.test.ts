import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'
import { DEVICE, DEVICE_DETAIL, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

describe('GET /api/device', () => {
  beforeEach(() => useTestEnv())

  it('returns the device with readiness, serving repeats from cache', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const app = createTestApp()
    const first = await app.json('GET', '/api/device')
    expect(first.status).toBe(200)
    expect(first.body.device).toEqual(DEVICE)
    expect(first.body.canStartBrew).toBe(false)
    expect(first.body.blockers).toContain('brewer is offline')
    await app.json('GET', '/api/device')
    expect(calls.devices).toBe(1)
  })

  it('refreshes through the detail route when fresh is requested', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const app = createTestApp()
    await app.json('GET', '/api/device')
    const { body } = await app.json('GET', '/api/device?fresh=1')
    expect(calls.deviceDetail).toBe(1)
    expect(body.device).toEqual({ ...DEVICE, ...DEVICE_DETAIL })
  })
})
