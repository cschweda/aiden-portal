import { FellowError } from '../lib/fellow'
import type { Device } from '../lib/fellow/schemas'
import { BrewTracker, computeStats, descaleStatus, HistoryStore } from '../lib/history'
import type { BrewRecord, CurrentBrew, DescaleMarker, DescaleStatus, HistoryStats } from '../lib/history'
import { type AppConfig, getConfig } from './config'
import { useFellowClient } from './fellow-client'
import { useLogger } from './logger'

export interface PollerState {
  enabled: boolean
  running: boolean
  idlePollSeconds: number
  brewPollSeconds: number
  lastPollAt: number | null
  lastError: string | null
  failures: number
}

/** A brew record without its samples, for lists. */
export type BrewSummary = Omit<BrewRecord, 'samples'> & { sampleCount: number }

export interface HistorySnapshot {
  stats: HistoryStats
  descale: DescaleStatus
  descaleHistory: DescaleMarker[]
  /** The brew running now, with its samples so far. */
  current: CurrentBrew | null
  /** The newest brew that has a trace. */
  lastTraced: BrewRecord | null
  recent: BrewSummary[]
  polling: PollerState
  skippedLines: number
}

/** After this long a brew is sampled at the idle rate: cold-brew steeps run for hours. */
const LONG_BREW_MS = 20 * 60_000
const FIRST_POLL_DELAY_MS = 2_000
const MAX_BACKOFF_MS = 15 * 60_000

export function summarise(record: BrewRecord): BrewSummary {
  const { samples, ...rest } = record
  return { ...rest, sampleCount: samples.length }
}

/**
 * The process-wide brew history: the store on disk, the tracker fed by a poll loop, and the answers the routes give.
 * Polling errors back off exponentially and are logged once per streak.
 */
export class HistoryService {
  readonly store: HistoryStore
  readonly tracker: BrewTracker
  readonly polling: PollerState
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private readonly titles = new Map<string, string>()
  private lastDevice: Device | null = null

  constructor(private readonly config: AppConfig) {
    this.store = new HistoryStore({ directory: config.history.directory })
    this.store.load()
    this.tracker = new BrewTracker({ baselineCycles: this.store.lastBrew?.cyclesAfter ?? null })
    this.polling = {
      enabled: config.history.enabled,
      running: false,
      idlePollSeconds: config.history.idlePollSeconds,
      brewPollSeconds: config.history.brewPollSeconds,
      lastPollAt: null,
      lastError: null,
      failures: 0,
    }
  }

  /** Starts the loop; a second call is a no-op. */
  start(): void {
    if (this.polling.running) return
    this.polling.running = true
    void this.refreshTitles()
    this.schedule(FIRST_POLL_DELAY_MS)
  }

