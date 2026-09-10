import { readBody, setResponseStatus } from 'h3'
import { asObject, defineApiRoute } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(async (event) => {
  const schedule = await useFellowClient().createSchedule(asObject(await readBody(event)))
  event.context.logger?.info({ action: 'schedule.create', scheduleId: schedule.id }, 'Schedule created')
  setResponseStatus(event, 201)
  return schedule
})
