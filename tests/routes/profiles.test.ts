import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, DEVICE, PROFILE_INPUT, PROFILE_P7, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

const profilesUrl = `${BASE}/devices/${DEVICE.id}/profiles`

describe('/api/profiles', () => {
  beforeEach(() => useTestEnv())

  it('lists profiles', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('GET', '/api/profiles')
    expect(status).toBe(200)
    expect(body.map((p: { id: string }) => p.id)).toEqual(['p7', 'p8'])
  })

  it('creates a profile and answers 201 with Fellow\'s record', async () => {
    let posted: unknown
    server.use(...happyHandlers(newCalls()), http.post(profilesUrl, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ ...PROFILE_INPUT, id: 'p9' })
    }))
    const { status, body } = await createTestApp().json('POST', '/api/profiles', PROFILE_INPUT)
    expect(status).toBe(201)
    expect(body.id).toBe('p9')
    expect(posted).toEqual(PROFILE_INPUT)
  })

  it('rejects an invalid profile with 400 and the offending paths', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/profiles', { ...PROFILE_INPUT, ratio: 3, title: '' })
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
    expect([...new Set(body.issues.map((i: { path: string }) => i.path))].sort()).toEqual(['ratio', 'title'])
  })

  it('rejects unknown keys (server-side fields such as id are stripped first, so those pass)', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/profiles', { ...PROFILE_INPUT, bogus: 1 })
    expect(status).toBe(400)
    expect(body.issues[0].path).toBe('')
    expect(body.issues[0].message).toMatch(/bogus/)
  })

  it.each(['PATCH', 'POST'])('answers malformed JSON on %s with our 400 envelope, not a 500', async (method) => {
    server.use(...happyHandlers(newCalls()))
    const res = await createTestApp().fetch(method === 'PATCH' ? '/api/profiles/p7' : '/api/profiles', {
      method,
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request', message: expect.any(String) })
  })

  it('rejects a non-object body with 400 rather than crashing', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/profiles', [1, 2, 3])
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
  })

  it('updates a profile', async () => {
    let patched: unknown
    server.use(...happyHandlers(newCalls()), http.patch(`${profilesUrl}/p7`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({})
    }))
    const { status, body } = await createTestApp().json('PATCH', '/api/profiles/p7', { ...PROFILE_P7, title: 'Renamed' })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(patched).toEqual({ ...PROFILE_INPUT, title: 'Renamed' })
  })

  it('rejects a malformed id in the path with 400', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('DELETE', '/api/profiles/x1')
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
  })

  it('deletes, shares, and imports', async () => {
    let deleted = false
    let importedBody: unknown
    server.use(
      ...happyHandlers(newCalls()),
      http.delete(`${profilesUrl}/p7`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(`${profilesUrl}/p7/share`, () => HttpResponse.json({ link: 'https://brew.link/p/ws98' })),
      http.get(`${BASE}/shared/aiden/ws98`, () => HttpResponse.json(PROFILE_P7)),
      http.post(profilesUrl, async ({ request }) => {
        importedBody = await request.json()
        return HttpResponse.json({ ...PROFILE_INPUT, id: 'p10' })
      }),
    )
    const app = createTestApp()
    expect(await app.json('DELETE', '/api/profiles/p7')).toMatchObject({ status: 200, body: { ok: true } })
    expect(deleted).toBe(true)
    expect(await app.json('POST', '/api/profiles/p7/share')).toMatchObject({ status: 200, body: { link: 'https://brew.link/p/ws98' } })
    const imported = await app.json('POST', '/api/profiles/import', { link: 'https://brew.link/p/ws98' })
    expect(imported.status).toBe(201)
    expect(imported.body.id).toBe('p10')
    expect(importedBody).toEqual(PROFILE_INPUT)
  })

  it('answers 502 with the Fellow error code when Fellow fails', async () => {
    server.use(...happyHandlers(newCalls()), http.post(`${profilesUrl}/p7/share`, () => HttpResponse.json({ message: 'internal', stack: 'secret' }, { status: 500 })))
    const { status, body } = await createTestApp().json('POST', '/api/profiles/p7/share')
    expect(status).toBe(502)
    expect(body.error).toBe('fellow_http_error')
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('rejects an invalid brew link with 400', async () => {
    server.use(...happyHandlers(newCalls()))
    const { status, body } = await createTestApp().json('POST', '/api/profiles/import', { link: 'https://brew.link/q/ws98' })
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
    expect(body.issues[0].path).toBe('link')
  })
})
