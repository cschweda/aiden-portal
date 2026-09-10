import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw'
import { FELLOW_BASE_URL, FELLOW_USER_AGENT, FellowHttp, type FellowHttpOptions } from '../../../server/utils/fellow/http'
import { BASE, DEVICE } from '../../helpers/fellow-fixtures'

const EMAIL = 'coffee@example.com'
const PASSWORD = 'hunter2'

function makeHttp(overrides: Partial<FellowHttpOptions> = {}): FellowHttp {
  return new FellowHttp({ email: EMAIL, password: PASSWORD, sleep: async () => {}, random: () => 0, ...overrides })
}

const loginUrl = `${BASE}/auth/login`
const devicesUrl = `${BASE}/devices`

describe('constants', () => {
  it('uses the reference base URL and user agent', () => {
    expect(FELLOW_BASE_URL).toBe('https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1')
    expect(FELLOW_USER_AGENT).toBe('Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0')
  })
})

describe('login', () => {
  it('does not log in at construction', () => {
    // No handlers are registered, so any request would fail the test via onUnhandledRequest: 'error'.
    const client = makeHttp()
    expect(client.isAuthenticated).toBe(false)
  })

  it('logs in lazily, then sends the bearer token and user agent on every request', async () => {
    let logins = 0
    let loginBody: unknown
    let loginUserAgent: string | null = null
    const seen: Array<{ auth: string | null, ua: string | null }> = []
    server.use(
      http.post(loginUrl, async ({ request }) => {
        logins++
        loginBody = await request.json()
        loginUserAgent = request.headers.get('user-agent')
        return HttpResponse.json({ accessToken: 'token-1', refreshToken: 'refresh-1' })
      }),
      http.get(devicesUrl, ({ request }) => {
        seen.push({ auth: request.headers.get('authorization'), ua: request.headers.get('user-agent') })
        return HttpResponse.json([DEVICE])
      }),
    )
    const client = makeHttp()
    expect(await client.request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(client.isAuthenticated).toBe(true)
    expect(loginBody).toEqual({ email: EMAIL, password: PASSWORD })
    expect(loginUserAgent).toBe(FELLOW_USER_AGENT)
    expect(seen).toEqual([{ auth: 'Bearer token-1', ua: FELLOW_USER_AGENT }])

    await client.request('GET', '/devices?dataType=real')
    expect(logins).toBe(1)
  })

  it('reports bad credentials as fellow_auth_failed', async () => {
    server.use(http.post(loginUrl, () => HttpResponse.json({ message: 'Incorrect username or password.' }, { status: 401 })))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({
      name: 'FellowError',
      code: 'fellow_auth_failed',
      status: 401,
    })
  })

  it('treats a login response without accessToken as a failure', async () => {
    server.use(http.post(loginUrl, () => HttpResponse.json({ ok: true })))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_auth_failed' })
  })

  it('shares one in-flight login between concurrent first requests', async () => {
    let logins = 0
    server.use(
      http.post(loginUrl, () => {
        logins++
        return HttpResponse.json({ accessToken: 'token-1' })
      }),
      http.get(devicesUrl, () => HttpResponse.json([DEVICE])),
    )
    const client = makeHttp()
    await Promise.all([1, 2, 3].map(() => client.request('GET', '/devices?dataType=real')))
    expect(logins).toBe(1)
  })
})

describe('401 handling', () => {
  it('re-logs in once and retries the request', async () => {
    let logins = 0
    server.use(
      http.post(loginUrl, () => {
        logins++
        return HttpResponse.json({ accessToken: `token-${logins}` })
      }),
      http.get(devicesUrl, ({ request }) =>
        request.headers.get('authorization') === 'Bearer token-2'
          ? HttpResponse.json([DEVICE])
          : new HttpResponse(null, { status: 401 }),
      ),
    )
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(logins).toBe(2)
  })

  it('gives up with fellow_auth_failed after a second 401 and makes no further attempts', async () => {
    let logins = 0
    let gets = 0
    server.use(
      http.post(loginUrl, () => {
        logins++
        return HttpResponse.json({ accessToken: `token-${logins}` })
      }),
      http.get(devicesUrl, () => {
        gets++
        return new HttpResponse(null, { status: 401 })
      }),
    )
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_auth_failed', status: 401 })
    expect(logins).toBe(2)
    expect(gets).toBe(2)
  })

  it('logs in once when several requests hit 401 at the same time', async () => {
    let logins = 0
    let validToken = ''
    const acceptOnlyValidToken = ({ request }: { request: Request }) =>
      request.headers.get('authorization') === `Bearer ${validToken}`
        ? HttpResponse.json([])
        : new HttpResponse(null, { status: 401 })
    server.use(
      http.post(loginUrl, () => {
        logins++
        validToken = `token-${logins}`
        return HttpResponse.json({ accessToken: validToken })
      }),
      http.get(devicesUrl, acceptOnlyValidToken),
      http.get(`${BASE}/devices/dev-123/profiles`, acceptOnlyValidToken),
      http.get(`${BASE}/devices/dev-123/schedules`, acceptOnlyValidToken),
    )
    const client = makeHttp()
    await client.request('GET', '/devices?dataType=real')
    expect(logins).toBe(1)

    validToken = 'token-expired-server-side'
    await Promise.all([
      client.request('GET', '/devices?dataType=real'),
      client.request('GET', '/devices/dev-123/profiles'),
      client.request('GET', '/devices/dev-123/schedules'),
    ])
    expect(logins).toBe(2)
  })
})

describe('response handling', () => {
  it('returns undefined for an empty body', async () => {
    server.use(
      http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' })),
      http.delete(`${BASE}/devices/dev-123/profiles/p7`, () => new HttpResponse(null, { status: 204 })),
    )
    expect(await makeHttp().request('DELETE', '/devices/dev-123/profiles/p7')).toBeUndefined()
  })

  it('returns raw text when the body is not JSON', async () => {
    server.use(
      http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' })),
      http.get(devicesUrl, () => new HttpResponse('plain text', { status: 200 })),
    )
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toBe('plain text')
  })

  it('serialises JSON bodies with a content type', async () => {
    let contentType: string | null = null
    let body: unknown
    server.use(
      http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' })),
      http.post(`${BASE}/devices/dev-123/profiles`, async ({ request }) => {
        contentType = request.headers.get('content-type')
        body = await request.json()
        return HttpResponse.json({ id: 'p9' })
      }),
    )
    expect(await makeHttp().request('POST', '/devices/dev-123/profiles', { title: 'x' })).toEqual({ id: 'p9' })
    expect(contentType).toBe('application/json')
    expect(body).toEqual({ title: 'x' })
  })

  it('raises fellow_http_error with status and body for a 4xx', async () => {
    server.use(
      http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' })),
      http.get(devicesUrl, () => HttpResponse.json({ message: 'nope' }, { status: 404 })),
    )
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({
      code: 'fellow_http_error',
      status: 404,
      body: { message: 'nope' },
    })
  })

  it('refreshAccessToken is an explicit not-implemented extension point', async () => {
    await expect(makeHttp().refreshAccessToken()).rejects.toMatchObject({ code: 'fellow_not_implemented' })
  })
})

describe('retries', () => {
  const loggedIn = () => http.post(loginUrl, () => HttpResponse.json({ accessToken: 't' }))

  it('retries a GET on 503 with exponential backoff and succeeds', async () => {
    let gets = 0
    server.use(
      loggedIn(),
      http.get(devicesUrl, () => {
        gets++
        return gets < 3 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json([DEVICE])
      }),
    )
    const sleep = vi.fn(async (_ms: number) => {})
    expect(await makeHttp({ sleep }).request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(gets).toBe(3)
    expect(sleep.mock.calls.map(call => call[0])).toEqual([250, 500])
  })

  it('adds jitter from the injected random source', async () => {
    let gets = 0
    server.use(
      loggedIn(),
      http.get(devicesUrl, () => {
        gets++
        return gets < 2 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json([DEVICE])
      }),
    )
    const sleep = vi.fn(async (_ms: number) => {})
    await makeHttp({ sleep, random: () => 0.5 }).request('GET', '/devices?dataType=real')
    expect(sleep.mock.calls.map(call => call[0])).toEqual([300])
  })

  it('gives up after three attempts and reports the last status', async () => {
    let gets = 0
    server.use(loggedIn(), http.get(devicesUrl, () => {
      gets++
      return new HttpResponse(null, { status: 503 })
    }))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_http_error', status: 503 })
    expect(gets).toBe(3)
  })

  it('retries 408 but not 404', async () => {
    let timeouts = 0
    let notFounds = 0
    server.use(
      loggedIn(),
      http.get(`${BASE}/timeout`, () => {
        timeouts++
        return new HttpResponse(null, { status: 408 })
      }),
      http.get(`${BASE}/missing`, () => {
        notFounds++
        return new HttpResponse(null, { status: 404 })
      }),
    )
    const client = makeHttp()
    await expect(client.request('GET', '/timeout')).rejects.toMatchObject({ status: 408 })
    await expect(client.request('GET', '/missing')).rejects.toMatchObject({ status: 404 })
    expect(timeouts).toBe(3)
    expect(notFounds).toBe(1)
  })

  it('retries DELETE', async () => {
    let deletes = 0
    server.use(loggedIn(), http.delete(`${BASE}/devices/dev-123/profiles/p7`, () => {
      deletes++
      return deletes < 2 ? new HttpResponse(null, { status: 502 }) : new HttpResponse(null, { status: 204 })
    }))
    await makeHttp().request('DELETE', '/devices/dev-123/profiles/p7')
    expect(deletes).toBe(2)
  })

  it('never retries POST or PATCH, even on 503', async () => {
    let posts = 0
    let patches = 0
    server.use(
      loggedIn(),
      http.post(`${BASE}/devices/dev-123/profiles`, () => {
        posts++
        return new HttpResponse(null, { status: 503 })
      }),
      http.patch(`${BASE}/devices/dev-123/profiles/p7`, () => {
        patches++
        return new HttpResponse(null, { status: 503 })
      }),
    )
    const sleep = vi.fn(async (_ms: number) => {})
    const client = makeHttp({ sleep })
    await expect(client.request('POST', '/devices/dev-123/profiles', {})).rejects.toMatchObject({ status: 503 })
    await expect(client.request('PATCH', '/devices/dev-123/profiles/p7', {})).rejects.toMatchObject({ status: 503 })
    expect(posts).toBe(1)
    expect(patches).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a GET after a network error but not a POST', async () => {
    let gets = 0
    let posts = 0
    server.use(
      loggedIn(),
      http.get(devicesUrl, () => {
        gets++
        return gets < 2 ? HttpResponse.error() : HttpResponse.json([DEVICE])
      }),
      http.post(`${BASE}/devices/dev-123/profiles`, () => {
        posts++
        return HttpResponse.error()
      }),
    )
    const client = makeHttp()
    expect(await client.request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    await expect(client.request('POST', '/devices/dev-123/profiles', {})).rejects.toMatchObject({ code: 'fellow_network_error' })
    expect(gets).toBe(2)
    expect(posts).toBe(1)
  })

  it('does not retry an auth failure', async () => {
    let logins = 0
    server.use(http.post(loginUrl, () => {
      logins++
      return HttpResponse.json({ message: 'no' }, { status: 401 })
    }))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_auth_failed' })
    expect(logins).toBe(1)
  })
})
