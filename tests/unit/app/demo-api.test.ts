import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoFetch, resetDemo, setDemoVersion } from '../../../app/demo/api'
import { DEMO_BREW_SECONDS } from '../../../app/demo/fixtures'

/** The demo answers the same shapes as `server/api/`, so the pages cannot tell the difference. */
describe('the demo API', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    resetDemo()
  })
  afterEach(() => vi.useRealTimers())

  it('serves a ready brewer, a profile library, and schedules', async () => {
    const device = await demoFetch<{ device: { displayName: string }, canStartBrew: boolean, blockers: string[] }>('/api/device')
    expect(device.device.displayName).toBe('Aiden')
    expect(device.canStartBrew).toBe(true)
    expect(device.blockers).toEqual([])
    expect(await demoFetch<unknown[]>('/api/profiles')).toHaveLength(7)
    expect(await demoFetch<unknown[]>('/api/schedules')).toHaveLength(2)
    expect(await demoFetch<{ version: string }>('/api/status')).toMatchObject({ version: 'demo', dryRun: false })
    setDemoVersion('1.2.3')
    expect(await demoFetch<{ version: string }>('/api/status')).toMatchObject({ version: '1.2.3 demo' })
  })

  it('creates, edits, shares, and deletes a profile', async () => {
    const created = await demoFetch<{ id: string, title: string }>('/api/profiles', { method: 'POST', body: { title: 'Test Recipe', ratio: 16 } })
    expect(created.id).toMatch(/^p\d+$/)
    expect((await demoFetch<unknown[]>('/api/profiles'))).toHaveLength(8)
    const edited = await demoFetch<{ title: string }>(`/api/profiles/${created.id}`, { method: 'PATCH', body: { title: 'Renamed' } })
    expect(edited.title).toBe('Renamed')
    expect(await demoFetch<{ link: string }>(`/api/profiles/${created.id}/share`, { method: 'POST' })).toMatchObject({ link: expect.stringContaining('brew.link') })
    await demoFetch(`/api/profiles/${created.id}`, { method: 'DELETE' })
    expect((await demoFetch<unknown[]>('/api/profiles'))).toHaveLength(7)
  })

  it('refuses a brew.link import that is not a brew.link', async () => {
    await expect(demoFetch('/api/profiles/import', { method: 'POST', body: { link: 'https://evil.example/p/1' } }))
      .rejects.toMatchObject({ status: 400, data: { error: 'validation_failed' } })
  })

  it('runs a brew on the clock: phases appear, then it lands in the history', async () => {
    const started = await demoFetch<{ ok: boolean }>('/api/brew/start', { method: 'POST' })
    expect(started.ok).toBe(true)
    const brewsBefore = (await demoFetch<{ recent: unknown[] }>('/api/history')).recent.length

    await vi.advanceTimersByTimeAsync(12_000)
    const mid = await demoFetch<{ current: { samples: Array<{ phase: string }>, expected: { seconds: number } | null } | null }>('/api/history')
    expect(mid.current).not.toBeNull()
    expect(mid.current!.samples.length).toBeGreaterThan(1)
    expect(mid.current!.samples[0]!.phase).toBe('bloom')
    expect(mid.current!.expected?.seconds).toBeGreaterThan(0)
    expect((await demoFetch<{ device: { brewing: boolean } }>('/api/device')).device.brewing).toBe(true)

    await vi.advanceTimersByTimeAsync(DEMO_BREW_SECONDS * 1000)
    const after = await demoFetch<{ current: unknown, recent: Array<{ durationS: number }> }>('/api/history')
    expect(after.current).toBeNull()
    expect(after.recent).toHaveLength(brewsBefore + 1)
    expect(after.recent[0]!.durationS).toBe(DEMO_BREW_SECONDS)
    expect((await demoFetch<{ device: { brewing: boolean } }>('/api/device')).device.brewing).toBe(false)
  })

  it('marks a descale, which resets the tally', async () => {
    const before = await demoFetch<{ descale: { litresSince: number } }>('/api/history')
    expect(before.descale.litresSince).toBeGreaterThan(0)
    const marked = await demoFetch<{ litresSince: number, markedAt: number }>('/api/descale', { method: 'POST' })
    expect(marked.litresSince).toBe(0)
    expect((await demoFetch<{ descaleHistory: unknown[] }>('/api/history')).descaleHistory).toHaveLength(2)
  })

  it('filters logs and switches the level', async () => {
    const all = await demoFetch<{ records: unknown[], level: string }>('/api/logs')
    expect(all.records.length).toBeGreaterThan(10)
    expect(all.level).toBe('info')
    const warnings = await demoFetch<{ records: Array<{ level: number }> }>('/api/logs', { query: { level: 'warn' } })
    expect(warnings.records.every(r => r.level >= 40)).toBe(true)
    expect(await demoFetch('/api/logs/level', { method: 'PATCH', body: { level: 'debug' } })).toEqual({ level: 'debug' })
    expect((await demoFetch<{ level: string }>('/api/logs')).level).toBe('debug')
  })

  it('answers an unknown route the way the real API does', async () => {
    await expect(demoFetch('/api/nope')).rejects.toMatchObject({ status: 404, data: { error: 'not_found' } })
    await expect(demoFetch('/api/history/brews/nope')).rejects.toMatchObject({ status: 404 })
  })
})
