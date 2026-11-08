import { readBody } from 'h3'
import { z } from 'zod'
import { LOG_LEVELS } from '../../utils/aiden-config'
import { asObject, defineApiRoute } from '../../utils/api'
import { currentLogLevel, setLogLevel, useLogger } from '../../utils/logger'

const LevelBody = z.object({ level: z.enum(LOG_LEVELS) })

/** Switches the log level for the running process; the persistent default stays in aiden.config.ts or LOG_LEVEL. */
export default defineApiRoute(async (event) => {
  const { level } = LevelBody.parse(asObject(await readBody(event)))
  const previous = currentLogLevel()
  setLogLevel(level)
  // Written at warn so the change is visible whatever the old or new level.
  useLogger().warn({ action: 'logs.level', previous, level }, 'Log level changed until the service restarts')
  return { level }
})
