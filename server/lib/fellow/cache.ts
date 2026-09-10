interface Entry { value: unknown, expiresAt: number }

/** Tiny in-memory cache with one TTL for every key. `now` is injectable for tests. */
export class TtlCache {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set<T>(key: string, value: T): T {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
    return value
  }

  clear(): void {
    this.entries.clear()
  }
}
