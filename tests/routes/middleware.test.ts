import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'

describe('request pipeline', () => {
  beforeEach(() => useTestEnv())

  it('tags every response with a request id', async () => {
    const res = await createTestApp().fetch('/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects a Host that is not allowed', async () => {
    const res = await createTestApp().fetch('http://evil.example:3000/api/health')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'host_not_allowed' })
  })

  it('honours ALLOWED_HOSTS from the environment', async () => {
    useTestEnv({ ALLOWED_HOSTS: 'aiden.example.com' })
    const app = createTestApp()
    expect((await app.fetch('/api/health')).status).toBe(400)
    expect((await app.fetch('http://aiden.example.com/api/health')).status).toBe(200)
  })

  it('accepts the bracketed IPv6 loopback', async () => {
    expect((await createTestApp().fetch('http://[::1]:3000/api/health')).status).toBe(200)
  })

  it('lets GET through without CSRF headers', async () => {
    expect((await createTestApp().fetch('/api/health', {}, { sameOrigin: false })).status).toBe(200)
  })

  it('fails closed when the Host header is missing entirely', async () => {
    const res = await createTestApp().fetch('/api/health', {}, { noHost: true })
    expect(res.status).toBe(400)
  })

  it.each([
    ['cross-site', 'no-cors', 'image'],
    ['cross-site', 'cors', 'empty'],
    ['same-site', 'cors', 'empty'],
    ['cross-site', 'navigate', 'iframe'],
    ['cross-site', 'navigate', 'document'],
  ])('rejects a %s %s %s request to the API, even a GET', async (site, mode, dest) => {
    const res = await createTestApp().fetch('/api/device?fresh=1', { headers: { 'sec-fetch-site': site, 'sec-fetch-mode': mode, 'sec-fetch-dest': dest } }, { sameOrigin: false })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'cross_site_request' })
  })

  it.each([['sec-purpose', 'prefetch'], ['purpose', 'prefetch'], ['sec-purpose', 'prefetch;prerender']])('rejects a speculative API request marked %s: %s', async (header, value) => {
    const res = await createTestApp().fetch('/api/device', { headers: { [header]: value } }, { sameOrigin: false })
    expect(res.status).toBe(403)
  })

  it('still refuses a mutation arriving as a cross-site navigation (a form post from another site)', async () => {
    const res = await createTestApp().fetch('/api/profiles', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'origin': 'http://evil.example' },
    }, { sameOrigin: false })
    expect(res.status).toBe(403)
  })

  it('marks every API response no-store', async () => {
    const res = await createTestApp().fetch('/api/health')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('answers unknown API paths and unsupported methods with a JSON 404', async () => {
    const app = createTestApp()
    const missing = await app.json('GET', '/api/nope')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'not_found' })
    expect((await app.json('POST', '/api/profiles/p7')).status).toBe(404)
  })

  it('caps mutation bodies before any route reads them', async () => {
    const res = await createTestApp().fetch('/api/profiles/p7', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'content-length': String(2_000_000) },
      body: 'x',
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
  })

  it('rejects a mutation with neither Sec-Fetch-Site nor an allowed Origin', async () => {
    const res = await createTestApp().fetch('/api/profiles', { method: 'POST' }, { sameOrigin: false })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'cross_site_request' })
  })

  it('rejects a mutation from a foreign origin even when it claims same-site', async () => {
    const res = await createTestApp().fetch('/api/profiles', {
      method: 'POST',
      headers: { 'origin': 'http://evil.example', 'sec-fetch-site': 'same-site' },
    }, { sameOrigin: false })
    expect(res.status).toBe(403)
  })

  it('accepts a mutation with an allowed Origin and no Sec-Fetch-Site', async () => {
    const res = await createTestApp().fetch('/api/profiles', {
      method: 'POST',
      headers: { 'origin': 'http://localhost:3000', 'content-type': 'application/json' },
      body: '{}',
    }, { sameOrigin: false })
    expect(res.status).not.toBe(403)
  })
})
