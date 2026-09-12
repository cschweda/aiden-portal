import { getQuery } from 'h3'
import { z } from 'zod'
import { defineApiRoute } from '../utils/api'
import { getConfig } from '../utils/config'
import { LEVEL_NAMES, readLogTail } from '../utils/log-reader'
import { currentLogFile, currentLogLevel } from '../utils/logger'

const LogsQuery = z.object({
  lines: z.coerce.number().int().min(1).max(1000).default(200),
  level: z.enum(LEVEL_NAMES).optional(),
  requestId: z.string().max(64).optional(),
})

/** Tails the current production log file. Outside production the logs go to the terminal, and no file is read. */
export default defineApiRoute(async (event) => {
  const raw = Object.fromEntries(Object.entries(getQuery(event)).filter(([, value]) => value !== ''))
  const query = LogsQuery.parse(raw)
  const config = getConfig()
  const file = currentLogFile(config)
  const level = currentLogLevel()
  if (!config.isProduction) return { available: false, production: false, file, level, records: [] }
  const { available, records } = await readLogTail(file, { lines: query.lines, minLevel: query.level, requestId: query.requestId })
  return { available, production: true, file, level, records }
})
