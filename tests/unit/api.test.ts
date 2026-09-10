import { createApp, createError, createRouter, toWebHandler } from 'h3'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FellowError } from '../../server/lib/fellow/errors'
import { defineApiRoute, parseFresh } from '../../server/utils/api'
import { resetConfigForTests } from '../../server/utils/config'
import { resetLoggerForTests } from '../../server/utils/logger'

beforeAll(() => {
  Object.assign(process.env, { FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2', HOST: '127.0.0.1', LOG_LEVEL: 'silent' })
  resetConfigForTests()
  resetLoggerForTests()
})

function appWith(routes: Record<string, () => unknown>) {
  const app = createApp()
  const router = createRouter()
  for (const [path, fn] of Object.entries(routes)) router.get(path, defineApiRoute(fn))
  router.get('/fresh', defineApiRoute(event => ({ fresh: parseFresh(event) })))
  app.use(router)
  return toWebHandler(app)
}

describe('defineApiRoute', () => {
  const handler = appWith({
    '/ok': () => ({ hello: 'world' }),
    '/zod': () => z.object({ ratio: z.number().min(14) }).parse({ ratio: 3 }),
    '/fellow': () => {
      throw new FellowError('fellow_auth_failed', 'Fellow rejected the email or password', { status: 401, body: { secret: 'never' } })
    },
    '/boom': () => {
      throw new Error('kaboom')
    },
    '/h3-400': () => {
      throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
    },
    '/h3-418': () => {
      throw createError({ statusCode: 418 })
    },
    '/h3-503': () => {
      throw createError({ statusCode: 503, statusMessage: 'Upstream sad', data: { secret: 'x' } })
    },
  })
  const get = async (path: string) => {
    const res = await handler(new Request(`http://localhost:3000${path}`))
    return { status: res.status, body: await res.json() }
  }

  it('passes results through', async () => {
    expect(await get('/ok')).toEqual({ status: 200, body: { hello: 'world' } })
  })
  it('maps Zod errors to 400 with the issue list', async () => {
    const { status, body } = await get('/zod')
    expect(status).toBe(400)
    expect(body.error).toBe('validation_failed')
    expect(body.issues).toEqual([{ path: 'ratio', message: expect.stringMatching(/14/) }])
  })
  it('maps FellowError to 502 with the code and message but never the body', async () => {
    const { status, body } = await get('/fellow')
    expect(status).toBe(502)
    expect(body).toEqual({ error: 'fellow_auth_failed', message: 'Fellow rejected the email or password' })
    expect(JSON.stringify(body)).not.toContain('never')
  })
  it('maps anything else to a generic 500', async () => {
    expect(await get('/boom')).toEqual({ status: 500, body: { error: 'internal_error' } })
  })
  it('keeps h3 client errors in our envelope with their status', async () => {
    expect(await get('/h3-400')).toEqual({ status: 400, body: { error: 'bad_request', message: 'Invalid JSON body' } })
    const teapot = await get('/h3-418')
    expect(teapot.status).toBe(418)
    expect(teapot.body.error).toBe('http_error')
  })
  it('never forwards an h3 server error\'s details', async () => {
    expect(await get('/h3-503')).toEqual({ status: 500, body: { error: 'internal_error' } })
  })
  it.each([['?fresh=1', true], ['?fresh=true', true], ['?fresh=0', false], ['', false]])('parseFresh %j → %s', async (query, expected) => {
    expect((await get(`/fresh${query}`)).body).toEqual({ fresh: expected })
  })
})
