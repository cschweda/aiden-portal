import { describe, expect, it } from 'vitest'
import { BrewTracker, MAX_BREW_MS, MAX_CLEANING_MS, MAX_SAMPLES, targetOf } from '../../../server/lib/history'
import type { Device } from '../../../server/lib/fellow/schemas'

const T0 = 1_789_200_000_000
const idle = (cycles: number, extra: Partial<Device> = {}): Device => ({ id: 'd', state: null, brewing: false, totalBrewingCycles: cycles, brewingWaterVolumeMl: 825, ibSelectedProfileId: 'plocal1', ...extra })
const brewing = (phase: string, extra: Partial<Device> = {}): Device => ({ id: 'd', state: { value: phase }, brewing: true, totalBrewingCycles: 70, brewingWaterTemperatureC: 93.5, heaterOn: true, pumpOn: true, ibSelectedProfileId: 'plocal1', ...extra })
const titles = (id: string) => (id === 'plocal1'
  ? { title: 'Medium Roast', bloomEnabled: true, bloomTemperature: 96, overallTemperature: 94, ssPulseTemperatures: [96, 95, 94], batchPulseTemperatures: [93, 92] }
  : undefined)

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
  it('believes a start time from earlier in the same brew, and ignores an end time from the future', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    // A restart mid-brew sees the brewer already brewing; its reported start is this brew's, so the duration holds.
    tracker.observe(brewing('b', { brewStartTime: T0 - 3_600_000 }), T0 + 60_000)
    expect(tracker.currentBrew).toMatchObject({ startedAt: T0 - 3_600_000, startOrigin: 'device' })
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
    const drifted = new BrewTracker({ baselineCycles: 70 }).observe(idle(71, { brewStartTime: String((T0 - 6 * 3_600_000) / 1000), brewEndTime: String((T0 - 1000) / 1000) }), T0)
    expect(drifted[0]).toMatchObject({ type: 'inferred', record: { startedAt: T0 - 6 * 3_600_000, endedAt: T0 - 6 * 3_600_000 } })
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
  it('seeds an empty log with the last brew the brewer still reports, once', () => {
    const tracker = new BrewTracker({ seedLastBrew: true })
    const events = tracker.observe(idle(70, { brewStartTime: String((T0 - 400_000) / 1000), brewEndTime: String((T0 - 60_000) / 1000) }), T0, titles)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'inferred', record: { startedAt: T0 - 400_000, endedAt: T0 - 60_000, waterMl: 825, profileTitle: 'Medium Roast', observed: false, counted: true, cyclesAfter: 70, durationS: null } })
    const drifted = new BrewTracker({ seedLastBrew: true }).observe(idle(70, { brewStartTime: String((T0 - 5 * 3_600_000) / 1000), brewEndTime: String((T0 - 60_000) / 1000) }), T0)
    expect(drifted[0]).toMatchObject({ type: 'inferred', record: { startedAt: T0 - 5 * 3_600_000, endedAt: T0 - 5 * 3_600_000 } })
    expect(tracker.observe(idle(70, { brewEndTime: String((T0 - 60_000) / 1000) }), T0 + 60_000)).toEqual([])
    expect(tracker.baselineCycles).toBe(70)
  })
  it('does not seed without a reported start time, or when the log already has brews', () => {
    expect(new BrewTracker({ seedLastBrew: true }).observe(idle(70), T0)).toEqual([])
    expect(new BrewTracker({ seedLastBrew: false }).observe(idle(70, { brewStartTime: String((T0 - 60_000) / 1000) }), T0)).toEqual([])
    expect(new BrewTracker({ seedLastBrew: true, baselineCycles: 69 }).observe(idle(70, { brewStartTime: String((T0 - 60_000) / 1000) }), T0).map(e => e.type)).toEqual(['inferred'])
  })
  it('takes the first idle read as the baseline when there is none', () => {
    const tracker = new BrewTracker()
    expect(tracker.observe(idle(71), T0)).toEqual([])
    expect(tracker.baselineCycles).toBe(71)
  })
  it('counts a brew already running at the first read, but does not trust a duration it never saw start', () => {
    const tracker = new BrewTracker()
    tracker.observe(brewing('p2'), T0)
    expect(tracker.currentBrew).toMatchObject({ cyclesBefore: 70, startOrigin: 'first-read' })
    const [event] = tracker.observe(idle(71), T0 + 200_000)
    expect(event).toMatchObject({ type: 'completed', record: { counted: true, durationS: null, observed: true } })
  })
  it('trusts the duration of a brew first seen mid-way when the brewer reports a start time', () => {
    const tracker = new BrewTracker()
    tracker.observe(brewing('p2', { brewStartTime: String((T0 - 90_000) / 1000) }), T0)
    expect(tracker.currentBrew).toMatchObject({ startedAt: T0 - 90_000, startOrigin: 'device' })
    const [event] = tracker.observe(idle(71), T0 + 200_000)
    expect(event).toMatchObject({ type: 'completed', record: { counted: true, durationS: 290 } })
  })
  it('marks a brew seen after an idle read as a transition, with a trusted duration', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('b'), T0 + 60_000)
    expect(tracker.currentBrew?.startOrigin).toBe('transition')
  })
  it('attributes the next counter rise to a brew completed without a counter reading, instead of inferring a duplicate', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('p1'), T0 + 1_000)
    const [completed] = tracker.observe(idle(70, { totalBrewingCycles: undefined }), T0 + 300_000)
    expect(completed).toMatchObject({ type: 'completed', record: { counted: false, cyclesAfter: null } })
    expect(tracker.observe(idle(71), T0 + 360_000)).toEqual([])
    expect(tracker.baselineCycles).toBe(71)
    expect(tracker.observe(idle(72), T0 + 400_000)).toHaveLength(1)
  })
  it('closes a brew that has run for a day as uncounted and starts watching afresh', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('p1'), T0 + 1_000)
    const events = tracker.observe(brewing('p1'), T0 + 1_000 + MAX_BREW_MS + 1)
    expect(events.map(e => e.type)).toEqual(['completed', 'started', 'sample'])
    expect(events[0]).toMatchObject({ type: 'completed', record: { counted: false, durationS: null } })
    expect(tracker.currentBrew?.startOrigin).toBe('first-read')
  })
  it('thins the samples of a very long brew instead of growing without bound', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    for (let i = 0; i <= MAX_SAMPLES; i++) tracker.observe(brewing('p1'), T0 + 1_000 + i * 5_000)
    const count = tracker.currentBrew?.samples.length ?? 0
    expect(count).toBeLessThanOrEqual(MAX_SAMPLES)
    expect(count).toBeGreaterThan(MAX_SAMPLES / 2 - 1)
  })
})

