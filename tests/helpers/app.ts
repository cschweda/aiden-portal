import { createApp, createRouter, toWebHandler } from 'h3'
import brewStart from '../../server/api/brew/start.post'
import device from '../../server/api/device.get'
import health from '../../server/api/health.get'
import logs from '../../server/api/logs.get'
import profileDelete from '../../server/api/profiles/[id].delete'
import profileUpdate from '../../server/api/profiles/[id].patch'
import profileShare from '../../server/api/profiles/[id]/share.post'
import profileImport from '../../server/api/profiles/import.post'
import profilesList from '../../server/api/profiles/index.get'
import profileCreate from '../../server/api/profiles/index.post'
import scheduleDelete from '../../server/api/schedules/[id].delete'
import scheduleUpdate from '../../server/api/schedules/[id].patch'
import schedulesList from '../../server/api/schedules/index.get'
import scheduleCreate from '../../server/api/schedules/index.post'
import status from '../../server/api/status.get'
import notFound from '../../server/api/[...]'
import requestId from '../../server/middleware/00.request-id'
import hostAllowlist from '../../server/middleware/01.host-allowlist'
import csrf from '../../server/middleware/02.csrf'
import bodyLimit from '../../server/middleware/03.body-limit'
import { resetConfigForTests } from '../../server/utils/config'
import { resetFellowClientForTests } from '../../server/utils/fellow-client'
import { resetLoggerForTests } from '../../server/utils/logger'

const BASE_ENV: Record<string, string> = {
  FELLOW_EMAIL: 'coffee@example.com',
  FELLOW_PASSWORD: 'hunter2',
  FELLOW_DRY_RUN: 'false',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
}

/** A complete, known environment plus fresh config, logger, and Fellow client singletons. */
export function useTestEnv(overrides: Record<string, string> = {}): void {
  // Assigning undefined would store the string 'undefined'; the property has to go.
  for (const key of ['ALLOWED_HOSTS', 'FELLOW_TIMEZONE', 'PORT', 'NODE_ENV', 'NITRO_HOST', 'NITRO_PORT', 'LOG_LEVEL']) Reflect.deleteProperty(process.env, key)
  Object.assign(process.env, BASE_ENV, overrides)
  resetConfigForTests()
  resetLoggerForTests()
  resetFellowClientForTests()
}

// Route tests assert on loosely typed JSON; `any` keeps them readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface JsonResult { status: number, body: any, headers: Headers }

/**
 * The Nitro request pipeline and routes, mounted on a plain h3 app so tests run in-process against msw.
 * What this cannot see: nuxt-security's headers, Nuxt's own error rendering for errors thrown before a route,
 * and Nitro's file-based routing. Those are covered by scripts/smoke.sh against a real build.
 */
export function createTestApp() {
  const app = createApp()
  app.use(requestId)
  app.use(hostAllowlist)
  app.use(csrf)
  app.use(bodyLimit)
  const router = createRouter()
  router.get('/api/health', health)
  router.get('/api/status', status)
  router.get('/api/logs', logs)
  router.get('/api/device', device)
  router.get('/api/profiles', profilesList)
  router.post('/api/profiles', profileCreate)
  router.post('/api/profiles/import', profileImport)
  router.patch('/api/profiles/:id', profileUpdate)
  router.delete('/api/profiles/:id', profileDelete)
  router.post('/api/profiles/:id/share', profileShare)
  router.get('/api/schedules', schedulesList)
  router.post('/api/schedules', scheduleCreate)
  router.patch('/api/schedules/:id', scheduleUpdate)
  router.delete('/api/schedules/:id', scheduleDelete)
  router.post('/api/brew/start', brewStart)
  router.use('/api/**', notFound)
  app.use(router)
  const handler = toWebHandler(app)

  async function fetch(path: string, init: RequestInit = {}, { sameOrigin = true, noHost = false }: { sameOrigin?: boolean, noHost?: boolean } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (sameOrigin && !headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin')
    const url = path.startsWith('http') ? path : `http://localhost:3000${path}`
    // A real client always sends Host; the in-process Request does not, so derive it from the URL.
    if (!noHost && !headers.has('host')) headers.set('host', new URL(url).host)
    return handler(new Request(url, { ...init, headers }))
  }

  async function json(method: string, path: string, body?: unknown): Promise<JsonResult> {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers }
  }

  return { fetch, json }
}
