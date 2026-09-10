import { getRouterParam, readBody } from 'h3'
import { ScheduleIdSchema } from '../../lib/fellow'
import { asObject, defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const id = ScheduleIdSchema.parse(getRouterParam(event, 'id'))
  await useFellowClient().updateSchedule(id, asObject(await readBody(event)))
  event.context.logger?.info({ action: 'schedule.update', scheduleId: id }, 'Schedule updated')
  return { ok: true }
})
