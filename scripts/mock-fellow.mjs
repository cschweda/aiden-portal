#!/usr/bin/env node
/**
 * A stand-in for Fellow's cloud API so the app can be developed, demonstrated, and screenshotted without
 * real credentials or a real brewer. Everything lives in memory and resets on restart.
 *
 *   pnpm mock:fellow              # listens on http://127.0.0.1:3900
 *   pnpm mock:fellow -- --flaky   # every third GET answers 503, to watch the retry logic
 *
 * Then put `FELLOW_BASE_URL=http://127.0.0.1:3900/v2` and any FELLOW_EMAIL / FELLOW_PASSWORD in .env.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 3900)
const FLAKY = process.argv.includes('--flaky')
const DEVICE_ID = 'mock-aiden-001'

const recipe = (overrides) => ({
  profileType: 0,
  ratio: 16,
  overallTemperature: 94,
  bloomEnabled: true,
  bloomRatio: 2,
  bloomDuration: 30,
  bloomTemperature: 94,
  ssPulsesEnabled: true,
  ssPulsesNumber: 3,
  ssPulsesInterval: 23,
  ssPulseTemperatures: [94, 95, 96],
  batchPulsesEnabled: true,
  batchPulsesNumber: 2,
  batchPulsesInterval: 30,
  batchPulseTemperatures: [94, 95],
  ...overrides,
})

const serverFields = (id, extra = {}) => ({
  id,
  createdAt: '2026-08-01T07:00:00.000Z',
  deletedAt: null,
  lastUsedTime: null,
  sharedFrom: null,
  isDefaultProfile: false,
  instantBrew: false,
  folder: null,
  duration: 240,
  lastGBQuantity: 30,
  ...extra,
})

const state = {
  accessToken: null,
  refreshToken: null,
  issued: 0,
  nextProfile: 4,
  nextSchedule: 3,
  gets: 0,
  brewingUntil: 0,
  brewStartedAt: 0,
  inventory: {
    id: DEVICE_ID,
    displayName: 'Kitchen Aiden',
    serialNumber: 'AID-2026-000123',
    sku: 'AIDEN-1',
    firmwareVersion: '1.5.16',
    wifiMacAddress: '"aa:bb:cc:dd:ee:01"', // Fellow really does wrap it in quotes
    btMacAddress: 'aa:bb:cc:dd:ee:02',
  },
  live: {
    isConnected: true,
    lidClosed: true,
    carafePresent: true,
    missingWater: false,
    singleBrewBasketPresent: false,
    batchBrewBasketPresent: true,
    rinsing: false,
    cleaning: false,
    ibSelectedProfileId: 'p1',
    brewingProfileId: null,
    brewStartTime: null,
    totalBrewingCycles: 142,
    totalWaterVolumeL: 118400, // millilitres despite the name, as on the real API
    heaterOn: false,
    pumpOn: false,
    showerHeadPresent: true,
    brewingWaterTemperatureC: null,
    brewingWaterVolumeMl: 950,
    brewEndTime: String(Math.floor(Date.now() / 1000) - 3 * 3600),
    connectionTimestamp: String(Date.now() - 26 * 3600 * 1000),
    firmwareUpgradeRequired: false,
    unsynced: [],
    ibWaterQuantity: 500,
    elevation: 180,
    chimeVolume: 7,
    metricUnit: true,
    preciseUnit: false,
    displayClock: true,
    displayClock24hrMode: true,
    isAdvanceMode: false,
    languageCode: 'en-us',
    deviceTimezone: 'America/New_York',
    enabledFlags: ['base', 'profiles', 'notifications', 'schedules', 'remoteBrewing'],
  },
  profiles: [
    { ...recipe({ title: 'Morning Batch', ratio: 16.5, overallTemperature: 93 }), ...serverFields('p1', { isDefaultProfile: true, instantBrew: true, lastUsedTime: 1_757_400_000_000 }) },
    { ...recipe({ title: 'Single Origin Pour', ratio: 15, overallTemperature: 96, bloomRatio: 3, bloomDuration: 45, ssPulsesNumber: 4, ssPulseTemperatures: [96, 96, 95, 94], batchPulsesEnabled: false, batchPulsesNumber: 1, batchPulseTemperatures: [96] }), ...serverFields('p2') },
    { ...recipe({ title: 'Cold Brew Concentrate', ratio: 14, overallTemperature: 50, bloomEnabled: false, bloomRatio: 1, bloomDuration: 1, bloomTemperature: 50, ssPulsesEnabled: false, ssPulsesNumber: 1, ssPulseTemperatures: [50], batchPulsesNumber: 1, batchPulseTemperatures: [50] }), ...serverFields('p3', { duration: 43200 }) },
  ],
  schedules: [
    { id: 's1', days: [false, true, true, true, true, true, false], secondFromStartOfTheDay: 6 * 3600 + 30 * 60, enabled: true, amountOfWater: 950, profileId: 'p1' },
    { id: 's2', days: [true, false, false, false, false, false, true], secondFromStartOfTheDay: 8 * 3600, enabled: false, amountOfWater: 500, profileId: 'p2' },
  ],
  shared: {
    ws98: recipe({ title: 'Shared Guest Recipe', ratio: 17, overallTemperature: 92 }),
  },
}

const brewing = () => Date.now() < state.brewingUntil

function device() {
  return {
    ...state.inventory,
    ...state.live,
    brewing: brewing(),
    state: brewing() ? { phase: 'brew', missing_water: false } : null,
  }
}

function detail() {
  const { id, displayName } = state.inventory
  const active = brewing()
  // A 20-second brew that walks through bloom, two pulses, and drip finish, with the water cooling a little.
  const elapsed = active ? Date.now() - state.brewStartedAt : 0
  const phase = elapsed < 5_000 ? 'b' : elapsed < 10_000 ? 'p1' : elapsed < 15_000 ? 'p2' : 'd'
  const temperature = active ? Math.round((phase === 'b' ? 96 : phase === 'd' ? 90 : 94 - elapsed / 10_000) * 2) / 2 : null
  return {
    id,
    displayName,
    ...state.live,
    brewing: active,
    heaterOn: active && phase !== 'd',
    pumpOn: active,
    brewingWaterTemperatureC: temperature,
    state: active ? { value: phase, missing_water: false } : null,
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => (data += chunk))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      }
      catch {
        resolve(null)
      }
    })
  })
}

function issueTokens() {
  state.issued += 1
  state.accessToken = `token-${state.issued}`
  state.refreshToken = `refresh-${state.issued}`
  return { accessToken: state.accessToken, refreshToken: state.refreshToken }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname.replace(/^\/v2/, '')
  const method = req.method
  console.log(`${new Date().toISOString()} ${method} ${url.pathname}${url.search}`)

  if (method === 'POST' && path === '/auth/login') {
    const body = await readJson(req)
    if (!body?.email || !body?.password) return json(res, 401, { message: 'Incorrect username or password.' })
    return json(res, 200, issueTokens())
  }
  if (method === 'POST' && path === '/auth/refresh-token') {
    const body = await readJson(req)
    if (body?.refreshToken !== state.refreshToken) return json(res, 401, { message: 'Invalid refresh token' })
    return json(res, 200, issueTokens())
  }
  if (req.headers.authorization !== `Bearer ${state.accessToken}`) return json(res, 401, { message: 'Unauthorized' })

  if (method === 'GET') {
    state.gets += 1
    if (FLAKY && state.gets % 3 === 0) return json(res, 503, { message: 'flaky mock' })
  }

  const profileMatch = path.match(new RegExp(`^/devices/${DEVICE_ID}/profiles(?:/([A-Za-z0-9]+))?(/share)?$`))
  const scheduleMatch = path.match(new RegExp(`^/devices/${DEVICE_ID}/schedules(?:/([A-Za-z0-9]+))?$`))
  const sharedMatch = path.match(/^\/shared\/([A-Za-z0-9_-]+)\/([A-Za-z0-9]+)$/)

  if (method === 'GET' && path === '/devices') return json(res, 200, [device()])
  if (method === 'GET' && path === `/devices/${DEVICE_ID}`) return json(res, 200, detail())
  if (method === 'PATCH' && path === `/devices/${DEVICE_ID}/start`) {
    if (url.searchParams.get('confirm') !== 'true') return json(res, 400, { message: 'confirm required' })
    state.brewingUntil = Date.now() + 20_000
    state.brewStartedAt = Date.now()
    state.live.brewingProfileId = state.live.ibSelectedProfileId
    state.live.brewStartTime = String(Math.floor(Date.now() / 1000))
    // The counter and the totals move when the brew completes, as the Home Assistant integration observed.
    setTimeout(() => {
      state.live.totalBrewingCycles += 1
      state.live.totalWaterVolumeL += state.live.ibWaterQuantity
      state.live.brewingWaterVolumeMl = state.live.ibWaterQuantity
      state.live.brewEndTime = String(Math.floor(Date.now() / 1000))
      state.live.brewingProfileId = null
    }, 20_000).unref()
    return json(res, 200, { status: 'started', profileId: state.live.ibSelectedProfileId })
  }
  if (method === 'PATCH' && path === `/devices/${DEVICE_ID}`) {
    Object.assign(state.live, await readJson(req))
    return json(res, 200, detail())
  }

  if (profileMatch) {
    const [, pid, share] = profileMatch
    if (!pid && method === 'GET') return json(res, 200, state.profiles)
    if (!pid && method === 'POST') {
      const body = await readJson(req)
      if (!body?.title) return json(res, 400, { message: 'title required' })
      const created = { ...body, ...serverFields(`p${state.nextProfile++}`) }
      state.profiles.push(created)
      return json(res, 200, created)
    }
    const index = state.profiles.findIndex(p => p.id === pid)
    if (index === -1) return json(res, 404, { message: 'Profile could not be found' })
    if (share && method === 'POST') return json(res, 200, { link: `https://brew.link/p/${pid}` })
    if (method === 'PATCH') {
      state.profiles[index] = { ...state.profiles[index], ...(await readJson(req)), id: pid }
      return json(res, 200, state.profiles[index])
    }
    if (method === 'DELETE') {
      state.profiles.splice(index, 1)
      return json(res, 204)
    }
  }

  if (scheduleMatch) {
    const [, sid] = scheduleMatch
    if (!sid && method === 'GET') return json(res, 200, state.schedules)
    if (!sid && method === 'POST') {
      const body = await readJson(req)
      if (!state.profiles.some(p => p.id === body?.profileId)) return json(res, 400, { message: 'Profile could not be found' })
      const created = { ...body, id: `s${state.nextSchedule++}` }
      state.schedules.push(created)
      return json(res, 200, created)
    }
    const index = state.schedules.findIndex(s => s.id === sid)
    if (index === -1) return json(res, 404, { message: 'Schedule could not be found' })
    if (method === 'PATCH') {
      state.schedules[index] = { ...state.schedules[index], ...(await readJson(req)), id: sid }
      return json(res, 200, state.schedules[index])
    }
    if (method === 'DELETE') {
      state.schedules.splice(index, 1)
      return json(res, 204)
    }
  }

  if (sharedMatch && method === 'GET') {
    const [, , bid] = sharedMatch
    const found = state.shared[bid] ?? state.profiles.find(p => p.id === bid)
    if (!found) return json(res, 404, { message: 'Not found' })
    return json(res, 200, { ...found, ...serverFields(bid, { sharedFrom: 'mock-user' }) })
  }

  return json(res, 404, { message: `No mock route for ${method} ${path}` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock Fellow API listening on http://127.0.0.1:${PORT}/v2${FLAKY ? ' (flaky mode)' : ''}`)
  console.log(`Put FELLOW_BASE_URL=http://127.0.0.1:${PORT}/v2 in .env, with any FELLOW_EMAIL and FELLOW_PASSWORD.`)
})
