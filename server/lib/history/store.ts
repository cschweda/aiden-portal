import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { CurrentBrew, CurrentCleaning } from './tracker'
import type { BrewRecord, CleaningRecord, DescaleMarker, DescaleState } from './types'

export const BREWS_FILE = 'brews.jsonl'
export const DESCALE_FILE = 'descale.json'
export const CLEANINGS_FILE = 'cleanings.jsonl'
export const SESSION_FILE = 'current.json'

const SampleSchema = z.looseObject({ t: z.number(), phase: z.string(), temperatureC: z.number().optional(), heaterOn: z.boolean().optional(), pumpOn: z.boolean().optional() })
const CleaningSampleSchema = z.looseObject({ t: z.number(), heaterOn: z.boolean().optional(), pumpOn: z.boolean().optional() })
const TargetSchema = z.looseObject({ bloomC: z.number().nullable(), pulsesC: z.array(z.number()), overallC: z.number().nullable() })
const OriginSchema = z.enum(['transition', 'device', 'first-read']).default('first-read')
const RecordSchema = z.looseObject({
  id: z.string().min(1),
  startedAt: z.number(),
  endedAt: z.number(),
  durationS: z.number().nullable().default(null),
  waterMl: z.number().nullable().default(null),
  profileId: z.string().nullable().default(null),
  profileTitle: z.string().nullable().default(null),
  observed: z.boolean().default(false),
  counted: z.boolean().default(false),
  cyclesAfter: z.number().nullable().default(null),
  target: TargetSchema.optional(),
  samples: z.array(SampleSchema).default([]),
})
const CleaningSchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(['clean', 'rinse']).default('clean'),
  startedAt: z.number(),
  endedAt: z.number(),
  durationS: z.number().nullable().default(null),
  waterMl: z.number().nullable().default(null),
  cyclesDelta: z.number().nullable().default(null),
  waterDeltaMl: z.number().nullable().default(null),
  cyclesAfter: z.number().nullable().default(null),
  observedStart: z.boolean().default(false),
  samples: z.array(CleaningSampleSchema).default([]),
})
const CurrentBrewSchema = z.looseObject({
  id: z.string().min(1),
  startedAt: z.number(),
  startOrigin: OriginSchema,
  profileId: z.string().nullable().default(null),
  profileTitle: z.string().nullable().default(null),
  target: TargetSchema.nullable().default(null),
  cyclesBefore: z.number().nullable().default(null),
  samples: z.array(SampleSchema).default([]),
})
const CurrentCleaningSchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(['clean', 'rinse']).default('clean'),
  startedAt: z.number(),
  startOrigin: OriginSchema,
  cyclesBefore: z.number().nullable().default(null),
  waterBefore: z.number().nullable().default(null),
  samples: z.array(CleaningSampleSchema).default([]),
})
const SessionSchema = z.looseObject({
  at: z.number(),
  brew: CurrentBrewSchema.nullable().default(null),
  cleaning: CurrentCleaningSchema.nullable().default(null),
})
const MarkerSchema = z.looseObject({ at: z.number(), brews: z.number().nullable().default(null), waterMl: z.number().nullable().default(null) })
const DescaleSchema = z.looseObject({ current: MarkerSchema.nullable().default(null), history: z.array(MarkerSchema).default([]) })

/**
 * What a running process is in the middle of, and would otherwise lose when it exits: a brew or cleaning cycle
 * whose samples are in no log yet.
 */
export interface SessionState {
  /** When this was written. */
  at: number
  brew: CurrentBrew | null
  cleaning: CurrentCleaning | null
}

export interface HistoryStoreOptions {
  directory: string
  /** Records kept in memory (the file keeps everything). */
  keepInMemory?: number
}

/**
 * One directory holding an append-only brew log (`brews.jsonl`), a small descale marker (`descale.json`), and the
 * state a restart would otherwise lose (`current.json`).
 * A directory the store creates is owner-only, as are both files; an existing directory is left as it is and
 * reported through `directoryIsShared`. A corrupt line is skipped and counted, never fatal. A directory that
 * cannot be created or read leaves the store empty with `loadError` set; writes then throw.
 */
export class HistoryStore {
  readonly directory: string
  private readonly keep: number
  private records: BrewRecord[] = []
  private cleaningRecords: CleaningRecord[] = []
  private descale: DescaleState = { current: null, history: [] }
  private skipped = 0
  private loaded = false
  private shared = false
  private error: string | null = null

  constructor(options: HistoryStoreOptions) {
    this.directory = options.directory
    this.keep = options.keepInMemory ?? 2000
  }

  load(): void {
    this.loaded = true
    this.error = null
    this.records = []
    this.cleaningRecords = []
    this.descale = { current: null, history: [] }
    this.skipped = 0
    try {
      const existed = existsSync(this.directory)
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      const mode = statSync(this.directory).mode & 0o777
      this.shared = existed && (mode & 0o077) !== 0
      this.readBrews()
      this.readCleanings()
      this.readDescale()
    }
    catch (caught) {
      this.error = caught instanceof Error ? caught.message : String(caught)
    }
  }

