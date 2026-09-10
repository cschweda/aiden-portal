import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, DEVICE, DEVICE_DETAIL, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

const READY_DETAIL = { ...DEVICE_DETAIL, firmwareVersion: '1.5.16' }

describe('POST /api/brew/start', () => {
  beforeEach(() => useTestEnv())

  it('refuses with the blockers from a live device read when the brewer is not ready', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const { status, body } = await createTestApp().json('POST', '/api/brew/start')
    expect(status).toBe(409)
    expect(body.error).toBe('brewer_not_ready')
    // The detail fixture is connected, closed, and watered; only its firmware (from the list) is too old.
    expect(body.blockers).toEqual(['firmware 1.2.3 is older than 1.5.16'])
    expect(calls).toMatchObject({ devices: 1, deviceDetail: 1 })
  })

  it('always checks a fresh device state before starting', async () => {
    const calls = newCalls()
    let started = false
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => {
        calls.deviceDetail++
        return HttpResponse.json(READY_DETAIL)
      }),
      ...happyHandlers(calls),
      http.patch(`${BASE}/devices/${DEVICE.id}/start`, ({ request }) => {
        started = new URL(request.url).searchParams.get('confirm') === 'true'
        return HttpResponse.json({ status: 'started' })
      }),
    )
    const app = createTestApp()
    await app.json('GET', '/api/device')
    const { status, body } = await app.json('POST', '/api/brew/start')
    expect(status).toBe(202)
    expect(body).toEqual({ ok: true, result: { status: 'started' } })
    expect(started).toBe(true)
    expect(calls.deviceDetail).toBe(1)
  })

  it('does not touch the brewer in dry-run mode', async () => {
    useTestEnv({ FELLOW_DRY_RUN: 'true' })
    const calls = newCalls()
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => {
        calls.deviceDetail++
        return HttpResponse.json(READY_DETAIL)
      }),
      ...happyHandlers(calls),
    )
    const app = createTestApp()
    await app.json('GET', '/api/device')
    const { status, body } = await app.json('POST', '/api/brew/start')
    expect(status).toBe(202)
    expect(body.result).toEqual({ dryRun: true })
  })
})
