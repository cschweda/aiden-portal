import { describe, expect, it, vi } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { ZodError } from 'zod'
import { server } from '../../setup/msw'
import {
  BASE,
  DEVICE,
  DEVICE_DETAIL,
  PROFILE_INPUT,
  PROFILE_P7,
  SCHEDULE_INPUT,
  SCHEDULE_S0,
  happyHandlers,
  makeClient,
  newCalls,
} from '../../helpers/fellow-fixtures'

const loggedIn = () => http.post(`${BASE}/auth/login`, () => HttpResponse.json({ accessToken: 't' }))
const profilesUrl = `${BASE}/devices/${DEVICE.id}/profiles`
const schedulesUrl = `${BASE}/devices/${DEVICE.id}/schedules`

describe('FellowClient reads', () => {
  it('returns the first device and remembers its id for later paths', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient()
    expect(await client.getDevice()).toEqual(DEVICE)
    const profiles = await client.getProfiles()
    expect(profiles.map(p => p.id)).toEqual(['p7', 'p8'])
    expect(profiles[0]?.title).toBe('Debug-FellowAiden')
    expect(calls).toEqual({ login: 1, devices: 1, deviceDetail: 0, profiles: 1, schedules: 0 })
  })

  it('fetches the device once to learn the id, even when schedules are asked for first', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient()
    expect((await client.getSchedules()).map(s => s.id)).toEqual(['s0'])
    expect(calls.devices).toBe(1)
  })

  it('rejects an empty device list as fellow_bad_response', async () => {
    server.use(
      loggedIn(),
      http.get(`${BASE}/devices`, () => HttpResponse.json([])),
    )
    await expect(makeClient().getDevice()).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('serves repeat reads from the cache within 30 seconds', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    let now = 100_000
    const client = makeClient({ now: () => now })
    await client.getProfiles()
    await client.getProfiles()
    now += 29_000
    await client.getProfiles()
    expect(calls.profiles).toBe(1)
    now += 2_000
    await client.getProfiles()
    expect(calls.profiles).toBe(2)
  })

  it('bypasses the cache when fresh is set, using the lighter detail route once the id is known', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient()
    await client.getDevice()
    const refreshed = await client.getDevice({ fresh: true })
    expect(calls.devices).toBe(1)
    expect(calls.deviceDetail).toBe(1)
    // Live state from the detail route, inventory (serial, MAC, sku) kept from the list route.
    expect(refreshed).toEqual({ ...DEVICE, ...DEVICE_DETAIL })
    expect(refreshed.lidClosed).toBe(true)
    expect(refreshed.serialNumber).toBe('SN-0001')
  })

  it('refreshes the device through the detail route after the cache expires', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    let now = 0
    const client = makeClient({ now: () => now })
    await client.getDevice()
    now += 31_000
    await client.getDevice()
    expect(calls).toMatchObject({ devices: 1, deviceDetail: 1 })
  })

  it('collapses concurrent identical reads into one request', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient()
    await Promise.all([client.getProfiles(), client.getProfiles(), client.getProfiles()])
    expect(calls.profiles).toBe(1)
    expect(calls.devices).toBe(1)
  })

  it('exposes dryRun as false by default', () => {
    expect(makeClient().dryRun).toBe(false)
  })

  it('does not write a read that was in flight during a mutation back into the cache', async () => {
    const calls = newCalls()
    server.use(
      http.get(profilesUrl, async () => {
        calls.profiles++
        await delay(30)
        return HttpResponse.json([PROFILE_P7])
      }),
      http.post(profilesUrl, () => HttpResponse.json({ ...PROFILE_INPUT, id: 'p9' })),
      ...happyHandlers(calls),
    )
    const client = makeClient()
    await client.getDevice()
    const inFlight = client.getProfiles()
    await client.createProfile(PROFILE_INPUT)
    expect((await inFlight).map(p => p.id)).toEqual(['p7'])
    await client.getProfiles()
    expect(calls.profiles).toBe(2)
  })

  it('reports a malformed list response as fellow_bad_response rather than a validation error', async () => {
    server.use(
      http.get(profilesUrl, () => HttpResponse.json({ nope: true })),
      http.get(schedulesUrl, () => HttpResponse.json([{ noId: true }])),
      ...happyHandlers(newCalls()),
    )
    const client = makeClient()
    await expect(client.getProfiles()).rejects.toMatchObject({ code: 'fellow_bad_response' })
    await expect(client.getSchedules()).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('accepts a device detail without an id, keeps inventory fields, and drops a mistyped duplicate', async () => {
    const calls = newCalls()
    const { id: _omitted, ...detailWithoutId } = DEVICE_DETAIL
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => {
        calls.deviceDetail++
        return HttpResponse.json({ ...detailWithoutId, displayName: 42 })
      }),
      ...happyHandlers(calls),
    )
    const client = makeClient()
    await client.getDevice()
    const refreshed = await client.getDevice({ fresh: true })
    expect(refreshed.id).toBe('dev-123')
    expect(refreshed.displayName).toBe('Kitchen Aiden')
    expect(refreshed.serialNumber).toBe('SN-0001')
    expect(refreshed.lidClosed).toBe(true)
    expect(calls.deviceDetail).toBe(1)
  })

  it('rejects a device detail that names a different brewer', async () => {
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => HttpResponse.json({ ...DEVICE_DETAIL, id: 'dev-999' })),
      ...happyHandlers(newCalls()),
    )
    const client = makeClient()
    await client.getDevice()
    await expect(client.getDevice({ fresh: true })).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('rediscovers the brewer when the detail route says it is gone', async () => {
    const calls = newCalls()
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => new HttpResponse(null, { status: 404 })),
      ...happyHandlers(calls),
    )
    const client = makeClient()
    await client.getDevice()
    expect(await client.getDevice({ fresh: true })).toEqual(DEVICE)
    expect(calls.devices).toBe(2)
  })
})

