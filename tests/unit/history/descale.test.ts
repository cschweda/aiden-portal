import { describe, expect, it } from 'vitest'
import { descaleStatus } from '../../../server/lib/history'
import type { BrewRecord } from '../../../server/lib/history'

const NOW = 1_789_200_000_000
const DAY = 86_400_000
const device = { id: 'd', totalBrewingCycles: 70, totalWaterVolumeL: 63_570 }
const thresholds = { litres: 60, brews: 0 }
const brew = (startedAt: number, waterMl = 900): BrewRecord => ({ id: `b${startedAt}`, startedAt, endedAt: startedAt + 300_000, durationS: 300, waterMl, profileId: null, profileTitle: null, observed: true, counted: true, cyclesAfter: null, samples: [] })

describe('descaleStatus', () => {
  it('counts from the brewer\'s lifetime totals until the first mark, and reads due when over the threshold', () => {
    const status = descaleStatus(null, device, thresholds, [], NOW)
    expect(status).toMatchObject({ markedAt: null, brewsSince: 70, litresSince: 63.57, level: 'red', dueAt: NOW, dueInDays: 0, thresholdBrews: null })
    expect(status.ratio).toBeCloseTo(63.57 / 60, 6)
  })
  it('counts from the marker and estimates the due date from the log\'s pace', () => {
    const marker = { at: NOW - 20 * DAY, brews: 60, waterMl: 55_570 }
    const records = [brew(NOW - 10 * DAY), brew(NOW - 7 * DAY), brew(NOW - 4 * DAY), brew(NOW - DAY)]
    const status = descaleStatus(marker, device, thresholds, records, NOW)
    expect(status).toMatchObject({ brewsSince: 10, litresSince: 8, level: 'ok', paceBasis: 'log' })
    expect(status.litresPerDay).toBeCloseTo(0.36, 6)
    expect(status.dueInDays).toBeCloseTo(52 / 0.36, 4)
    expect(status.dueAt).toBeCloseTo(NOW + (52 / 0.36) * DAY, -3)
  })
  it('falls back to the pace since the marker when the log is too thin', () => {
    const marker = { at: NOW - 10 * DAY, brews: 60, waterMl: 55_570 }
    const status = descaleStatus(marker, device, thresholds, [], NOW)
    expect(status.paceBasis).toBe('marker')
    expect(status.litresPerDay).toBeCloseTo(0.8, 6)
    expect(status.dueInDays).toBeCloseTo(65, 4)
  })
  it('gives no estimate without a pace, and turns amber at eighty percent', () => {
    const marker = { at: NOW - DAY, brews: 60, waterMl: 13_570 }
    const status = descaleStatus(marker, device, thresholds, [], NOW)
    expect(status).toMatchObject({ litresSince: 50, level: 'amber', litresPerDay: null, paceBasis: null, dueAt: null, dueInDays: null })
  })
  it('applies a brew-count threshold when one is set', () => {
    const marker = { at: NOW - DAY, brews: 60, waterMl: 55_570 }
    const status = descaleStatus(marker, device, { litres: 60, brews: 12 }, [], NOW)
    expect(status.thresholdBrews).toBe(12)
    expect(status.ratio).toBeCloseTo(10 / 12, 6)
    expect(status.level).toBe('amber')
  })
  it('leaves out what cleaning cycles since the mark added to the counters', () => {
    const marker = { at: NOW - 20 * DAY, brews: 60, waterMl: 55_570 }
    const cycle = (endedAt: number) => ({ id: `c${endedAt}`, kind: 'clean' as const, startedAt: endedAt - 800_000, endedAt, durationS: 800, waterMl: 1500, cyclesDelta: 1, waterDeltaMl: 1500, cyclesAfter: null, observedStart: true, samples: [] })
    const status = descaleStatus(marker, { ...device, totalBrewingCycles: 73, totalWaterVolumeL: 68_042 }, thresholds, [], NOW, [cycle(NOW - 30 * DAY), cycle(NOW - DAY), cycle(NOW - DAY + 1000)])
    expect(status).toMatchObject({ cleaningBrews: 2, cleaningMl: 3000, brewsSince: 11, litresSince: 9.472 })
  })
  it('never goes negative after a brewer swap, and is unknown without totals', () => {
    expect(descaleStatus({ at: NOW, brews: 500, waterMl: 900_000 }, device, thresholds, [], NOW)).toMatchObject({ brewsSince: 0, litresSince: 0, level: 'ok' })
    expect(descaleStatus(null, { id: 'd' }, thresholds, [], NOW)).toMatchObject({ brewsSince: null, litresSince: null, ratio: null, level: 'unknown', dueAt: null })
  })
})
