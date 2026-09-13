import { describe, expect, it } from 'vitest'
import { brewPhase, brewStartBlockers, canStartBrew, isBrewing, isMissingWater, supportsRemoteStart } from '../../../server/lib/fellow/device'

const READY = {
  id: 'dev-123',
  firmwareVersion: '1.5.16',
  isConnected: true,
  brewing: false,
  lidClosed: true,
  missingWater: false,
  cleaning: false,
  rinsing: false,
  singleBrewBasketPresent: true,
  batchBrewBasketPresent: false,
  carafePresent: false,
}

describe('supportsRemoteStart', () => {
  it.each([
    ['1.5.16', true],
    ['v1.5.16', true],
    ['1.5.16+build.7', true],
    ['1.6.0', true],
    ['2.0.0', true],
    ['1.5.15', false],
    ['1.4.99', false],
    ['garbage', false],
    ['', false],
  ])('firmware %j → %s', (firmwareVersion, expected) => {
    expect(supportsRemoteStart({ id: 'd', firmwareVersion })).toBe(expected)
  })
  it('is false without a firmware version', () => {
    expect(supportsRemoteStart({ id: 'd' })).toBe(false)
  })
})

describe('isBrewing', () => {
  it('prefers the live state object over the legacy flag', () => {
    expect(isBrewing({ id: 'd', state: { phase: 'bloom' }, brewing: false })).toBe(true)
    expect(isBrewing({ id: 'd', state: null, brewing: true })).toBe(false)
  })
  it('falls back to the boolean flag', () => {
    expect(isBrewing({ id: 'd', brewing: true })).toBe(true)
    expect(isBrewing({ id: 'd', brewing: false })).toBe(false)
  })
  it('is undefined when nothing is reported', () => {
    expect(isBrewing({ id: 'd' })).toBeUndefined()
  })
})

describe('isMissingWater', () => {
  it('combines the top-level flag and the nested live-state flag', () => {
    expect(isMissingWater({ id: 'd', missingWater: true })).toBe(true)
    expect(isMissingWater({ id: 'd', state: { missing_water: true } })).toBe(true)
    expect(isMissingWater({ id: 'd', missingWater: false, state: { missing_water: false } })).toBe(false)
    expect(isMissingWater({ id: 'd', missingWater: false })).toBe(false)
    expect(isMissingWater({ id: 'd', state: { missing_water: false } })).toBe(false)
  })
  it('is undefined when nothing is reported', () => {
    expect(isMissingWater({ id: 'd' })).toBeUndefined()
  })
})

describe('canStartBrew', () => {
  it('is true for a connected, idle, closed, watered brewer with a basket', () => {
    expect(canStartBrew(READY)).toBe(true)
  })
  it('accepts the batch basket only together with the carafe', () => {
    expect(canStartBrew({ ...READY, singleBrewBasketPresent: false, batchBrewBasketPresent: true, carafePresent: true })).toBe(true)
    expect(canStartBrew({ ...READY, singleBrewBasketPresent: false, batchBrewBasketPresent: true, carafePresent: false })).toBe(false)
  })
  it.each([
    ['disconnected', { isConnected: false }],
    ['already brewing', { brewing: true }],
    ['live state present', { state: { phase: 'brew' } }],
    ['lid open', { lidClosed: false }],
    ['missing water', { missingWater: true }],
    ['cleaning', { cleaning: true }],
    ['rinsing', { rinsing: true }],
    ['no basket', { singleBrewBasketPresent: false }],
    ['old firmware', { firmwareVersion: '1.5.15' }],
    ['unknown brewing state', { brewing: undefined }],
    ['unknown water state', { missingWater: undefined }],
  ])('is false when %s', (_label, overrides) => {
    expect(canStartBrew({ ...READY, ...overrides })).toBe(false)
  })
})

describe('brewStartBlockers', () => {
  it('is empty for a ready brewer', () => {
    expect(brewStartBlockers(READY)).toEqual([])
  })
  it('names every problem, in a stable order', () => {
    expect(brewStartBlockers({
      ...READY,
      firmwareVersion: '1.0.0',
      isConnected: false,
      brewing: true,
      lidClosed: false,
      missingWater: true,
      cleaning: true,
      rinsing: true,
      singleBrewBasketPresent: false,
    })).toEqual([
      'firmware 1.0.0 is older than 1.5.16',
      'brewer is offline',
      'a brew is in progress',
      'lid is open',
      'water tank is empty',
      'cleaning cycle is running',
      'rinse cycle is running',
      'no basket detected',
    ])
  })
  it('names the carafe when the batch basket is in and the carafe is not', () => {
    const batch = { ...READY, singleBrewBasketPresent: false, batchBrewBasketPresent: true }
    expect(brewStartBlockers({ ...batch, carafePresent: false })).toEqual(['carafe is not in place (the batch basket brews into it)'])
    expect(brewStartBlockers({ ...batch, carafePresent: undefined })).toEqual(['carafe is not in place (the batch basket brews into it)'])
    expect(brewStartBlockers({ ...batch, carafePresent: true })).toEqual([])
    expect(brewStartBlockers({ ...READY, carafePresent: false })).toEqual([])
  })
  it('treats unknown state as a blocker', () => {
    expect(brewStartBlockers({ ...READY, brewing: undefined })).toEqual(['brew state is unknown'])
    expect(brewStartBlockers({ ...READY, missingWater: undefined })).toEqual(['water level is unknown'])
    expect(brewStartBlockers({ ...READY, firmwareVersion: undefined })).toEqual(['firmware version is unknown'])
  })
})

describe('brewPhase', () => {
  it.each([
    [{ state: null }, 'idle'],
    [{ state: { value: 'b' } }, 'bloom'],
    [{ state: { value: 'p1' } }, 'pulse 1'],
    [{ state: { value: 'p10' } }, 'pulse 10'],
    [{ state: { value: 'd' } }, 'drip finish'],
    [{ state: { value: 'pa' } }, 'paused'],
    [{ state: { value: 'p11' } }, 'brewing (p11)'],
    [{ state: { value: 'zz' } }, 'brewing (zz)'],
    // Seen on a real brew between bloom and the end; its meaning is unknown, so it is shown rather than guessed.
    [{ state: { value: 'pr' } }, 'brewing (pr)'],
    [{ state: { value: '' } }, 'brewing'],
    [{ state: { phase: 'brew' } }, 'brewing'],
    [{ state: 'odd' }, 'brewing'],
    [{ brewing: true }, 'brewing'],
    [{ brewing: false }, 'idle'],
    [{}, 'unknown'],
  ])('%j → %s', (fields, expected) => {
    expect(brewPhase({ id: 'd', ...fields })).toBe(expected)
  })
})
