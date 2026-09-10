import { z } from 'zod'
import { parseBrewLink } from './brew-link'
import { TtlCache } from './cache'
import { FellowError } from './errors'
import { FellowHttp, type FellowHttpOptions, type HttpMethod } from './http'
import { type FellowLogger, noopLogger } from './logger'
import {
  DEVICE_INVENTORY_FIELDS,
  type Device,
  DeviceSchema,
  type Profile,
  ProfileIdSchema,
  ProfileInputSchema,
  ProfileSchema,
  type Schedule,
  ScheduleIdSchema,
  ScheduleInputSchema,
  SchedulePatchSchema,
  ScheduleSchema,
} from './schemas'
import { matchProfileByTitle, type TitleLookupOptions } from './similarity'
import { stripServerFields } from './strip'

export interface FellowClientOptions extends FellowHttpOptions {
  /** Log mutations instead of sending them. Reads still go to Fellow. */
  dryRun?: boolean
  cacheTtlMs?: number
  now?: () => number
}

export interface ReadOptions {
  /** Skip the read cache for this call. */
  fresh?: boolean
}

const DEVICES_PATH = '/devices?dataType=real'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Zod's lenient `.catch(undefined)` leaves own properties set to undefined; drop them so spreads do not clobber. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

/** The detail route may omit the id; everything else is as lenient as the list schema. */
const DeviceDetailSchema = DeviceSchema.partial({ id: true })
const ProfileListSchema = z.array(ProfileSchema)
const ScheduleListSchema = z.array(ScheduleSchema)

/** Typed facade over FellowHttp: one brewer per account, cached list reads, dry-run support. */
export class FellowClient {
  readonly dryRun: boolean
  private readonly http: FellowHttp
  private readonly cache: TtlCache
  private readonly logger: FellowLogger
  private readonly now: () => number
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private knownDeviceId: string | null = null
  /** Identity fields from the device list; the detail route omits them, so they are merged back in. */
  private inventory: Partial<Device> = {}
  /** Bumped by every mutation so that a read still in flight cannot re-cache pre-mutation data. */
  private generation = 0

  constructor(options: FellowClientOptions) {
    this.dryRun = options.dryRun ?? false
    this.logger = options.logger ?? noopLogger
    this.now = options.now ?? Date.now
    this.http = new FellowHttp(options)
    this.cache = new TtlCache(options.cacheTtlMs ?? 30_000, this.now)
  }

  async getDevice(options: ReadOptions = {}): Promise<Device> {
    return this.cachedRead('device', options, () =>
      this.knownDeviceId ? this.fetchDeviceDetail(this.knownDeviceId) : this.discoverDevice(),
    )
  }

  /** Account-wide list; the reference clients assume a single brewer per account and take the first one. */
  private async discoverDevice(): Promise<Device> {
    const devices = await this.http.request<unknown>('GET', DEVICES_PATH)
    const parsed = z.array(DeviceSchema).safeParse(devices)
    const first = parsed.success ? parsed.data[0] : undefined
    if (!first) {
      throw new FellowError('fellow_bad_response', 'Fellow returned no usable device for this account', { body: devices })
    }
    this.knownDeviceId = first.id
    this.inventory = compact(Object.fromEntries(DEVICE_INVENTORY_FIELDS.map(key => [key, first[key]])))
    return compact(first)
  }

  /**
   * The lighter per-device route used once the id is known. Live state comes from here; identity from the list.
   * A 404 means the brewer left the account, so discovery runs again.
   */
  private async fetchDeviceDetail(deviceId: string): Promise<Device> {
    let raw: unknown
    try {
      raw = await this.http.request<unknown>('GET', `/devices/${deviceId}?dataType=real`)
    }
    catch (error) {
      if (error instanceof FellowError && error.status === 404) {
        this.logger.warn({ deviceId }, 'Brewer is no longer listed under this id; rediscovering')
        this.knownDeviceId = null
        this.inventory = {}
        return this.discoverDevice()
      }
      throw error
    }
    const detail = DeviceDetailSchema.safeParse(raw)
    if (!detail.success || (detail.data.id !== undefined && detail.data.id !== deviceId)) {
      throw new FellowError('fellow_bad_response', `Fellow's device detail did not describe brewer ${deviceId}`, { body: raw })
    }
    return { ...this.inventory, ...compact(detail.data), id: deviceId }
  }

