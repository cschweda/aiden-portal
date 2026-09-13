import { describe, expect, it } from 'vitest'
import { targetSegments } from '../../../app/utils/brew-target'

const target = { bloomC: 96, pulsesC: [94, 92, 90], overallC: 93 }
const band = (phase: string, from: number, to: number) => ({ phase, from, to })

describe('targetSegments', () => {
  it('follows the recipe through the phases the brewer named', () => {
    const segments = targetSegments([band('bloom', 0, 30), band('pulse 1', 30, 60), band('pulse 2', 60, 90), band('drip finish', 90, 120)], target)
    expect(segments).toEqual([
      { from: 0, to: 30, celsius: 96 },
      { from: 30, to: 60, celsius: 94 },
      { from: 60, to: 90, celsius: 92 },
    ])
  })
  it('uses the overall temperature when the brewer does not name the stage', () => {
    expect(targetSegments([band('bloom', 0, 60), band('brewing (pr)', 60, 300), band('drip finish', 300, 330)], target))
      .toEqual([{ from: 0, to: 60, celsius: 96 }, { from: 60, to: 300, celsius: 93 }])
  })
  it('joins neighbouring phases that ask for the same temperature', () => {
    const flat = { bloomC: 96, pulsesC: [96, 96], overallC: 96 }
    expect(targetSegments([band('bloom', 0, 30), band('pulse 1', 30, 60), band('pulse 2', 60, 90)], flat))
      .toEqual([{ from: 0, to: 90, celsius: 96 }])
  })
  it('falls back for a pulse the recipe does not list, and draws nothing without a target', () => {
    expect(targetSegments([band('pulse 9', 0, 30)], target)).toEqual([{ from: 0, to: 30, celsius: 93 }])
    expect(targetSegments([band('bloom', 0, 30)], null)).toEqual([])
    expect(targetSegments([band('idle', 0, 30)], target)).toEqual([])
  })
  it('leaves a gap rather than a line through the drip finish', () => {
    const segments = targetSegments([band('pulse 1', 0, 30), band('drip finish', 30, 60), band('pulse 2', 60, 90)], target)
    expect(segments).toEqual([{ from: 0, to: 30, celsius: 94 }, { from: 60, to: 90, celsius: 92 }])
  })
})