describe('FellowClient id validation', () => {
  it.each([
    ['deleteProfile', (c: ReturnType<typeof makeClient>) => c.deleteProfile('../start?confirm=true')],
    ['updateProfile', (c: ReturnType<typeof makeClient>) => c.updateProfile('..', PROFILE_INPUT)],
    ['generateShareLink', (c: ReturnType<typeof makeClient>) => c.generateShareLink('p7 ')],
    ['deleteSchedule', (c: ReturnType<typeof makeClient>) => c.deleteSchedule('s0/../x')],
    ['updateSchedule', (c: ReturnType<typeof makeClient>) => c.updateSchedule('s0?x=1', { enabled: true })],
  ])('%s rejects a malformed id before building a path', async (_name, call) => {
    // Only read handlers exist: a request with a traversed path would be unhandled and fail the test differently.
    server.use(...happyHandlers(newCalls()))
    await expect(call(makeClient())).rejects.toBeInstanceOf(ZodError)
  })
})

describe('FellowClient profile mutations', () => {
  it('creates a profile: strips server fields, posts the input, returns the parsed response, invalidates the cache', async () => {
    const calls = newCalls()
    let posted: unknown
    server.use(
      ...happyHandlers(calls),
      http.post(profilesUrl, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ ...PROFILE_INPUT, id: 'p9', createdAt: 'now' })
      }),
    )
    const client = makeClient()
    await client.getProfiles()
    const created = await client.createProfile(PROFILE_P7)
    expect(posted).toEqual(PROFILE_INPUT)
    expect(created.id).toBe('p9')
    await client.getProfiles()
    expect(calls.profiles).toBe(2)
  })

  it('rejects an invalid profile before sending anything', async () => {
    server.use(loggedIn(), http.get(`${BASE}/devices`, () => HttpResponse.json([DEVICE])))
    await expect(makeClient().createProfile({ ...PROFILE_INPUT, ratio: 12 })).rejects.toThrow(/ratio/)
  })

  it('treats a create response without an id as fellow_bad_response', async () => {
    server.use(...happyHandlers(newCalls()), http.post(profilesUrl, () => HttpResponse.json({ message: 'weird' })))
    await expect(makeClient().createProfile(PROFILE_INPUT)).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('updates a profile with PATCH and a stripped body', async () => {
    let patched: unknown
    server.use(
      ...happyHandlers(newCalls()),
      http.patch(`${profilesUrl}/p7`, async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    await expect(makeClient().updateProfile('p7', { ...PROFILE_P7, title: 'Renamed' })).resolves.toBeUndefined()
    expect(patched).toEqual({ ...PROFILE_INPUT, title: 'Renamed' })
  })

  it('deletes a profile', async () => {
    let deleted = false
    server.use(...happyHandlers(newCalls()), http.delete(`${profilesUrl}/p7`, () => {
      deleted = true
      return new HttpResponse(null, { status: 204 })
    }))
    await makeClient().deleteProfile('p7')
    expect(deleted).toBe(true)
  })

  it('generates a share link', async () => {
    server.use(...happyHandlers(newCalls()), http.post(`${profilesUrl}/p7/share`, () => HttpResponse.json({ link: 'https://brew.link/p/ws98' })))
    expect(await makeClient().generateShareLink('p7')).toBe('https://brew.link/p/ws98')
  })

  it('reports a share response without a link', async () => {
    server.use(...happyHandlers(newCalls()), http.post(`${profilesUrl}/p7/share`, () => HttpResponse.json({})))
    await expect(makeClient().generateShareLink('p7')).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('fetches a shared profile by link or id, under its drop type, and strips server fields', async () => {
    server.use(
      loggedIn(),
      http.get(`${BASE}/shared/aiden/ws98`, () => HttpResponse.json({ ...PROFILE_P7, sharedFrom: 'someone' })),
      http.get(`${BASE}/shared/other/ws98`, () => HttpResponse.json({ ...PROFILE_P7, title: 'Other Drop' })),
    )
    const client = makeClient()
    expect(await client.fetchSharedProfile('https://brew.link/p/ws98')).toEqual(PROFILE_INPUT)
    expect(await client.fetchSharedProfile('ws98')).toEqual(PROFILE_INPUT)
    expect((await client.fetchSharedProfile('https://brew.link/p/ws98/other')).title).toBe('Other Drop')
  })

  it('creates a profile from a brew link', async () => {
    let posted: unknown
    server.use(
      ...happyHandlers(newCalls()),
      http.get(`${BASE}/shared/aiden/ws98`, () => HttpResponse.json(PROFILE_P7)),
      http.post(profilesUrl, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ ...PROFILE_INPUT, id: 'p10' })
      }),
    )
    expect((await makeClient().createProfileFromLink('https://brew.link/p/ws98')).id).toBe('p10')
    expect(posted).toEqual(PROFILE_INPUT)
  })

  it('finds profiles by title, exactly or fuzzily', async () => {
    server.use(...happyHandlers(newCalls()))
    const client = makeClient()
    expect((await client.findProfileByTitle('morning cup'))?.id).toBe('p8')
    expect(await client.findProfileByTitle('FellowAiden')).toBeUndefined()
    expect((await client.findProfileByTitle('FellowAiden', { fuzzy: true }))?.id).toBe('p7')
  })
})

describe('FellowClient schedule mutations', () => {
  it('creates a schedule', async () => {
    let posted: unknown
    server.use(...happyHandlers(newCalls()), http.post(schedulesUrl, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ ...SCHEDULE_INPUT, id: 's1' })
    }))
    expect((await makeClient().createSchedule(SCHEDULE_INPUT)).id).toBe('s1')
    expect(posted).toEqual(SCHEDULE_INPUT)
  })

  it('rejects an invalid schedule before sending', async () => {
    server.use(loggedIn(), http.get(`${BASE}/devices`, () => HttpResponse.json([DEVICE])))
    await expect(makeClient().createSchedule({ ...SCHEDULE_INPUT, profileId: 'x1' })).rejects.toThrow(/profileId/)
  })

  it('patches a schedule and validates the patch', async () => {
    let patched: unknown
    server.use(...happyHandlers(newCalls()), http.patch(`${schedulesUrl}/s0`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ ...SCHEDULE_S0, enabled: false })
    }))
    const client = makeClient()
    await client.updateSchedule('s0', { enabled: false })
    expect(patched).toEqual({ enabled: false })
    await expect(client.updateSchedule('s0', { bogus: 1 })).rejects.toThrow()
  })

  it('deletes a schedule', async () => {
    let deleted = false
    server.use(...happyHandlers(newCalls()), http.delete(`${schedulesUrl}/s0`, () => {
      deleted = true
      return new HttpResponse(null, { status: 204 })
    }))
    await makeClient().deleteSchedule('s0')
    expect(deleted).toBe(true)
  })
})

