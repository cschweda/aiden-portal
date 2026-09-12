import { FellowError } from '../lib/fellow'
import type { Device, Profile } from '../lib/fellow/schemas'
import { BrewTracker, computeStats, descaleStatus, expectBrewDuration, HistoryStore, summarise } from '../lib/history'
import type { CleaningRecord, CurrentBrew, DescaleMarker, DescaleStatus, HistorySnapshot, PollerState } from '../lib/history'
import { type AppConfig, getConfig } from './config'
import { useFellowClient } from './fellow-client'
import { useLogger } from './logger'

/** After this long a brew is sampled at the idle rate: cold-brew steeps run for hours. */
const LONG_BREW_MS = 20 * 60_000
const FIRST_POLL_DELAY_MS = 2_000
const POKE_DELAY_MS = 2_000
const MAX_BACKOFF_MS = 15 * 60_000

/**
 * The process-wide brew history: the store on disk, the tracker fed by a poll loop, and the answers the routes give.
 * Polling errors back off exponentially and are logged once per streak. A store that cannot be written never breaks
 * a poll or a route: the failure is recorded in `polling.lastError` and `snapshot().storeError` instead.
 */
export class HistoryService {
  readonly store: HistoryStore
  readonly tracker: BrewTracker
  readonly polling: PollerState
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private pokeRequested = false
  private storeFailures = 0
  private readonly profiles = new Map<string, Profile>()
  private lastDevice: Device | null = null

