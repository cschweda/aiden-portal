import { describe, expect, it, vi } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { server } from '../../setup/msw'
import { FELLOW_BASE_URL, FELLOW_USER_AGENT, FellowHttp, type FellowHttpOptions } from '../../../server/lib/fellow/http'
import { BASE, DEVICE } from '../../helpers/fellow-fixtures'

const EMAIL = 'coffee@example.com'
const PASSWORD = 'hunter2'

function makeHttp(overrides: Partial<FellowHttpOptions> = {}): FellowHttp {
  return new FellowHttp({ email: EMAIL, password: PASSWORD, sleep: async () => {}, random: () => 0, ...overrides })
}

const loginUrl = `${BASE}/auth/login`
const refreshUrl = `${BASE}/auth/refresh-token`
const devicesUrl = `${BASE}/devices`

describe('constants', () => {
  it('uses the reference base URL and user agent', () => {
    expect(FELLOW_BASE_URL).toBe('https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v2')
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
    expect(loginBody).toEqual({ email: EMAIL, password: PASSWORD, timezone: expect.any(String) })
    expect(loginUserAgent).toBe(FELLOW_USER_AGENT)
    expect(seen).toEqual([{ auth: 'Bearer token-1', ua: FELLOW_USER_AGENT }])

    await client.request('GET', '/devices?dataType=real')
    expect(logins).toBe(1)
  })

  it('sends the configured IANA timezone with the login', async () => {
    let loginBody: unknown
    server.use(
      http.post(loginUrl, async ({ request }) => {
        loginBody = await request.json()
        return HttpResponse.json({ accessToken: 'token-1', refreshToken: 'refresh-1' })
      }),
      http.get(devicesUrl, () => HttpResponse.json([DEVICE])),
    )
    await makeHttp({ timezone: 'America/Chicago' }).request('GET', '/devices?dataType=real')
    expect(loginBody).toEqual({ email: EMAIL, password: PASSWORD, timezone: 'America/Chicago' })
  })

  it.each([400, 401, 403])('reports a %s on login as fellow_auth_failed', async (status) => {
    server.use(http.post(loginUrl, () => HttpResponse.json({ message: 'Incorrect username or password.' }, { status })))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({
      name: 'FellowError',
      code: 'fellow_auth_failed',
      status,
    })
  })

  it('reports a persistent 5xx on login as fellow_http_error, not as bad credentials, after three attempts', async () => {
    let logins = 0
    server.use(http.post(loginUrl, () => {
      logins++
      return new HttpResponse(null, { status: 503 })
    }))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_http_error', status: 503 })
    expect(logins).toBe(3)
  })

  it('retries the login itself on a transient 5xx, since a login is safe to repeat', async () => {
    let logins = 0
    server.use(
      http.post(loginUrl, () => {
        logins++
        return logins < 2 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ accessToken: 't' })
      }),
      http.get(devicesUrl, () => HttpResponse.json([DEVICE])),
    )
    const sleep = vi.fn(async (_ms: number) => {})
    expect(await makeHttp({ sleep }).request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(logins).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
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
  /** Login issues token-N and refresh-N; refresh issues the next pair. Both count. */
  function authHandlers(counts: { logins: number, refreshes: number }, opts: { refreshStatus?: number, refreshBody?: unknown } = {}) {
    let issued = 0
    return [
      http.post(loginUrl, () => {
        counts.logins++
        issued++
        return HttpResponse.json({ accessToken: `token-${issued}`, refreshToken: `refresh-${issued}` })
      }),
      http.post(refreshUrl, async ({ request }) => {
        counts.refreshes++
        const body = await request.json()
        if (opts.refreshStatus) return new HttpResponse(null, { status: opts.refreshStatus })
        if (opts.refreshBody !== undefined) return HttpResponse.json(opts.refreshBody)
        expect(body).toEqual({ refreshToken: `refresh-${issued}` })
        expect(request.headers.get('authorization')).toBeNull()
        issued++
        return HttpResponse.json({ accessToken: `token-${issued}`, refreshToken: `refresh-${issued}` })
      }),
    ]
  }
  const acceptOnly = (token: string) => ({ request }: { request: Request }) =>
    request.headers.get('authorization') === `Bearer ${token}` ? HttpResponse.json([DEVICE]) : new HttpResponse(null, { status: 401 })

  it('refreshes the access token on 401 and retries the request', async () => {
    const counts = { logins: 0, refreshes: 0 }
    server.use(...authHandlers(counts), http.get(devicesUrl, acceptOnly('token-2')))
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(counts).toEqual({ logins: 1, refreshes: 1 })
  })

  it('falls back to a password login when the refresh call fails', async () => {
    const counts = { logins: 0, refreshes: 0 }
    server.use(...authHandlers(counts, { refreshStatus: 500 }), http.get(devicesUrl, acceptOnly('token-2')))
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(counts).toEqual({ logins: 2, refreshes: 1 })
  })

  it('falls back to a password login when the refresh response has no access token', async () => {
    const counts = { logins: 0, refreshes: 0 }
    server.use(...authHandlers(counts, { refreshBody: { ok: true } }), http.get(devicesUrl, acceptOnly('token-2')))
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(counts).toEqual({ logins: 2, refreshes: 1 })
  })

  it('falls back to a password login when the refreshed token is still rejected', async () => {
    const counts = { logins: 0, refreshes: 0 }
    let gets = 0
    server.use(...authHandlers(counts), http.get(devicesUrl, (info) => {
      gets++
      return acceptOnly('token-3')(info)
    }))
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(counts).toEqual({ logins: 2, refreshes: 1 })
    expect(gets).toBe(3)
  })

  it('gives up with fellow_auth_failed when refresh and re-login both leave the server unconvinced', async () => {
    const counts = { logins: 0, refreshes: 0 }
    let gets = 0
    server.use(...authHandlers(counts), http.get(devicesUrl, () => {
      gets++
      return new HttpResponse(null, { status: 401 })
    }))
    await expect(makeHttp().request('GET', '/devices?dataType=real')).rejects.toMatchObject({ code: 'fellow_auth_failed', status: 401 })
    expect(counts).toEqual({ logins: 2, refreshes: 1 })
    expect(gets).toBe(3)
  })

  it('goes straight to a password login when no refresh token was issued', async () => {
    let logins = 0
    server.use(
      http.post(loginUrl, () => {
        logins++
        return HttpResponse.json({ accessToken: `token-${logins}` })
      }),
      // No refresh handler: a refresh attempt would be an unhandled request and fail the test.
      http.get(devicesUrl, acceptOnly('token-2')),
    )
    expect(await makeHttp().request('GET', '/devices?dataType=real')).toEqual([DEVICE])
    expect(logins).toBe(2)
  })

  it('shares one re-authentication between requests that hit 401 at the same time', async () => {
    const counts = { logins: 0, refreshes: 0 }
    let validToken = 'token-1'
    const acceptOnlyValidToken = ({ request }: { request: Request }) =>
      request.headers.get('authorization') === `Bearer ${validToken}`
        ? HttpResponse.json([])
        : new HttpResponse(null, { status: 401 })
    server.use(
      ...authHandlers(counts),
      http.get(devicesUrl, acceptOnlyValidToken),
      http.get(`${BASE}/devices/dev-123/profiles`, acceptOnlyValidToken),
      http.get(`${BASE}/devices/dev-123/schedules`, acceptOnlyValidToken),
    )
    const client = makeHttp()
    await client.request('GET', '/devices?dataType=real')
    expect(counts).toEqual({ logins: 1, refreshes: 0 })

    validToken = 'token-2'
    await Promise.all([
      client.request('GET', '/devices?dataType=real'),
      client.request('GET', '/devices/dev-123/profiles'),
      client.request('GET', '/devices/dev-123/schedules'),
    ])
    expect(counts).toEqual({ logins: 1, refreshes: 1 })
  })

  it('does not reject a request whose second 401 lands after another request already logged in again', async () => {
    // Both requests share a refresh that yields token-2, which the server rejects. The devices request
    // then logs in (token-3). The profiles request's 401 for token-2 is delayed until after that login
    // has finished; it must reuse token-3 rather than give up.
    const counts = { logins: 0, refreshes: 0 }
    const isToken3 = (request: Request) => request.headers.get('authorization') === 'Bearer token-3'
    server.use(
      ...authHandlers(counts),
      http.get(devicesUrl, ({ request }) => isToken3(request) ? HttpResponse.json([DEVICE]) : new HttpResponse(null, { status: 401 })),
      http.get(`${BASE}/devices/dev-123/profiles`, async ({ request }) => {
        if (isToken3(request)) return HttpResponse.json([])
        // Only the refreshed token's rejection is slow, so this request still holds token-2 after the
        // devices request has already replaced it with token-3.
        if (request.headers.get('authorization') === 'Bearer token-2') await delay(40)
        return new HttpResponse(null, { status: 401 })
      }),
    )
    const client = makeHttp()
    const [devices, profiles] = await Promise.all([
      client.request('GET', '/devices?dataType=real'),
      client.request('GET', '/devices/dev-123/profiles'),
    ])
    expect(devices).toEqual([DEVICE])
    expect(profiles).toEqual([])
    expect(counts).toEqual({ logins: 2, refreshes: 1 })
  })

  it('refreshAccessToken rejects before any login and resolves with the new token after one', async () => {
    const counts = { logins: 0, refreshes: 0 }
    server.use(...authHandlers(counts), http.get(devicesUrl, () => HttpResponse.json([DEVICE])))
    const client = makeHttp()
    await expect(client.refreshAccessToken()).rejects.toMatchObject({ code: 'fellow_auth_failed' })
    await client.request('GET', '/devices?dataType=real')
    expect(await client.refreshAccessToken()).toBe('token-2')
    expect(counts).toEqual({ logins: 1, refreshes: 1 })
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