  async getProfiles(options: ReadOptions = {}): Promise<Profile[]> {
    return this.cachedRead('profiles', options, async () => {
      const raw = await this.http.request<unknown>('GET', `/devices/${await this.deviceId()}/profiles`)
      return this.parseOrBadResponse(ProfileListSchema, raw, 'profile list') as Profile[]
    })
  }

  async getSchedules(options: ReadOptions = {}): Promise<Schedule[]> {
    return this.cachedRead('schedules', options, async () => {
      const raw = await this.http.request<unknown>('GET', `/devices/${await this.deviceId()}/schedules`)
      return this.parseOrBadResponse(ScheduleListSchema, raw, 'schedule list') as Schedule[]
    })
  }

  async createProfile(input: Record<string, unknown>): Promise<Profile> {
    const body = ProfileInputSchema.parse(stripServerFields(input))
    const path = `/devices/${await this.deviceId()}/profiles`
    const response = await this.mutate('POST', path, body, () => ({
      ...body,
      id: this.nextDryRunId('p'),
      createdAt: new Date(this.now()).toISOString(),
      isDefaultProfile: false,
    }))
    return this.parseOrBadResponse(ProfileSchema, response, 'create profile') as Profile
  }

  // UNVERIFIED: the reference client ignores the PATCH response body, so its shape is unknown and nothing is returned.
  async updateProfile(profileId: string, input: Record<string, unknown>): Promise<void> {
    ProfileIdSchema.parse(profileId)
    const body = ProfileInputSchema.parse(stripServerFields(input))
    await this.mutate('PATCH', `/devices/${await this.deviceId()}/profiles/${profileId}`, body, () => ({ ...body, id: profileId }))
  }

  async deleteProfile(profileId: string): Promise<void> {
    ProfileIdSchema.parse(profileId)
    await this.mutate('DELETE', `/devices/${await this.deviceId()}/profiles/${profileId}`, undefined, () => undefined)
  }

  async generateShareLink(profileId: string): Promise<string> {
    ProfileIdSchema.parse(profileId)
    const response = await this.mutate(
      'POST',
      `/devices/${await this.deviceId()}/profiles/${profileId}/share`,
      undefined,
      () => ({ link: 'https://brew.link/p/dryrun' }),
    )
    const link = (response as { link?: unknown } | undefined)?.link
    if (typeof link !== 'string') {
      throw new FellowError('fellow_bad_response', 'Fellow did not return a share link', { body: response })
    }
    return link
  }

  /** The shared profile with server-side fields removed. Not validated: pass it to createProfile for that. */
  async fetchSharedProfile(linkOrId: string): Promise<Record<string, unknown>> {
    const { id, dropType } = parseBrewLink(linkOrId)
    const shared = await this.http.request<unknown>('GET', `/shared/${dropType}/${id}`)
    if (!isPlainObject(shared)) {
      throw new FellowError('fellow_bad_response', `Shared profile ${id} was not an object`, { body: shared })
    }
    return stripServerFields(shared)
  }

  async createProfileFromLink(linkOrId: string): Promise<Profile> {
    return this.createProfile(await this.fetchSharedProfile(linkOrId))
  }

  async findProfileByTitle(title: string, options: TitleLookupOptions = {}): Promise<Profile | undefined> {
    return matchProfileByTitle(await this.getProfiles(), title, options)
  }