  constructor(private readonly config: AppConfig) {
    this.store = new HistoryStore({ directory: config.history.directory })
    this.store.load()
    this.tracker = new BrewTracker({
      baselineCycles: this.store.lastBrew?.cyclesAfter ?? null,
      seedLastBrew: this.store.brews.length === 0 && !this.store.loadError,
    })
    this.polling = {
      enabled: config.history.enabled,
      running: false,
      idlePollSeconds: config.history.idlePollSeconds,
      brewPollSeconds: config.history.brewPollSeconds,
      lastPollAt: null,
      lastError: this.store.loadError,
      failures: 0,
    }
    const logger = useLogger()
    if (this.store.loadError) logger.error({ directory: this.store.directory, err: this.store.loadError }, 'History directory unusable; brews will not be logged')
    else if (this.store.directoryIsShared) logger.warn({ directory: this.store.directory }, 'History directory is readable by other accounts on this machine; consider chmod 700')
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
  pokeSoon(): void {
    if (!this.polling.running) return
    if (this.inFlight) {
      this.pokeRequested = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.schedule(POKE_DELAY_MS)
  }

  /** The brewer as last observed, so the history can still be shown while Fellow is unreachable. */
  get lastObservedDevice(): Device | null {
    return this.lastDevice
  }

  /** One fresh read of the brewer through the tracker, stamped when the answer arrives. */
  async poll(): Promise<Device> {
    const device = await useFellowClient().getDevice({ fresh: true })
    this.observe(device, Date.now())
    return device
  }

  /** Feeds one device read to the tracker. Reads that resolved out of order (older than the last one) are ignored. */
  observe(device: Device, now: number): void {
    if (this.polling.lastPollAt !== null && now < this.polling.lastPollAt) return
    this.lastDevice = device
    this.polling.lastPollAt = now
    const logger = useLogger()
    for (const event of this.tracker.observe(device, now, id => this.profiles.get(id)?.title)) {
      if (event.type === 'started') {
        logger.info({ profileId: event.brew.profileId, profileTitle: event.brew.profileTitle, startOrigin: event.brew.startOrigin }, 'Brew started')
        if (event.brew.profileId && !event.brew.profileTitle) void this.refreshTitles(event.brew)
      }
      else if (event.type === 'completed' || event.type === 'inferred') {
        this.persist(event.record, event.type === 'completed' ? 'Brew logged' : 'Brew inferred from the brew counter')
      }
      else if (event.type === 'cleaningStarted') {
        logger.info({ kind: event.cleaning.kind, startOrigin: event.cleaning.startOrigin }, 'Cleaning cycle started')
      }
      else if (event.type === 'cleaningCompleted') {
        this.persistCleaning(event.record)
      }
    }
  }

  private persistCleaning(record: CleaningRecord): void {
    const logger = useLogger()
    const fields = { cleaningId: record.id, kind: record.kind, durationS: record.durationS, waterMl: record.waterMl, cyclesDelta: record.cyclesDelta, waterDeltaMl: record.waterDeltaMl }
    try {
      this.store.appendCleaning(record)
      logger.info(fields, 'Cleaning cycle logged')
    }
    catch (error) {
      this.storeFailures += 1
      this.polling.lastError = error instanceof Error ? error.message : String(error)
      logger.error({ ...fields, err: this.polling.lastError }, 'Cleaning cycle could not be written to the history file')
    }
  }

  private persist(record: HistorySnapshot['lastTraced'] & object, message: string): void {
    const logger = useLogger()
    const fields = {
      brewId: record.id,
      observed: record.observed,
      counted: record.counted,
      durationS: record.durationS,
      waterMl: record.waterMl,
      profileTitle: record.profileTitle,
    }
    try {
      this.store.appendBrew(record)
      if (this.storeFailures > 0) logger.info({ failures: this.storeFailures }, 'History store writable again')
      this.storeFailures = 0
      logger.info(fields, message)
    }
    catch (error) {
      this.storeFailures += 1
      this.polling.lastError = error instanceof Error ? error.message : String(error)
      const level = this.storeFailures === 1 ? 'error' : 'debug'
      logger[level]({ ...fields, err: this.polling.lastError }, 'Brew could not be written to the history file')
    }
  }

  snapshot(device: Device, now: number = Date.now()): HistorySnapshot {
    const records = this.store.brews
    const descale = this.store.descaleState
    return {
      stats: computeStats(records, now),
      descale: descaleStatus(descale.current, device, this.thresholds(), records, now),
      descaleHistory: descale.history,
      current: this.currentBrewView(),
      lastTraced: [...records].reverse().find(r => r.samples.length > 0) ?? null,
      recent: records.slice(-50).reverse().map(summarise),
      polling: { ...this.polling },
      skippedLines: this.store.skippedLines,
      storeError: this.store.loadError,
      cleanings: this.cleaningSummary(),
    }
  }

  private currentBrewView(): HistorySnapshot['current'] {
    const current = this.tracker.currentBrew
    if (!current) return null
    const device = this.lastDevice
    const expected = expectBrewDuration(this.store.brews, current.profileId, current.profileId ? this.profiles.get(current.profileId) : null, {
      waterMl: device?.brewingWaterVolumeMl ?? device?.ibWaterQuantity ?? null,
      singleServe: device?.singleBrewBasketPresent === true,
    })
    return { ...current, expected }
  }

  private cleaningSummary(): HistorySnapshot['cleanings'] {
    const all = this.store.cleanings
    const durations = all.map(c => c.durationS).filter((d): d is number => d !== null)
    return {
      current: this.tracker.currentCleaningCycle,
      recent: all.slice(-20).reverse(),
      count: all.length,
      averageDurationS: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      lastEndedAt: all[all.length - 1]?.endedAt ?? null,
    }
  }

  brew(id: string): HistorySnapshot['lastTraced'] {
    return this.store.brews.find(r => r.id === id) ?? null
  }

  /** Writes the marker; throws when the store is unusable, which the route turns into a 409. */
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
      if (this.storeFailures === 0) this.polling.lastError = this.store.loadError
      const current = this.tracker.currentBrew ?? this.tracker.currentCleaningCycle
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
    if (this.pokeRequested) {
      this.pokeRequested = false
      delayMs = Math.min(delayMs, POKE_DELAY_MS)
    }
    this.schedule(delayMs)
  }

  private async refreshTitles(brew?: CurrentBrew): Promise<void> {
    try {
      for (const profile of await useFellowClient().getProfiles()) this.profiles.set(profile.id, profile)
      if (brew?.profileId) brew.profileTitle = this.profiles.get(brew.profileId)?.title ?? brew.profileTitle
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
