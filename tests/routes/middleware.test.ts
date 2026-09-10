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