describe('BrewTracker cleaning cycles', () => {
  const cleaning = (extra: Partial<Device> = {}): Device => ({ id: 'd', cleaning: true, brewing: true, state: null, heaterOn: true, pumpOn: true, totalBrewingCycles: 70, totalWaterVolumeL: 63_570, brewingWaterVolumeMl: 1500, ...extra })

  it('tracks a descale from idle to idle, with the counters\' movement and the water figure', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70, { totalWaterVolumeL: 63_570 }), T0)
    const started = tracker.observe(cleaning(), T0 + 60_000)
    expect(started.map(e => e.type)).toEqual(['cleaningStarted', 'cleaningSample'])
    expect(tracker.currentCleaningCycle).toMatchObject({ kind: 'clean', startedAt: T0 + 60_000, startOrigin: 'transition', cyclesBefore: 70, waterBefore: 63_570 })
    expect(tracker.currentBrew).toBeNull()
    tracker.observe(cleaning({ heaterOn: false, pumpOn: false }), T0 + 65_000)
    const [done] = tracker.observe(idle(71, { totalWaterVolumeL: 65_070, brewingWaterVolumeMl: 1500 }), T0 + 1_800_000)
    expect(done).toMatchObject({ type: 'cleaningCompleted', record: { kind: 'clean', durationS: 1740, waterMl: 1500, cyclesDelta: 1, waterDeltaMl: 1500, cyclesAfter: 71, observedStart: true } })
    expect((done as { record: { samples: unknown[] } }).record.samples).toHaveLength(2)
    expect(tracker.currentCleaningCycle).toBeNull()
    // The counter rise belonged to the cycle: nothing is inferred afterwards, and the baseline moved on.
    expect(tracker.observe(idle(71), T0 + 1_860_000)).toEqual([])
    expect(tracker.baselineCycles).toBe(71)
  })
  it('believes the brewer\'s start time for a cycle first seen mid-way, up to two hours back', () => {
    const tracker = new BrewTracker()
    const [event] = tracker.observe(cleaning({ brewStartTime: String((T0 - 90 * 60_000) / 1000) }), T0)
    expect(event).toMatchObject({ type: 'cleaningStarted', cleaning: { startedAt: T0 - 90 * 60_000, startOrigin: 'device' } })
    const stale = new BrewTracker().observe(cleaning({ brewStartTime: String((T0 - 3 * 3_600_000) / 1000) }), T0)
    expect(stale[0]).toMatchObject({ type: 'cleaningStarted', cleaning: { startedAt: T0, startOrigin: 'first-read' } })
  })
  it('never starts a brew from the brewing flag while a cycle runs, even without a state field', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(cleaning({ state: undefined }), T0 + 1_000)
    expect(tracker.currentBrew).toBeNull()
    expect(tracker.currentCleaningCycle?.kind).toBe('clean')
    const [event] = tracker.observe(idle(70), T0 + 2_000)
    expect(event?.type).toBe('cleaningCompleted')
  })
  it('closes a brew that was running when a cycle starts, and a cycle that runs for six hours', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('p1'), T0 + 1_000)
    const events = tracker.observe(cleaning(), T0 + 2_000)
    expect(events.map(e => e.type)).toEqual(['completed', 'cleaningStarted', 'cleaningSample'])
    const stuck = tracker.observe(cleaning(), T0 + 2_000 + MAX_CLEANING_MS + 1)
    expect(stuck.map(e => e.type)).toEqual(['cleaningCompleted', 'cleaningStarted', 'cleaningSample'])
  })
  it('treats a rinse as its own kind', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    const [event] = tracker.observe(cleaning({ cleaning: false, rinsing: true }), T0 + 1_000)
    expect(event).toMatchObject({ type: 'cleaningStarted', cleaning: { kind: 'rinse' } })
  })
})

