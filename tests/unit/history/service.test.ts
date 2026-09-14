import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '../../../server/lib/fellow/schemas'
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

describe('HistoryService across a restart', () => {
  const T = 1_789_200_000_000
  const device = (extra: Partial<Device> = {}): Device => ({ id: 'd', state: null, brewing: false, totalBrewingCycles: 70, carafePresent: true, ...extra })
  const brewing = (extra: Partial<Device> = {}): Device => device({ state: { value: 'b' }, brewing: true, ...extra })

  /**
   * Two services in turn over one directory, the way a reinstall replaces the process under the same data. The
   * clock is set first because a service decides on construction whether what it finds is recent enough to resume.
   */
  const restart = (dir: string, now: number): HistoryService => {
    vi.setSystemTime(now)
    useTestEnv({ HISTORY_DIRECTORY: dir })
    return new HistoryService(getConfig())
  }

  beforeEach(() => {
    useTestEnv()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('picks the brew back up with the samples the last run had taken', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'aiden-restart-')), 'data')
    const first = restart(dir, T)
    first.observe(device(), T)
    first.observe(brewing(), T + 5_000)
    first.observe(brewing(), T + 10_000)
    expect(first.tracker.currentBrew?.samples).toHaveLength(2)

    const second = restart(dir, T + 20_000)
    expect(second.tracker.currentBrew).toMatchObject({ id: first.tracker.currentBrew!.id, startedAt: T + 5_000 })
    expect(second.tracker.currentBrew?.samples).toHaveLength(2)

    // The brew carries on and finishes under the new process, and the whole trace is in the one record.
    second.observe(brewing(), T + 15_000)
    second.observe(device({ totalBrewingCycles: 71 }), T + 300_000)
    expect(second.tracker.currentBrew).toBeNull()
    const record = second.store.brews[second.store.brews.length - 1]
    expect(record?.samples).toHaveLength(3)
    expect(record).toMatchObject({ counted: true, startedAt: T + 5_000 })
  })

  it('notices when the brewer stops reporting, and is not fooled by its drifting clock', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'aiden-quiet-')), 'data')
    const service = restart(dir, T)
    service.observe(device(), T)
    expect(service.snapshot(device(), T).sensorsChangedAt).toBe(T)

    // The brewer's own end time moves while it sits idle; that is not the machine being used.
    service.observe(device({ brewEndTime: String((T + 60_000) / 1000) }), T + 60_000)
    expect(service.snapshot(device(), T + 60_000).sensorsChangedAt).toBe(T)

    // Something it actually senses changes, and the stamp moves with it.
    service.observe(device({ carafePresent: false }), T + 120_000)
    expect(service.snapshot(device(), T + 120_000).sensorsChangedAt).toBe(T + 120_000)

    // A new process over the same directory picks the judgement back up rather than starting it over.
    const second = restart(dir, T + 200_000)
    expect(second.snapshot(device(), T + 200_000).sensorsChangedAt).toBe(T + 120_000)
  })
  it('keeps the coffee clock across a restart, and lets it expire on its own', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'aiden-restart-')), 'data')
    const first = restart(dir, T)
    first.observe(device(), T)
    first.observe(brewing(), T + 5_000)
    first.observe(device({ totalBrewingCycles: 71 }), T + 300_000)
    expect(first.snapshot(device(), T + 360_000).coffee.sittingSince).toBe(T + 300_000)
    // The carafe is carried off. The brewer may go on reporting it as present for hours, and the clock ignores it.
    first.observe(device({ totalBrewingCycles: 71, carafePresent: false }), T + 400_000)
    expect(first.snapshot(device({ carafePresent: false }), T + 420_000).coffee.sittingSince).toBe(T + 300_000)

    // It comes from the brew log, so a new process reads the same answer.
    const second = restart(dir, T + 450_000)
    expect(second.snapshot(device(), T + 500_000).coffee.sittingSince).toBe(T + 300_000)
    // And it stops at the horizon, two hours past the brew, by when the coffee is cold whatever happened to it.
    expect(second.snapshot(device(), T + 300_000 + 119 * 60_000).coffee.sittingSince).toBe(T + 300_000)
    expect(second.snapshot(device(), T + 300_000 + 121 * 60_000).coffee.sittingSince).toBeNull()
  })
})
