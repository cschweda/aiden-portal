import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, DEVICE, SCHEDULE_INPUT, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

const schedulesUrl = `${BASE}/devices/${DEVICE.id}/schedules`

describe('/api/schedules', () => {
  beforeEach(() => useTestEnv())

  it('lists schedules', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('GET', '/api/schedules')
    expect(status).toBe(200)
    expect(body.map((s: { id: string }) => s.id)).toEqual(['s0'])
  })

  it('creates a schedule', async () => {
    server.use(...happyHandlers(newCalls()), http.post(schedulesUrl, () => HttpResponse.json({ ...SCHEDULE_INPUT, id: 's1' })))
    const { status, body } = await createTestApp().json('POST', '/api/schedules', SCHEDULE_INPUT)
    expect(status).toBe(201)
    expect(body.id).toBe('s1')
  })

  it('rejects an invalid schedule', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/schedules', { ...SCHEDULE_INPUT, days: [true] })
    expect(status).toBe(400)
    expect(body.issues[0].path).toBe('days')
  })

  it('toggles and deletes', async () => {
    let patched: unknown
    let deleted = false
    server.use(
      ...happyHandlers(newCalls()),
      http.patch(`${schedulesUrl}/s0`, async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({})
      }),
      http.delete(`${schedulesUrl}/s0`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const app = createTestApp()
    expect(await app.json('PATCH', '/api/schedules/s0', { enabled: false })).toMatchObject({ status: 200, body: { ok: true } })
    expect(patched).toEqual({ enabled: false })
    expect(await app.json('DELETE', '/api/schedules/s0')).toMatchObject({ status: 200, body: { ok: true } })
    expect(deleted).toBe(true)
  })

  it('rejects a patch with unknown keys', async () => {
    server.use(...happyHandlers(newCalls()))
    expect((await createTestApp().json('PATCH', '/api/schedules/s0', { bogus: 1 })).status).toBe(400)
  })
})
