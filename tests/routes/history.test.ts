import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useHistory } from '../../server/utils/history'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, DEVICE, DEVICE_DETAIL, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
import { server } from '../setup/msw'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiden-history-route-'))
  useTestEnv({ HISTORY_DIRECTORY: join(dir, 'data') })
  server.use(...happyHandlers(newCalls()))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('GET /api/history', () => {
  it('starts empty, with the poller idle and the tally counting from the brewer\'s totals', async () => {
    const app = createTestApp()
    const { status, body } = await app.json('GET', '/api/history')
    expect(status).toBe(200)
    expect(body.stats.today).toEqual({ brews: 0, waterMl: 0 })
    expect(body.recent).toEqual([])
    expect(body.current).toBeNull()
    expect(body.lastTraced).toBeNull()
    expect(body.polling).toMatchObject({ enabled: true, running: false, idlePollSeconds: 60, brewPollSeconds: 5, failures: 0 })
    expect(body.descale.markedAt).toBeNull()
    expect(body.skippedLines).toBe(0)
    expect(body.cleanings).toEqual({ current: null, recent: [], count: 0, averageDurationS: null, lastEndedAt: null })
  })

  it('reports a cleaning cycle while it runs and after it is logged', async () => {
    const history = useHistory()
    const now = Date.now()
    const base = { ...DEVICE_DETAIL, totalWaterVolumeL: 40_000 }
    history.observe({ ...base, brewing: false, state: null }, now - 2_000_000)
    history.observe({ ...base, cleaning: true, brewing: true, state: null, heaterOn: true, pumpOn: true }, now - 1_900_000)
    const app = createTestApp()
    const running = await app.json('GET', '/api/history')
    expect(running.body.cleanings.current).toMatchObject({ kind: 'clean', startedAt: now - 1_900_000 })
    expect(running.body.current).toBeNull()
    history.observe({ ...base, brewing: false, state: null, totalBrewingCycles: 43, totalWaterVolumeL: 41_500, brewingWaterVolumeMl: 1500 }, now - 100_000)
    const { body } = await app.json('GET', '/api/history')
    expect(body.cleanings.current).toBeNull()
    expect(body.cleanings.count).toBe(1)
    expect(body.cleanings.recent[0]).toMatchObject({ kind: 'clean', durationS: 1800, waterMl: 1500, cyclesDelta: 1, waterDeltaMl: 1500 })
    expect(body.cleanings.lastEndedAt).toBe(now - 100_000)
    expect(body.recent).toEqual([])
  })

  it('lists recorded brews newest first without samples, and serves one brew with its trace', async () => {
    const history = useHistory()
    const now = Date.now()
    const base = { ...DEVICE_DETAIL, totalWaterVolumeL: 40_000 }
    history.observe({ ...base, brewing: false, state: null }, now - 400_000)
    history.observe({ ...base, brewing: true, state: { value: 'b' }, brewingWaterTemperatureC: 94 }, now - 300_000)
    history.observe({ ...base, brewing: true, state: { value: 'p1' }, brewingWaterTemperatureC: 93 }, now - 295_000)
    const app = createTestApp()
    const live = await app.json('GET', '/api/history')
    expect(live.body.current).toMatchObject({ profileId: 'p7', samples: expect.any(Array) })
    expect(live.body.current.expected === null || typeof live.body.current.expected.seconds === 'number').toBe(true)
    history.observe({ ...base, brewing: false, state: null, totalBrewingCycles: 43, brewingWaterVolumeMl: 950 }, now - 100_000)
    const { body } = await app.json('GET', '/api/history')
    expect(body.recent).toHaveLength(1)
    expect(body.recent[0]).toMatchObject({ counted: true, observed: true, waterMl: 950, sampleCount: 2, profileId: 'p7', durationS: 200 })
    expect(body.recent[0].samples).toBeUndefined()
    expect(body.lastTraced.samples).toHaveLength(2)
    expect(body.stats.logged.brews).toBe(1)
    expect(body.stats.averageDurationS).toBe(200)
    const one = await app.json('GET', `/api/history/brews/${body.recent[0].id}`)
    expect(one.status).toBe(200)
    expect(one.body.samples.map((s: { phase: string }) => s.phase)).toEqual(['bloom', 'pulse 1'])
    const missing = await app.json('GET', '/api/history/brews/nope')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'not_found' })
    expect((await app.json('GET', '/api/history/brews/bad%20id')).status).toBe(400)
  })

  it('reads the log back after a restart, with the counter baseline from the last brew', async () => {
    const history = useHistory()
    const base = { ...DEVICE_DETAIL, totalWaterVolumeL: 40_000 }
    history.observe({ ...base, brewing: false, state: null }, 1_000)
    history.observe({ ...base, brewing: true, state: { value: 'b' } }, 2_000)
    history.observe({ ...base, brewing: false, state: null, totalBrewingCycles: 43 }, 3_000)
    useTestEnv({ HISTORY_DIRECTORY: join(dir, 'data') })
    const again = useHistory()
    expect(again.store.brews).toHaveLength(1)
    expect(again.tracker.baselineCycles).toBe(43)
  })
})

describe('POST /api/descale', () => {
  it('resets the tally from a fresh read and keeps a history', async () => {
    server.use(http.get(`${BASE}/devices/${DEVICE.id}`, () => HttpResponse.json({ ...DEVICE_DETAIL, totalWaterVolumeL: 40_000 })))
    const app = createTestApp()
    await app.json('GET', '/api/device')
    const marked = await app.json('POST', '/api/descale')
    expect(marked.status).toBe(200)
    expect(marked.body.markedAt).toBeGreaterThan(0)
    expect(marked.body.brewsSince).toBe(0)
    const { body } = await app.json('GET', '/api/history')
    expect(body.descale.markedAt).toBe(marked.body.markedAt)
    expect(body.descaleHistory).toHaveLength(1)
  })

  it('refuses to mark when the brewer reports no totals to count from', async () => {
    const app = createTestApp()
    await app.json('GET', '/api/device')
    const { status, body } = await app.json('POST', '/api/descale')
    expect(status).toBe(409)
    expect(body.error).toBe('brewer_totals_unavailable')
  })

  it('is refused cross-site like every other write', async () => {
    const app = createTestApp()
    const res = await app.fetch('/api/descale', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/history without Fellow', () => {
  it('still answers from the local log when the device read fails', async () => {
    server.use(http.get(`${BASE}/devices`, () => HttpResponse.json({ message: 'down' }, { status: 503 })))
    const app = createTestApp()
    const { status, body } = await app.json('GET', '/api/history')
    expect(status).toBe(200)
    expect(body.descale.level).toBe('unknown')
    expect(body.recent).toEqual([])
  })
})
