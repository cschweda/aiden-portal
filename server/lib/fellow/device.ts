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

/** Whether the reported state is safe for an Instant Brew start. Every unknown is treated as "no". */
export function canStartBrew(device: Device): boolean {
  const singleBasket = device.singleBrewBasketPresent === true
  const batchReady = device.batchBrewBasketPresent === true && device.carafePresent === true
  return supportsRemoteStart(device)
    && device.isConnected === true
    && isBrewing(device) === false
    && device.lidClosed === true
    && isMissingWater(device) === false
    && device.cleaning === false
    && device.rinsing === false
    && (singleBasket || batchReady)
}
