import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from './setup/msw'

describe('test harness', () => {
  it('intercepts fetch through msw', async () => {
    server.use(http.get('https://example.test/ping', () => HttpResponse.json({ pong: true })))
    const res = await fetch('https://example.test/ping')
    expect(await res.json()).toEqual({ pong: true })
  })

  it('rejects unhandled requests', async () => {
    await expect(fetch('https://example.test/nothing-here')).rejects.toThrow()
  })
})
