import { open } from 'node:fs/promises'

export const LOG_LEVELS_BY_NAME = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const

export type LevelName = keyof typeof LOG_LEVELS_BY_NAME

export const LEVEL_NAMES = Object.keys(LOG_LEVELS_BY_NAME) as LevelName[]

const NAME_BY_LEVEL = new Map<number, LevelName>(Object.entries(LOG_LEVELS_BY_NAME).map(([name, level]) => [level, name as LevelName]))

export interface LogRecord {
  time: number
  level: number
  levelName: string
  msg: string
  requestId?: string
  /** Every other field pino wrote, minus the process noise. */
  rest: Record<string, unknown>
}

export interface LogQuery {
  lines: number
  minLevel?: LevelName
  requestId?: string
}

/** Only ever read this much from the end of the file; the viewer shows at most a thousand lines. */
const TAIL_BYTES = 2 * 1024 * 1024

const NOISE = new Set(['level', 'time', 'msg', 'requestId', 'pid', 'hostname'])

/** A pino JSON line → record. Anything that is not a pino line is null. */
export function parseLogLine(line: string): LogRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  }
  catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.level !== 'number' || typeof record.msg !== 'string') return null
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!NOISE.has(key)) rest[key] = value
  }
  return {
    time: typeof record.time === 'number' ? record.time : 0,
    level: record.level,
    levelName: NAME_BY_LEVEL.get(record.level) ?? String(record.level),
    msg: record.msg,
    ...(typeof record.requestId === 'string' ? { requestId: record.requestId } : {}),
    rest,
  }
}

/** The newest matching records first, at most `lines` of them. A missing file is reported, not thrown. */
export async function readLogTail(file: string, { lines, minLevel, requestId }: LogQuery): Promise<{ available: boolean, records: LogRecord[] }> {
  let text: string
  try {
    const handle = await open(file, 'r')
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, TAIL_BYTES)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, size - length)
      text = buffer.toString('utf8')
      // A partial first line is an artefact of reading from the middle of the file.
      if (length < size) text = text.slice(text.indexOf('\n') + 1)
    }
    finally {
      await handle.close()
    }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { available: false, records: [] }
    throw error
  }
  const min = minLevel ? LOG_LEVELS_BY_NAME[minLevel] : 0
  const records = text
    .split('\n')
    .map(parseLogLine)
    .filter((record): record is LogRecord => record !== null)
    .filter(record => record.level >= min && (!requestId || record.requestId === requestId))
  return { available: true, records: records.slice(-lines).reverse() }
}
