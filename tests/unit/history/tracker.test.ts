import { describe, expect, it } from 'vitest'
import { BrewTracker } from '../../../server/lib/history'
import type { Device } from '../../../server/lib/fellow/schemas'

const T0 = 1_789_200_000_000
const idle = (cycles: number, extra: Partial<Device> = {}): Device => ({ id: 'd', state: null, brewing: false, totalBrewingCycles: cycles, brewingWaterVolumeMl: 825, ibSelectedProfileId: 'plocal1', ...extra })
const brewing = (phase: string, extra: Partial<Device> = {}): Device => ({ id: 'd', state: { value: phase }, brewing: true, totalBrewingCycles: 70, brewingWaterTemperatureC: 93.5, heaterOn: true, pumpOn: true, ibSelectedProfileId: 'plocal1', ...extra })
const titles = (id: string) => ({ plocal1: 'Medium Roast' } as Record<string, string>)[id]

describe('BrewTracker', () => {
  it('ignores reads that do not say whether the brewer is brewing', () => {
    const tracker = new BrewTracker()
    expect(tracker.observe({ id: 'd' }, T0)).toEqual([])
    expect(tracker.baselineCycles).toBeNull()
  })
  it('records a brew it watched from start to finish, counted when the counter rose by one', () => {
    const tracker = new BrewTracker()
    expect(tracker.observe(idle(70), T0)).toEqual([])
    const started = tracker.observe(brewing('b'), T0 + 60_000, titles)
    expect(started.map(e => e.type)).toEqual(['started', 'sample'])
    tracker.observe(brewing('p1'), T0 + 65_000, titles)
    tracker.observe(brewing('d', { brewingWaterTemperatureC: undefined }), T0 + 70_000, titles)
    const events = tracker.observe(idle(71, { brewingWaterVolumeMl: 900 }), T0 + 400_000, titles)
    expect(events).toHaveLength(1)
    const record = events[0]!.type === 'completed' ? events[0]!.record : null
    expect(record).toMatchObject({ profileId: 'plocal1', profileTitle: 'Medium Roast', observed: true, counted: true, cyclesAfter: 71, waterMl: 900, startedAt: T0 + 60_000, endedAt: T0 + 400_000, durationS: 340 })
    expect(record?.samples.map(s => s.phase)).toEqual(['bloom', 'pulse 1', 'drip finish'])
    expect(record?.samples[0]).toEqual({ t: T0 + 60_000, phase: 'bloom', temperatureC: 93.5, heaterOn: true, pumpOn: true })
    expect(record?.samples[2]?.temperatureC).toBeUndefined()
    expect(tracker.currentBrew).toBeNull()
    expect(tracker.baselineCycles).toBe(71)
  })
  it('leaves the duration null when the counter did not rise by exactly one', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('p1'), T0 + 1_000)
    const [event] = tracker.observe(idle(70), T0 + 30_000)
    expect(event).toMatchObject({ type: 'completed', record: { counted: false, durationS: null, observed: true } })
  })
  it('uses the brewer\'s own start and end times when they are plausible', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('b', { brewStartTime: String((T0 + 50_000) / 1000) }), T0 + 60_000)
    expect(tracker.currentBrew?.startedAt).toBe(T0 + 50_000)
    const [event] = tracker.observe(idle(71, { brewEndTime: String((T0 + 380_000) / 1000) }), T0 + 400_000)
    expect(event).toMatchObject({ type: 'completed', record: { startedAt: T0 + 50_000, endedAt: T0 + 380_000, durationS: 330 } })
  })
  it('ignores a stale start time and an end time from the future', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('b', { brewStartTime: T0 - 3_600_000 }), T0 + 60_000)
    expect(tracker.currentBrew?.startedAt).toBe(T0 + 60_000)
    const [event] = tracker.observe(idle(71, { brewEndTime: T0 + 9_000_000 }), T0 + 400_000)
    expect(event).toMatchObject({ type: 'completed', record: { endedAt: T0 + 400_000 } })
  })
  it('infers the brews it missed from a counter that rose while idle', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    const events = tracker.observe(idle(72, { brewStartTime: String((T0 + 100_000) / 1000), brewEndTime: String((T0 + 400_000) / 1000) }), T0 + 500_000, titles)
    expect(events.map(e => e.type)).toEqual(['inferred', 'inferred'])
    const records = events.map(e => (e.type === 'inferred' ? e.record : null))
    expect(records[0]).toMatchObject({ cyclesAfter: 71, waterMl: null, observed: false, counted: true, durationS: null, profileTitle: 'Medium Roast' })
    expect(records[1]).toMatchObject({ cyclesAfter: 72, waterMl: 825, startedAt: T0 + 100_000, endedAt: T0 + 400_000, samples: [] })
    expect(tracker.baselineCycles).toBe(72)
  })
  it('caps a burst of inferred brews at five and still moves the baseline', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    const events = tracker.observe(idle(80), T0 + 1_000)
    expect(events).toHaveLength(5)
    expect(events.map(e => (e.type === 'inferred' ? e.record.cyclesAfter : null))).toEqual([76, 77, 78, 79, 80])
    expect(tracker.baselineCycles).toBe(80)
  })
  it('starts from a stored baseline, so a brew during downtime is inferred on the first read', () => {
    const tracker = new BrewTracker({ baselineCycles: 70 })
    const events = tracker.observe(idle(71), T0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'inferred', record: { cyclesAfter: 71 } })
  })
  it('takes the first idle read as the baseline when there is none', () => {
    const tracker = new BrewTracker()
    expect(tracker.observe(idle(71), T0)).toEqual([])
    expect(tracker.baselineCycles).toBe(71)
  })
  it('counts a brew that was already running at the first read if the counter then rises by one', () => {
    const tracker = new BrewTracker()
    tracker.observe(brewing('p2'), T0)
    expect(tracker.currentBrew?.cyclesBefore).toBe(70)
    const [event] = tracker.observe(idle(71), T0 + 200_000)
    expect(event).toMatchObject({ type: 'completed', record: { counted: true } })
  })
})
