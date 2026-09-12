import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
 * The directory and both files are owner-only. A corrupt line is skipped and counted, never fatal.
 */
export class HistoryStore {
  readonly directory: string
  private readonly keep: number
  private records: BrewRecord[] = []
  private descale: DescaleState = { current: null, history: [] }
  private skipped = 0
  private loaded = false

  constructor(options: HistoryStoreOptions) {
    this.directory = options.directory
    this.keep = options.keepInMemory ?? 2000
  }

  load(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    chmodSync(this.directory, 0o700)
    const brewsPath = join(this.directory, BREWS_FILE)
    const records: BrewRecord[] = []
    let skipped = 0
    if (existsSync(brewsPath)) {
      for (const line of readFileSync(brewsPath, 'utf8').split('\n')) {
        if (line.trim() === '') continue
        try {
          const parsed = RecordSchema.safeParse(JSON.parse(line))
          if (parsed.success) records.push(parsed.data as BrewRecord)
          else skipped++
        }
        catch {
          skipped++
        }
      }
    }
    this.records = records.slice(-this.keep)
    this.skipped = skipped
    const descalePath = join(this.directory, DESCALE_FILE)
    this.descale = { current: null, history: [] }
    if (existsSync(descalePath)) {
      try {
        const parsed = DescaleSchema.safeParse(JSON.parse(readFileSync(descalePath, 'utf8')))
        if (parsed.success) this.descale = parsed.data as DescaleState
      }
      catch {
        // An unreadable marker means "never descaled" until the next mark rewrites it.
      }
    }
    this.loaded = true
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
    return this.skipped
  }

  appendBrew(record: BrewRecord): void {
    this.ensureLoaded()
    appendFileSync(join(this.directory, BREWS_FILE), `${JSON.stringify(record)}\n`, { mode: 0o600 })
    this.records.push(record)
    if (this.records.length > this.keep) this.records.splice(0, this.records.length - this.keep)
  }

  markDescaled(marker: DescaleMarker): DescaleState {
    this.ensureLoaded()
    const next: DescaleState = { current: marker, history: [...this.descale.history, marker].slice(-50) }
    const path = join(this.directory, DESCALE_FILE)
    writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
    this.descale = next
    return next
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load()
  }
}
