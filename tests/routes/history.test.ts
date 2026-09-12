import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useHistory } from '../../server/utils/history'
import { createTestApp, useTestEnv } from '../helpers/app'
import { BASE, DEVICE_DETAIL, happyHandlers, newCalls } from '../helpers/fellow-fixtures'
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
  })

  it('lists recorded brews newest first without samples, and serves one brew with its trace', async () => {
    const history = useHistory()
    const now = Date.now()
    const base = { ...DEVICE_DETAIL, totalWaterVolumeL: 40_000 }
    history.observe({ ...base, brewing: false, state: null }, now - 400_000)
    history.observe({ ...base, brewing: true, state: { value: 'b' }, brewingWaterTemperatureC: 94 }, now - 300_000)
    history.observe({ ...base, brewing: true, state: { value: 'p1' }, brewingWaterTemperatureC: 93 }, now - 295_000)
    history.observe({ ...base, brewing: false, state: null, totalBrewingCycles: 43, brewingWaterVolumeMl: 950 }, now - 100_000)
    const app = createTestApp()
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
    expect((await app.json('GET', '/api/history/brews/nope')).status).toBe(404)
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
    const app = createTestApp()
    const marked = await app.json('POST', '/api/descale')
    expect(marked.status).toBe(200)
    expect(marked.body.markedAt).toBeGreaterThan(0)
    expect(marked.body.brewsSince).toBe(0)
    const { body } = await app.json('GET', '/api/history')
    expect(body.descale.markedAt).toBe(marked.body.markedAt)
    expect(body.descaleHistory).toHaveLength(1)
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