describe('FellowClient device settings (UNVERIFIED)', () => {
  it('patches the device with a single setting', async () => {
    let patched: unknown
    server.use(...happyHandlers(newCalls()), http.patch(`${BASE}/devices/${DEVICE.id}`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ displayName: 'Bench' })
    }))
    expect(await makeClient().adjustSetting('displayName', 'Bench')).toEqual({ displayName: 'Bench' })
    expect(patched).toEqual({ displayName: 'Bench' })
  })

  it('exposes refreshAccessToken, which fails before any login', async () => {
    await expect(makeClient().refreshAccessToken()).rejects.toMatchObject({ code: 'fellow_auth_failed' })
  })
})

describe('FellowClient remote start', () => {
  it('starts the configured instant brew with an explicit confirm flag and no body', async () => {
    let seen: { confirm: string | null, hasBody: boolean } | undefined
    server.use(...happyHandlers(newCalls()), http.patch(`${BASE}/devices/${DEVICE.id}/start`, async ({ request }) => {
      seen = { confirm: new URL(request.url).searchParams.get('confirm'), hasBody: (await request.text()).length > 0 }
      return HttpResponse.json({ status: 'started' })
    }))
    expect(await makeClient().startBrew()).toEqual({ status: 'started' })
    expect(seen).toEqual({ confirm: 'true', hasBody: false })
  })

  it('reports a non-object start response as fellow_bad_response', async () => {
    server.use(...happyHandlers(newCalls()), http.patch(`${BASE}/devices/${DEVICE.id}/start`, () => new HttpResponse(null, { status: 204 })))
    await expect(makeClient().startBrew()).rejects.toMatchObject({ code: 'fellow_bad_response' })
  })

  it('does not start a brew in dry-run mode', async () => {
    const logger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    server.use(...happyHandlers(newCalls()))
    expect(await makeClient({ dryRun: true, logger }).startBrew()).toEqual({ dryRun: true })
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, method: 'PATCH', path: `/devices/${DEVICE.id}/start?confirm=true` }),
      expect.stringContaining('DRY RUN'),
    )
  })
})