describe('targetOf', () => {
  const recipe = { title: 'Medium Roast', bloomEnabled: true, bloomTemperature: 96, overallTemperature: 94, ssPulseTemperatures: [96, 95, 94], batchPulseTemperatures: [93, 92] }

  it('takes the pulse temperatures of the basket that is in', () => {
    expect(targetOf(recipe, true)).toEqual({ bloomC: 96, pulsesC: [96, 95, 94], overallC: 94 })
    expect(targetOf(recipe, false)).toEqual({ bloomC: 96, pulsesC: [93, 92], overallC: 94 })
  })
  it('leaves the bloom out when the recipe has none, and falls back to the first pulse for the overall', () => {
    expect(targetOf({ ...recipe, bloomEnabled: false, overallTemperature: null }, false)).toEqual({ bloomC: null, pulsesC: [93, 92], overallC: 93 })
  })
  it('is null when there is nothing to show, or no profile at all', () => {
    expect(targetOf({ title: 'Bare' }, false)).toBeNull()
    expect(targetOf(undefined, false)).toBeNull()
  })
})

describe('BrewTracker targets', () => {
  it('copies the recipe onto the brew when it starts, for the basket that is in', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('b', { singleBrewBasketPresent: false, batchBrewBasketPresent: true }), T0 + 1_000, titles)
    expect(tracker.currentBrew?.target).toEqual({ bloomC: 96, pulsesC: [93, 92], overallC: 94 })
    const [done] = tracker.observe(idle(71), T0 + 300_000, titles)
    expect(done).toMatchObject({ type: 'completed', record: { target: { pulsesC: [93, 92] } } })
  })
  it('leaves the target off a brew whose profile it does not know', () => {
    const tracker = new BrewTracker()
    tracker.observe(idle(70), T0)
    tracker.observe(brewing('b'), T0 + 1_000)
    expect(tracker.currentBrew?.target).toBeNull()
    const [done] = tracker.observe(idle(71), T0 + 300_000)
    expect(done && 'record' in done ? (done.record as { target?: unknown }).target : 'no event').toBeUndefined()
  })
})
