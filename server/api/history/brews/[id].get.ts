import { createError, getRouterParam } from 'h3'
import { defineApiRoute } from '../../../utils/api'
import { useHistory } from '../../../utils/history'

const BREW_ID = /^[A-Za-z0-9_-]{1,64}$/

/** One brew with its trace samples. */
export default defineApiRoute((event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!BREW_ID.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid brew id' })
  const record = useHistory().brew(id)
  if (!record) throw createError({ statusCode: 404, statusMessage: 'No such brew' })
  return record
})
