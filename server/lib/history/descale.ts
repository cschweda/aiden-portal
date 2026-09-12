import type { Device } from '../fellow/schemas'
import { litresPerDay } from './stats'
import { DAY_MS } from './time'
import type { BrewRecord, CleaningRecord, DescaleMarker } from './types'

export interface DescaleThresholds {
  litres: number
  /** 0 turns the brew-count threshold off. */
  brews: number
}

export type DescaleLevel = 'ok' | 'amber' | 'red' | 'unknown'

export interface DescaleStatus {
  markedAt: number | null
  /** What cleaning cycles since the mark added to the brewer's counters, already left out of the figures below. */
  cleaningBrews: number
  cleaningMl: number
  brewsSince: number | null
  litresSince: number | null
  thresholdLitres: number
  thresholdBrews: number | null
  /** Progress towards the nearer threshold; 1 means due. */
  ratio: number | null
  level: DescaleLevel
  litresPerDay: number | null
  /** Where the pace came from: the brew log, or the litres since the marker. */
  paceBasis: 'log' | 'marker' | null
  dueAt: number | null
  dueInDays: number | null
}

/**
 * Brews and litres since the marker (or since the brewer's first day when there is none), the level against the
 * thresholds, and an estimate of when the litre threshold will be reached at the recent pace.
 */
export function descaleStatus(marker: DescaleMarker | null, device: Device, thresholds: DescaleThresholds, records: readonly BrewRecord[], now: number = Date.now(), cleanings: readonly CleaningRecord[] = []): DescaleStatus {
  const cycles = typeof device.totalBrewingCycles === 'number' ? device.totalBrewingCycles : null
  const waterMl = typeof device.totalWaterVolumeL === 'number' ? device.totalWaterVolumeL : null
  // The Aiden counts each phase of a descale program as a brew and adds its water to the total; those are not scale.
  const sinceMark = cleanings.filter(c => c.endedAt > (marker?.at ?? 0))
  const cleaningBrews = sinceMark.reduce((total, c) => total + Math.max(0, c.cyclesDelta ?? 0), 0)
  const cleaningMl = sinceMark.reduce((total, c) => total + Math.max(0, c.waterDeltaMl ?? 0), 0)
  const brewsSince = cycles === null ? null : Math.max(0, cycles - (marker?.brews ?? 0) - cleaningBrews)
  const litresSince = waterMl === null ? null : Math.max(0, waterMl - (marker?.waterMl ?? 0) - cleaningMl) / 1000
  const thresholdBrews = thresholds.brews > 0 ? thresholds.brews : null

  let ratio: number | null = null
  if (litresSince !== null) {
    ratio = litresSince / thresholds.litres
    if (thresholdBrews !== null && brewsSince !== null) ratio = Math.max(ratio, brewsSince / thresholdBrews)
  }
  const level: DescaleLevel = ratio === null ? 'unknown' : ratio >= 1 ? 'red' : ratio >= 0.8 ? 'amber' : 'ok'

  let pace = litresPerDay(records, now)
  let paceBasis: DescaleStatus['paceBasis'] = pace === null ? null : 'log'
  if (pace === null && marker && litresSince !== null) {
    const days = (now - marker.at) / DAY_MS
    if (days >= 3 && litresSince > 0) {
      pace = litresSince / days
      paceBasis = 'marker'
    }
  }

  let dueAt: number | null = null
  let dueInDays: number | null = null
  if (ratio !== null && ratio >= 1) {
    dueAt = now
    dueInDays = 0
  }
  else if (pace !== null && pace > 0 && litresSince !== null) {
    dueInDays = (thresholds.litres - litresSince) / pace
    dueAt = now + dueInDays * DAY_MS
  }

  return {
    markedAt: marker?.at ?? null,
    cleaningBrews,
    cleaningMl,
    brewsSince,
    litresSince,
    thresholdLitres: thresholds.litres,
    thresholdBrews,
    ratio,
    level,
    litresPerDay: pace,
    paceBasis,
    dueAt,
    dueInDays,
  }
}
