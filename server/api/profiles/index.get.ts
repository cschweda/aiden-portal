import { defineApiRoute, parseFresh } from '../../utils/api'
import { useFellowClient } from '../../utils/fellow-client'

export default defineApiRoute(event => useFellowClient().getProfiles({ fresh: parseFresh(event) }))
