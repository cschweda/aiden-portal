import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '../../../server/utils/config'
import { HistoryService } from '../../../server/utils/history'
import { useTestEnv } from '../../helpers/app'
import { BASE, DEVICE, DEVICE_DETAIL, happyHandlers, newCalls } from '../../helpers/fellow-fixtures'
import { server } from '../../setup/msw'

describe('HistoryService polling', () => {
  let service: HistoryService | undefined
  beforeEach(() => {
    useTestEnv()
    vi.useFakeTimers()
  })
  afterEach(() => {
    service?.stop()
    vi.useRealTimers()
  })

  it('reads two seconds after start, then at the idle cadence, backs off on failure, and recovers', async () => {
    const calls = newCalls()
    let failing = false
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => {
        calls.deviceDetail++
        return failing ? HttpResponse.json({ message: 'down' }, { status: 503 }) : HttpResponse.json(DEVICE_DETAIL)
      }),
      ...happyHandlers(calls),
    )
    const reads = () => calls.devices + calls.deviceDetail
    service = new HistoryService(getConfig())
    service.start()
    expect(service.polling.running).toBe(true)
    expect(service.polling.lastPollAt).toBeNull()

    await vi.advanceTimersByTimeAsync(2_100)
    expect(service.polling.lastPollAt).not.toBeNull()
    const afterFirst = reads()
    expect(afterFirst).toBeGreaterThanOrEqual(1)

    await vi.advanceTimersByTimeAsync(60_100)
    expect(reads()).toBe(afterFirst + 1)
    expect(service.polling.failures).toBe(0)

    failing = true
    await vi.advanceTimersByTimeAsync(65_000)
    expect(service.polling.failures).toBe(1)
    expect(service.polling.lastError).toBe('fellow_http_error')
    const afterFailure = reads()
    // The next attempt waits twice the idle interval.
    await vi.advanceTimersByTimeAsync(100_000)
    expect(reads()).toBe(afterFailure)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(reads()).toBeGreaterThan(afterFailure)
    expect(service.polling.failures).toBe(2)

    failing = false
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(service.polling.failures).toBe(0)
    expect(service.polling.lastError).toBeNull()
  })

  it('reads again within two seconds of a poke while idle', async () => {
    const calls = newCalls()
    server.use(...happyHandlers(calls))
    service = new HistoryService(getConfig())
    service.start()
    await vi.advanceTimersByTimeAsync(2_100)
    const reads = calls.devices + calls.deviceDetail
    service.pokeSoon()
    await vi.advanceTimersByTimeAsync(2_100)
    expect(calls.devices + calls.deviceDetail).toBe(reads + 1)
  })

  it('samples every five seconds while a brew runs and logs it when the brewer reads idle', async () => {
    const calls = newCalls()
    let brewing = false
    let cycles = 42
    server.use(
      http.get(`${BASE}/devices/${DEVICE.id}`, () => {
        calls.deviceDetail++
        return HttpResponse.json({ ...DEVICE_DETAIL, totalBrewingCycles: cycles, brewing, state: brewing ? { value: 'p1' } : null, brewingWaterTemperatureC: brewing ? 93 : null })
      }),
      ...happyHandlers(calls),
    )
    service = new HistoryService(getConfig())
    service.start()
    await vi.advanceTimersByTimeAsync(2_100)
    brewing = true
    await vi.advanceTimersByTimeAsync(60_100)
    expect(service.tracker.currentBrew?.samples).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_100)
    expect(service.tracker.currentBrew?.samples).toHaveLength(3)
    brewing = false
    cycles = 43
    await vi.advanceTimersByTimeAsync(5_100)
    expect(service.tracker.currentBrew).toBeNull()
    expect(service.store.brews).toHaveLength(1)
    expect(service.store.brews[0]).toMatchObject({ counted: true, observed: true, cyclesAfter: 43, profileTitle: 'Debug-FellowAiden' })
    expect(service.store.brews[0]?.samples).toHaveLength(3)
  })
})