  private readBrews(): void {
    const path = join(this.directory, BREWS_FILE)
    if (!existsSync(path)) return
    const records: BrewRecord[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const parsed = RecordSchema.safeParse(JSON.parse(line))
        if (parsed.success) records.push(parsed.data as BrewRecord)
        else this.skipped++
      }
      catch {
        this.skipped++
      }
    }
    this.records = records.slice(-this.keep)
  }

  private readCleanings(): void {
    const path = join(this.directory, CLEANINGS_FILE)
    if (!existsSync(path)) return
    const records: CleaningRecord[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const parsed = CleaningSchema.safeParse(JSON.parse(line))
        if (parsed.success) records.push(parsed.data as CleaningRecord)
        else this.skipped++
      }
      catch {
        this.skipped++
      }
    }
    this.cleaningRecords = records.slice(-200)
  }

  private readDescale(): void {
    const path = join(this.directory, DESCALE_FILE)
    if (!existsSync(path)) return
    try {
      const parsed = DescaleSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      if (parsed.success) this.descale = parsed.data as DescaleState
    }
    catch {
      // An unreadable marker means "never descaled" until the next mark rewrites it.
    }
  }

  /** Why the directory could not be used, or null. */
  get loadError(): string | null {
    this.ensureLoaded()
    return this.error
  }

  /** True when the directory already existed with group or other permission bits set. */
  get directoryIsShared(): boolean {
    this.ensureLoaded()
    return this.shared
  }

  get brews(): readonly BrewRecord[] {
    this.ensureLoaded()
    return this.records
  }

  get lastBrew(): BrewRecord | null {
    this.ensureLoaded()
    return this.records[this.records.length - 1] ?? null
  }

  get cleanings(): readonly CleaningRecord[] {
    this.ensureLoaded()
    return this.cleaningRecords
  }

  /** The brew counter as last recorded by whichever record (brew or cleaning cycle) is newest. */
  get lastKnownCycles(): number | null {
    this.ensureLoaded()
    const candidates = [...this.records, ...this.cleaningRecords].filter(r => r.cyclesAfter !== null).sort((a, b) => a.endedAt - b.endedAt)
    return candidates[candidates.length - 1]?.cyclesAfter ?? null
  }

  get descaleState(): DescaleState {
    this.ensureLoaded()
    return this.descale
  }

  /** Lines in the log that could not be read on the last load. */
  get skippedLines(): number {
    this.ensureLoaded()
    return this.skipped
  }

  appendBrew(record: BrewRecord): void {
    this.assertWritable()
    const path = join(this.directory, BREWS_FILE)
    // A crash mid-append can leave a line without its newline; never let the next record run into it.
    const prefix = endsWithNewline(path) ? '' : '\n'
    appendLine(path, `${prefix}${JSON.stringify(record)}\n`)
    this.records.push(record)
    if (this.records.length > this.keep) this.records.splice(0, this.records.length - this.keep)
  }

  appendCleaning(record: CleaningRecord): void {
    this.assertWritable()
    const path = join(this.directory, CLEANINGS_FILE)
    const prefix = endsWithNewline(path) ? '' : '\n'
    appendLine(path, `${prefix}${JSON.stringify(record)}\n`)
    this.cleaningRecords.push(record)
    if (this.cleaningRecords.length > 200) this.cleaningRecords.splice(0, this.cleaningRecords.length - 200)
  }

  markDescaled(marker: DescaleMarker): DescaleState {
    this.assertWritable()
    const next: DescaleState = { current: marker, history: [...this.descale.history, marker].slice(-50) }
    writeJson(join(this.directory, DESCALE_FILE), next, { flush: true, pretty: true })
    this.descale = next
    return next
  }

  /** What the last process was in the middle of, or null when there is nothing to resume or it cannot be read. */
  readSession(): SessionState | null {
    this.ensureLoaded()
    const path = join(this.directory, SESSION_FILE)
    if (!existsSync(path)) return null
    try {
      const parsed = SessionSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      return parsed.success ? (parsed.data as SessionState) : null
    }
    catch {
      return null
    }
  }

  /** Replaced whole and renamed into place, so a reader never sees half of it. Not flushed: this survives a restart,
   * not a power cut, and it is rewritten every few seconds while a brew runs. */
  writeSession(state: SessionState): void {
    this.assertWritable()
    writeJson(join(this.directory, SESSION_FILE), state)
  }

  clearSession(): void {
    this.assertWritable()
    rmSync(join(this.directory, SESSION_FILE), { force: true })
  }

  private assertWritable(): void {
    this.ensureLoaded()
    if (this.error) throw new Error(`history directory unusable: ${this.error}`)
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load()
  }
}

/**
 * One line, on disk before this returns. A completed brew is the one thing here that cannot be reconstructed, so it
 * is worth the flush: without it an append sits in the operating system's cache and a power cut takes it.
 */
function appendLine(path: string, line: string): void {
  const fd = openSync(path, 'a', 0o600)
  try {
    writeSync(fd, line)
    fsyncSync(fd)
  }
  finally {
    closeSync(fd)
  }
}

/** Written beside the target and renamed over it, so a reader sees either the old file or the new one. */
function writeJson(path: string, value: unknown, options: { flush?: boolean, pretty?: boolean } = {}): void {
  const fd = openSync(`${path}.tmp`, 'w', 0o600)
  try {
    writeSync(fd, JSON.stringify(value, null, options.pretty ? 2 : undefined))
    if (options.flush) fsyncSync(fd)
  }
  finally {
    closeSync(fd)
  }
  renameSync(`${path}.tmp`, path)
}

/** True for a missing or empty file, or one whose last byte is a newline. */
function endsWithNewline(path: string): boolean {
  if (!existsSync(path)) return true
  const size = statSync(path).size
  if (size === 0) return true
  const fd = openSync(path, 'r')
  try {
    const last = Buffer.alloc(1)
    readSync(fd, last, 0, 1, size - 1)
    return last[0] === 0x0A
  }
  finally {
    closeSync(fd)
  }
}
