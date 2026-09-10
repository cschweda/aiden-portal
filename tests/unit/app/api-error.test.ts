import { describe, expect, it } from 'vitest'
import { describeApiError } from '../../../app/utils/api-error'

describe('describeApiError', () => {
  it('reads the server envelope from a fetch error', () => {
    const error = Object.assign(new Error('502 Bad Gateway'), { data: { error: 'fellow_auth_failed', message: 'Fellow rejected the email or password' }, statusCode: 502 })
    expect(describeApiError(error)).toEqual({ code: 'fellow_auth_failed', message: 'Fellow rejected the email or password' })
  })
  it('keeps validation issues', () => {
    const error = Object.assign(new Error('400'), { data: { error: 'validation_failed', issues: [{ path: 'ratio', message: 'bad' }] } })
    expect(describeApiError(error)).toEqual({ code: 'validation_failed', message: 'ratio: bad', issues: [{ path: 'ratio', message: 'bad' }] })
  })
  it('labels a missing envelope by status', () => {
    expect(describeApiError(Object.assign(new Error('x'), { statusCode: 404, data: '<html>' }))).toEqual({ code: 'http_404', message: 'x' })
  })
  it('recognises a network failure', () => {
    expect(describeApiError(new TypeError('Failed to fetch'))).toEqual({ code: 'network_error', message: 'Failed to fetch' })
  })
  it('never throws on junk', () => {
    expect(describeApiError(undefined)).toEqual({ code: 'unknown_error', message: 'Something went wrong' })
    expect(describeApiError('nope')).toEqual({ code: 'unknown_error', message: 'nope' })
  })
})
