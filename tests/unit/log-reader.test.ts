import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLogLine, readLogTail } from '../../server/utils/log-reader'

const line = (level: number, msg: string, extra: Record<string, unknown> = {}, time = 1_700_000_000_000) =>
  JSON.stringify({ level, time, pid: 1, hostname: 'h', msg, ...extra })

async function fixtureFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'aiden-log-'))
  const file = join(dir, 'current.log')
  await writeFile(file, [
    line(30, 'starting', {}, 1),
    line(20, 'debug one', { requestId: 'r1' }, 2),
    'this is not json',
    line(40, 'warn one', { requestId: 'r1', host: 'evil' }, 3),
    line(50, 'error one', { requestId: 'r2', code: 'fellow_http_error' }, 4),
    line(30, 'info last', { requestId: 'r2' }, 5),
    '',
  ].join('\n'))
  return file
}

describe('parseLogLine', () => {
  it('turns a pino line into a record and lifts the extras', () => {
    expect(parseLogLine(line(40, 'warn one', { requestId: 'r1', host: 'evil' }, 3))).toEqual({
      time: 3, level: 40, levelName: 'warn', msg: 'warn one', requestId: 'r1', rest: { host: 'evil' },
    })
  })
  it('returns null for garbage', () => {
    expect(parseLogLine('nope')).toBeNull()
    expect(parseLogLine('{"no":"level"}')).toBeNull()
  })
})

describe('readLogTail', () => {
  it('returns the newest records first, at most the requested count', async () => {
    const { available, records } = await readLogTail(await fixtureFile(), { lines: 3 })
    expect(available).toBe(true)
    expect(records.map(r => r.msg)).toEqual(['info last', 'error one', 'warn one'])
  })
  it('filters by minimum level', async () => {
    const { records } = await readLogTail(await fixtureFile(), { lines: 100, minLevel: 'warn' })
    expect(records.map(r => r.levelName)).toEqual(['error', 'warn'])
  })
  it('filters by request id', async () => {
    const { records } = await readLogTail(await fixtureFile(), { lines: 100, requestId: 'r1' })
    expect(records.map(r => r.msg)).toEqual(['warn one', 'debug one'])
  })
  it('drops the partial first line when the file is longer than the tail window', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiden-log-'))
    const file = join(dir, 'big.log')
    const filler = line(30, 'x'.repeat(1000), {}, 1)
    const lines: string[] = []
    while (lines.join('\n').length < 2.2 * 1024 * 1024) lines.push(filler)
    lines.push(line(40, 'the last one', {}, 2))
    await writeFile(file, lines.join('\n') + '\n')
    const { records } = await readLogTail(file, { lines: 5 })
    expect(records[0]?.msg).toBe('the last one')
    expect(records.every(r => r.msg === 'the last one' || r.msg.length === 1000)).toBe(true)
  })

  it('reports a missing file as unavailable', async () => {
    expect(await readLogTail('/nonexistent/aiden/current.log', { lines: 10 })).toEqual({ available: false, records: [] })
  })
})
