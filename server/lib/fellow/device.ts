import type { Device } from './schemas'

/** Firmware from which the Home Assistant integration considers remote brew start reliable. */
export const MIN_REMOTE_START_FIRMWARE = [1, 5, 16] as const

const FIRMWARE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/

export function supportsRemoteStart(device: Device): boolean {
  if (typeof device.firmwareVersion !== 'string') return false
  const match = FIRMWARE_VERSION.exec(device.firmwareVersion.trim())
  if (!match) return false
  const version = [Number(match[1]), Number(match[2]), Number(match[3])]
  for (let i = 0; i < MIN_REMOTE_START_FIRMWARE.length; i++) {
    const have = version[i] ?? 0
    const need = MIN_REMOTE_START_FIRMWARE[i] ?? 0
    if (have !== need) return have > need
  }
  return true
}

/** Live brew activity, preferring the v2 `state` object over the older `brewing` flag. Undefined when unreported. */
export function isBrewing(device: Device): boolean | undefined {
  if (device.state !== undefined) return device.state !== null
  return typeof device.brewing === 'boolean' ? device.brewing : undefined
}

export type BrewPhase = 'idle' | 'bloom' | `pulse ${number}` | 'drip finish' | 'paused' | 'brewing' | 'unknown'

const PHASE_CODES: Record<string, BrewPhase> = { b: 'bloom', d: 'drip finish', pa: 'paused' }

/**
 * The live phase, decoded from the v2 `state` object the way the Home Assistant integration does: `b` bloom,
 * `p1`…`p10` pulse, `d` drip finish, `pa` paused, null idle. A state object with no recognisable code still means a
 * brew is running (see `isBrewing`), so it reads 'brewing'. Without a `state` field the older `brewing` flag decides.
 */
export function brewPhase(device: Device): BrewPhase {
  if (device.state === undefined) {
    if (device.brewing === true) return 'brewing'
    return device.brewing === false ? 'idle' : 'unknown'
  }
  if (device.state === null) return 'idle'
  const value = typeof device.state === 'object' && !Array.isArray(device.state)
    ? (device.state as Record<string, unknown>).value
    : undefined
  if (typeof value !== 'string') return 'brewing'
  const pulse = /^p([1-9]|10)$/.exec(value)
  if (pulse) return `pulse ${Number(pulse[1])}`
  return PHASE_CODES[value] ?? 'brewing'
}

/** Combines the top-level `missingWater` flag with the nested live-state indicator. Undefined when unreported. */
export function isMissingWater(device: Device): boolean | undefined {
  const topLevel = device.missingWater
  const state = device.state
  const nested = typeof state === 'object' && state !== null && !Array.isArray(state)
    ? (state as Record<string, unknown>).missing_water
    : undefined
  if (topLevel === true || nested === true) return true
  if (typeof topLevel === 'boolean') return topLevel
  return typeof nested === 'boolean' ? nested : undefined
}

/** Human-readable reasons an Instant Brew must not be started now. Every unknown counts as a reason. */
export function brewStartBlockers(device: Device): string[] {
  const blockers: string[] = []
  if (typeof device.firmwareVersion !== 'string') blockers.push('firmware version is unknown')
  else if (!supportsRemoteStart(device)) blockers.push(`firmware ${device.firmwareVersion} is older than ${MIN_REMOTE_START_FIRMWARE.join('.')}`)
  if (device.isConnected !== true) blockers.push('brewer is offline')
  const brewing = isBrewing(device)
  if (brewing === undefined) blockers.push('brew state is unknown')
  else if (brewing) blockers.push('a brew is in progress')
  if (device.lidClosed !== true) blockers.push('lid is open')
  const missingWater = isMissingWater(device)
  if (missingWater === undefined) blockers.push('water level is unknown')
  else if (missingWater) blockers.push('water tank is empty')
  if (device.cleaning !== false) blockers.push('cleaning cycle is running')
  if (device.rinsing !== false) blockers.push('rinse cycle is running')
  const singleBasket = device.singleBrewBasketPresent === true
  const batchBasket = device.batchBrewBasketPresent === true
  if (!singleBasket && !batchBasket) blockers.push('no basket detected')
  else if (!singleBasket && device.carafePresent !== true) blockers.push('carafe is not in place (the batch basket brews into it)')
  return blockers
}

/** Whether the reported state is safe for an Instant Brew start. */
export function canStartBrew(device: Device): boolean {
  return brewStartBlockers(device).length === 0
}
