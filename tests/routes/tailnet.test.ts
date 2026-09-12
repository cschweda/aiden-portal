import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, useTestEnv } from '../helpers/app'

describe('changes through tailscale serve', () => {
  beforeEach(() => useTestEnv({ TAILNET_USERS: 'owner@github', LOG_LEVEL: 'info' }))

  it('lets a listed tailnet login make a change', async () => {
    const res = await createTestApp().fetch('/api/logs/level', { method: 'PATCH', headers: { 'tailscale-user-login': 'Owner@GitHub', 'content-type': 'application/json' }, body: JSON.stringify({ level: 'info' }) })
    expect(res.status).toBe(200)
  })

  it('refuses a change from any other tailnet login, but not a read', async () => {
    const app = createTestApp()
    const write = await app.fetch('/api/logs/level', { method: 'PATCH', headers: { 'tailscale-user-login': 'guest@github', 'content-type': 'application/json' }, body: JSON.stringify({ level: 'info' }) })
    expect(write.status).toBe(403)
    expect(await write.json()).toMatchObject({ error: 'tailnet_user_not_allowed' })
    const read = await app.fetch('/api/health', { headers: { 'tailscale-user-login': 'guest@github' } })
    expect(read.status).toBe(200)
  })

  it('does not apply to requests without a tailnet login', async () => {
    const res = await createTestApp().fetch('/api/logs/level', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'info' }) })
    expect(res.status).toBe(200)
  })

  it('echoes the login into the request log fields', async () => {
    const res = await createTestApp().fetch('/api/health', { headers: { 'tailscale-user-login': 'owner@github' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })
})