  async createSchedule(input: Record<string, unknown>): Promise<Schedule> {
    const body = ScheduleInputSchema.parse(input)
    const response = await this.mutate(
      'POST',
      `/devices/${await this.deviceId()}/schedules`,
      body,
      () => ({ ...body, id: this.nextDryRunId('s') }),
    )
    return this.parseOrBadResponse(ScheduleSchema, response, 'create schedule') as Schedule
  }

  // UNVERIFIED: response body shape unknown (the reference client returns it raw), so nothing is returned.
  async updateSchedule(scheduleId: string, patch: Record<string, unknown>): Promise<void> {
    ScheduleIdSchema.parse(scheduleId)
    const body = SchedulePatchSchema.parse(patch)
    await this.mutate('PATCH', `/devices/${await this.deviceId()}/schedules/${scheduleId}`, body, () => ({ ...body, id: scheduleId }))
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    ScheduleIdSchema.parse(scheduleId)
    await this.mutate('DELETE', `/devices/${await this.deviceId()}/schedules/${scheduleId}`, undefined, () => undefined)
  }

  // UNVERIFIED: the reference client sends { [setting]: value } but never names a setting. Not exposed by any route in Phase 1.
  async adjustSetting(setting: string, value: unknown): Promise<unknown> {
    const body = { [setting]: value }
    return this.mutate('PATCH', `/devices/${await this.deviceId()}`, body, () => body)
  }

  /**
   * Starts the brewer's configured Instant Brew recipe. Check `canStartBrew(await getDevice({ fresh: true }))`
   * first; Fellow does not validate readiness for you.
   * UNVERIFIED: the response is an object of unknown shape.
   */
  async startBrew(): Promise<Record<string, unknown>> {
    const path = `/devices/${await this.deviceId()}/start?confirm=true`
    const response = await this.mutate('PATCH', path, undefined, () => ({ dryRun: true }))
    if (!isPlainObject(response)) {
      throw new FellowError('fellow_bad_response', 'Fellow returned an unexpected remote-start response', { body: response })
    }
    return response
  }

  refreshAccessToken(): Promise<string> {
    return this.http.refreshAccessToken()
  }

  private dryRunSequence = 9000

  /** Sends a mutation, or in dry-run mode logs it and returns `fake()`. Either way the read cache is dropped. */
  private async mutate<T>(method: Exclude<HttpMethod, 'GET'>, path: string, body: unknown, fake: () => T): Promise<T> {
    let result: T
    if (this.dryRun) {
      this.logger.info({ dryRun: true, method, path, body }, 'DRY RUN: Fellow mutation suppressed')
      result = fake()
    }
    else {
      result = await this.http.request<T>(method, path, body)
    }
    this.generation += 1
    this.cache.clear()
    return result
  }

  private nextDryRunId(prefix: 'p' | 's'): string {
    this.dryRunSequence += 1
    return `${prefix}${this.dryRunSequence}`
  }

  private parseOrBadResponse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new FellowError('fellow_bad_response', `Fellow's ${what} response was not the expected shape`, { body: value })
    }
    return parsed.data
  }

  private async deviceId(): Promise<string> {
    return this.knownDeviceId ?? (await this.getDevice()).id
  }

  /** Cache hit → value; otherwise one shared load per key, so concurrent callers do not each hit Fellow. */
  private async cachedRead<T>(key: string, { fresh = false }: ReadOptions, load: () => Promise<T>): Promise<T> {
    if (!fresh) {
      const hit = this.cache.get<T>(key)
      if (hit !== undefined) {
        this.logger.debug({ key }, 'Fellow read served from cache')
        return hit
      }
      const pending = this.inFlight.get(key) as Promise<T> | undefined
      if (pending) return pending
    }
    const generation = this.generation
    const loading = load()
      .then((value) => {
        // A mutation that landed while this read was in flight makes the result stale: return it, do not cache it.
        if (this.generation === generation) this.cache.set(key, value)
        return value
      })
      .finally(() => {
        if (this.inFlight.get(key) === loading) this.inFlight.delete(key)
      })
    this.inFlight.set(key, loading)
    return loading
  }
}