  stop(): void {
    this.polling.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Reads again soon, so a brew the app just started is traced from its first seconds rather than the next idle tick. */
  pokeSoon(delayMs = 2_000): void {
    if (!this.polling.running || this.inFlight) return
    if (this.timer) clearTimeout(this.timer)
    this.schedule(delayMs)
  }

  /** One read of the brewer through the tracker. Exposed for tests and for the routes' snapshot after a mutation. */
  async poll(now: number = Date.now()): Promise<Device> {
    const device = await useFellowClient().getDevice({ fresh: true })
    this.observe(device, now)
    return device
  }

  /** The brewer as last observed, so the history can still be shown while Fellow is unreachable. */
  get lastObservedDevice(): Device | null {
    return this.lastDevice
  }

  observe(device: Device, now: number): void {
    this.lastDevice = device
    const logger = useLogger()
    for (const event of this.tracker.observe(device, now, id => this.titles.get(id))) {
      if (event.type === 'started') {
        logger.info({ profileId: event.brew.profileId, profileTitle: event.brew.profileTitle }, 'Brew started')
        if (event.brew.profileId && !event.brew.profileTitle) void this.refreshTitles(event.brew)
      }
      else if (event.type === 'completed' || event.type === 'inferred') {
        this.store.appendBrew(event.record)
        logger.info({
          brewId: event.record.id,
          observed: event.record.observed,
          counted: event.record.counted,
          durationS: event.record.durationS,
          waterMl: event.record.waterMl,
          profileTitle: event.record.profileTitle,
        }, event.type === 'completed' ? 'Brew logged' : 'Brew inferred from the brew counter')
      }
    }
    this.polling.lastPollAt = now
  }

  snapshot(device: Device, now: number = Date.now()): HistorySnapshot {
    const records = this.store.brews
    const descale = this.store.descaleState
    return {
      stats: computeStats(records, now),
      descale: descaleStatus(descale.current, device, this.thresholds(), records, now),
      descaleHistory: descale.history,
      current: this.tracker.currentBrew,
      lastTraced: [...records].reverse().find(r => r.samples.length > 0) ?? null,
      recent: records.slice(-50).reverse().map(summarise),
      polling: { ...this.polling },
      skippedLines: this.store.skippedLines,
    }
  }

  brew(id: string): BrewRecord | null {
    return this.store.brews.find(r => r.id === id) ?? null
  }

  markDescaled(device: Device, now: number = Date.now()): DescaleStatus {
    const marker: DescaleMarker = {
      at: now,
      brews: typeof device.totalBrewingCycles === 'number' ? device.totalBrewingCycles : null,
      waterMl: typeof device.totalWaterVolumeL === 'number' ? device.totalWaterVolumeL : null,
    }
    const state = this.store.markDescaled(marker)
    useLogger().info({ action: 'descale.mark', brews: marker.brews, waterMl: marker.waterMl }, 'Marked descaled')
    return descaleStatus(state.current, device, this.thresholds(), this.store.brews, now)
  }

  private thresholds() {
    return { litres: this.config.maintenance.descaleAfterLitres, brews: this.config.maintenance.descaleAfterBrews }
  }

  private schedule(delayMs: number): void {
    if (!this.polling.running) return
    this.timer = setTimeout(() => {
      this.inFlight = this.tick().finally(() => (this.inFlight = undefined))
    }, delayMs)
    // A pending poll must never keep the process alive on its own.
    this.timer.unref?.()
  }

  private async tick(): Promise<void> {
    const logger = useLogger()
    let delayMs = this.config.history.idlePollSeconds * 1000
    try {
      await this.poll()
      if (this.polling.failures > 0) logger.info({ failures: this.polling.failures }, 'History polling recovered')
      this.polling.failures = 0
      this.polling.lastError = null
      const current = this.tracker.currentBrew
      if (current) {
        const seconds = Date.now() - current.startedAt > LONG_BREW_MS ? this.config.history.idlePollSeconds : this.config.history.brewPollSeconds
        delayMs = seconds * 1000
      }
    }
    catch (error) {
      this.polling.failures += 1
      this.polling.lastError = error instanceof FellowError ? error.code : error instanceof Error ? error.message : String(error)
      const fields = { code: this.polling.lastError, failures: this.polling.failures }
      if (this.polling.failures === 1) logger.warn(fields, 'History poll failed; backing off')
      else logger.debug(fields, 'History poll still failing')
      delayMs = Math.min(this.config.history.idlePollSeconds * 1000 * 2 ** Math.min(this.polling.failures, 6), MAX_BACKOFF_MS)
    }
    this.schedule(delayMs)
  }

  private async refreshTitles(brew?: CurrentBrew): Promise<void> {
    try {
      for (const profile of await useFellowClient().getProfiles()) this.titles.set(profile.id, profile.title)
      if (brew?.profileId) brew.profileTitle = this.titles.get(brew.profileId) ?? brew.profileTitle
    }
    catch {
      // Titles are decoration; the id is always recorded.
    }
  }
}

let instance: HistoryService | undefined

export function useHistory(): HistoryService {
  instance ??= new HistoryService(getConfig())
  return instance
}

export function resetHistoryForTests(): void {
  instance?.stop()
  instance = undefined
}
