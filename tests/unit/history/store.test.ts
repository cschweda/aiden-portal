import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BREWS_FILE, CLEANINGS_FILE, DESCALE_FILE, HistoryStore } from '../../../server/lib/history'
import type { BrewRecord, CleaningRecord } from '../../../server/lib/history'

const record = (overrides: Partial<BrewRecord> = {}): BrewRecord => ({
  id: 'b1',
  startedAt: 1_000_000,
  endedAt: 1_300_000,
  durationS: 300,
  waterMl: 825,
  profileId: 'plocal1',
  profileTitle: 'Medium Roast',
  observed: true,
  counted: true,
  cyclesAfter: 71,
  samples: [{ t: 1_000_000, phase: 'bloom', temperatureC: 93.5 }],
  ...overrides,
})

let dir: string
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'aiden-history-')), 'data')
})
afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true })
})

describe('HistoryStore', () => {
  it('creates an owner-only directory and appends records that a fresh store reads back', () => {
    const store = new HistoryStore({ directory: dir })
    store.appendBrew(record())
    store.appendBrew(record({ id: 'b2', endedAt: 2_000_000 }))
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, BREWS_FILE)).mode & 0o777).toBe(0o600)
    const again = new HistoryStore({ directory: dir })
    expect(again.brews.map(r => r.id)).toEqual(['b1', 'b2'])
    expect(again.lastBrew?.cyclesAfter).toBe(71)
    expect(again.brews[0]?.samples[0]?.temperatureC).toBe(93.5)
  })
  it('skips corrupt and malformed lines without losing the good ones', () => {
    const store = new HistoryStore({ directory: dir })
    store.appendBrew(record())
    writeFileSync(join(dir, BREWS_FILE), `${readFileSync(join(dir, BREWS_FILE), 'utf8')}{not json\n{"id":"x"}\n\n${JSON.stringify(record({ id: 'b3' }))}\n`)
    const again = new HistoryStore({ directory: dir })
    expect(again.brews.map(r => r.id)).toEqual(['b1', 'b3'])
    expect(again.skippedLines).toBe(2)
  })
  it('keeps only the newest records in memory while the file keeps all of them', () => {
    const store = new HistoryStore({ directory: dir, keepInMemory: 2 })
    for (const id of ['a', 'b', 'c']) store.appendBrew(record({ id }))
    expect(store.brews.map(r => r.id)).toEqual(['b', 'c'])
    expect(readFileSync(join(dir, BREWS_FILE), 'utf8').trim().split('\n')).toHaveLength(3)
  })
  it('writes the descale marker atomically and keeps a history', () => {
    const store = new HistoryStore({ directory: dir })
    expect(store.descaleState).toEqual({ current: null, history: [] })
    store.markDescaled({ at: 1_000, brews: 60, waterMl: 55_000 })
    const state = store.markDescaled({ at: 2_000, brews: 70, waterMl: 63_570 })
    expect(state.current).toEqual({ at: 2_000, brews: 70, waterMl: 63_570 })
    expect(state.history.map(m => m.at)).toEqual([1_000, 2_000])
    expect(existsSync(join(dir, `${DESCALE_FILE}.tmp`))).toBe(false)
    expect(statSync(join(dir, DESCALE_FILE)).mode & 0o777).toBe(0o600)
    expect(new HistoryStore({ directory: dir }).descaleState.current?.brews).toBe(70)
  })
  it('leaves an existing directory\'s permissions alone and says when they are shared', () => {
    mkdirSync(dir, { recursive: true })
    chmodSync(dir, 0o755)
    const store = new HistoryStore({ directory: dir })
    store.appendBrew(record())
    expect(statSync(dir).mode & 0o777).toBe(0o755)
    expect(store.directoryIsShared).toBe(true)
    expect(new HistoryStore({ directory: join(dir, 'fresh') }).directoryIsShared).toBe(false)
  })
  it('repairs a torn last line before appending, so the next record stays readable', () => {
    const store = new HistoryStore({ directory: dir })
    store.appendBrew(record())
    writeFileSync(join(dir, BREWS_FILE), `${readFileSync(join(dir, BREWS_FILE), 'utf8')}{"id":"torn","startedAt":1`)
    new HistoryStore({ directory: dir }).appendBrew(record({ id: 'b2' }))
    const again = new HistoryStore({ directory: dir })
    expect(again.brews.map(r => r.id)).toEqual(['b1', 'b2'])
    expect(again.skippedLines).toBe(1)
  })
  it('reports an unusable directory instead of throwing on load, and refuses writes', () => {
    writeFileSync(join(dir, '..', 'not-a-dir'), 'x')
    const store = new HistoryStore({ directory: join(dir, '..', 'not-a-dir') })
    expect(store.loadError).toMatch(/ENOTDIR|EEXIST|not a directory/i)
    expect(store.brews).toEqual([])
    expect(() => store.appendBrew(record())).toThrow(/unusable/)
  })
  it('keeps cleaning cycles in their own file and reads them back', () => {
    const store = new HistoryStore({ directory: dir })
    const cycle: CleaningRecord = { id: 'c1', kind: 'clean', startedAt: 1_000, endedAt: 1_800_000, durationS: 1799, waterMl: 1500, cyclesDelta: 1, waterDeltaMl: 1500, cyclesAfter: 71, observedStart: true, samples: [{ t: 1_000, heaterOn: true, pumpOn: true }] }
    store.appendCleaning(cycle)
    expect(store.lastKnownCycles).toBe(71)
    store.appendBrew(record({ endedAt: 2_000_000, cyclesAfter: 72 }))
    expect(store.lastKnownCycles).toBe(72)
    expect(statSync(join(dir, CLEANINGS_FILE)).mode & 0o777).toBe(0o600)
    const again = new HistoryStore({ directory: dir })
    expect(again.cleanings).toEqual([cycle])
    expect(again.brews).toHaveLength(1)
    expect(again.lastKnownCycles).toBe(72)
  })
  it('treats an unreadable marker file as never descaled', () => {
    const store = new HistoryStore({ directory: dir })
    store.load()
    writeFileSync(join(dir, DESCALE_FILE), '{oops')
    expect(new HistoryStore({ directory: dir }).descaleState.current).toBeNull()
  })
})
