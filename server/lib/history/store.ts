import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { BrewRecord, DescaleMarker, DescaleState } from './types'

export const BREWS_FILE = 'brews.jsonl'
export const DESCALE_FILE = 'descale.json'

const SampleSchema = z.looseObject({ t: z.number(), phase: z.string(), temperatureC: z.number().optional(), heaterOn: z.boolean().optional(), pumpOn: z.boolean().optional() })
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
  samples: z.array(SampleSchema).default([]),
})
const MarkerSchema = z.looseObject({ at: z.number(), brews: z.number().nullable().default(null), waterMl: z.number().nullable().default(null) })
const DescaleSchema = z.looseObject({ current: MarkerSchema.nullable().default(null), history: z.array(MarkerSchema).default([]) })

export interface HistoryStoreOptions {
  directory: string
  /** Records kept in memory (the file keeps everything). */
  keepInMemory?: number
}

/**
 * One directory holding an append-only brew log (`brews.jsonl`) and a small descale marker (`descale.json`).
 * A directory the store creates is owner-only, as are both files; an existing directory is left as it is and
 * reported through `directoryIsShared`. A corrupt line is skipped and counted, never fatal. A directory that
 * cannot be created or read leaves the store empty with `loadError` set; writes then throw.
 */
export class HistoryStore {
  readonly directory: string
  private readonly keep: number
  private records: BrewRecord[] = []
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
    this.descale = { current: null, history: [] }
    this.skipped = 0
    try {
      const existed = existsSync(this.directory)
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      const mode = statSync(this.directory).mode & 0o777
      this.shared = existed && (mode & 0o077) !== 0
      this.readBrews()
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
    appendFileSync(path, `${prefix}${JSON.stringify(record)}\n`, { mode: 0o600 })
    this.records.push(record)
    if (this.records.length > this.keep) this.records.splice(0, this.records.length - this.keep)
  }

  markDescaled(marker: DescaleMarker): DescaleState {
    this.assertWritable()
    const next: DescaleState = { current: marker, history: [...this.descale.history, marker].slice(-50) }
    const path = join(this.directory, DESCALE_FILE)
    const fd = openSync(`${path}.tmp`, 'w', 0o600)
    try {
      writeSync(fd, JSON.stringify(next, null, 2))
      fsyncSync(fd)
    }
    finally {
      closeSync(fd)
    }
    renameSync(`${path}.tmp`, path)
    this.descale = next
    return next
  }

  private assertWritable(): void {
    this.ensureLoaded()
    if (this.error) throw new Error(`history directory unusable: ${this.error}`)
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load()
  }
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
