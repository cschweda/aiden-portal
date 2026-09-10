import { getQuery } from 'h3'
import { z } from 'zod'
import { defineApiRoute } from '../utils/api'
import { getConfig } from '../utils/config'
import { LEVEL_NAMES, readLogTail } from '../utils/log-reader'
import { currentLogFile } from '../utils/logger'

const LogsQuery = z.object({
  lines: z.coerce.number().int().min(1).max(1000).default(200),
  level: z.enum(LEVEL_NAMES).optional(),
  requestId: z.string().max(64).optional(),
})

/** Tails the current production log file. In development there is no file and the page says so. */
export default defineApiRoute(async (event) => {
  const raw = Object.fromEntries(Object.entries(getQuery(event)).filter(([, value]) => value !== ''))
  const query = LogsQuery.parse(raw)
  const file = currentLogFile(getConfig())
  const { available, records } = await readLogTail(file, { lines: query.lines, minLevel: query.level, requestId: query.requestId })
  return { available, file, records }
})
