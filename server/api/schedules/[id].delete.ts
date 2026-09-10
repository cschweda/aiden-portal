import { getRouterParam } from 'h3'
import { ScheduleIdSchema } from '../../lib/fellow'
import { defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const id = ScheduleIdSchema.parse(getRouterParam(event, 'id'))
  await useFellowClient().deleteSchedule(id)
  event.context.logger?.info({ action: 'schedule.delete', scheduleId: id }, 'Schedule deleted')
  return { ok: true }
})
