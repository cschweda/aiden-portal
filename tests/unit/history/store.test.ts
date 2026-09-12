import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BREWS_FILE, DESCALE_FILE, HistoryStore } from '../../../server/lib/history'
import type { BrewRecord } from '../../../server/lib/history'

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
  it('treats an unreadable marker file as never descaled', () => {
    const store = new HistoryStore({ directory: dir })
    store.load()
    writeFileSync(join(dir, DESCALE_FILE), '{oops')
    expect(new HistoryStore({ directory: dir }).descaleState.current).toBeNull()
  })
})
