import { defineApiRoute, parseFresh } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(event => useFellowClient().getSchedules({ fresh: parseFresh(event) }))