describe('FellowClient dry run', () => {
  const spyLogger = () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

  it('still performs reads', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    expect((await makeClient({ dryRun: true }).getProfiles()).length).toBe(2)
    expect(calls.profiles).toBe(1)
  })

  it('suppresses mutations, logs them at info, and answers with well-shaped fakes', async () => {
    // Only read handlers exist: any mutation reaching msw fails the test via onUnhandledRequest: 'error'.
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const logger = spyLogger()
    const client = makeClient({ dryRun: true, logger, now: () => 1_700_000_000_000 })
    expect(client.dryRun).toBe(true)

    const profile = await client.createProfile(PROFILE_P7)
    expect(profile.id).toMatch(/^p\d+$/)
    expect(profile.title).toBe(PROFILE_INPUT.title)
    expect(logger.info).toHaveBeenCalledWith(
      { dryRun: true, method: 'POST', path: `/devices/${DEVICE.id}/profiles`, body: PROFILE_INPUT },
      expect.stringContaining('DRY RUN'),
    )

    const schedule = await client.createSchedule(SCHEDULE_INPUT)
    expect(schedule.id).toMatch(/^s\d+$/)
    expect((await client.createProfile(PROFILE_INPUT)).id).not.toBe(profile.id)

    expect(await client.generateShareLink('p7')).toBe('https://brew.link/p/dryrun')
    await expect(client.updateProfile('p7', PROFILE_INPUT)).resolves.toBeUndefined()
    await expect(client.deleteProfile('p7')).resolves.toBeUndefined()
    await expect(client.updateSchedule('s0', { enabled: false })).resolves.toBeUndefined()
    await expect(client.deleteSchedule('s0')).resolves.toBeUndefined()
    expect(await client.adjustSetting('displayName', 'x')).toEqual({ displayName: 'x' })
    expect(await client.startBrew()).toEqual({ dryRun: true })
    // Ten mutations above; the login line is also logged at info, so count only dry-run entries.
    expect(logger.info.mock.calls.filter(call => (call[0] as { dryRun?: boolean }).dryRun === true)).toHaveLength(10)
  })

  it('still validates input and still invalidates the cache', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    const client = makeClient({ dryRun: true })
    await expect(client.createProfile({ ...PROFILE_INPUT, title: '' })).rejects.toThrow(/title/)
    await client.getProfiles()
    await client.createProfile(PROFILE_INPUT)
    await client.getProfiles()
    expect(calls.profiles).toBe(2)
  })
})
