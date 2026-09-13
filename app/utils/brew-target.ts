import type { TraceTarget } from '../../server/lib/history'

export interface TargetSegment {
  from: number
  to: number
  celsius: number
}

/** The temperature the recipe asked for during one phase, or null when the recipe says nothing about it. */
function temperatureFor(phase: string, target: TraceTarget): number | null {
  if (phase === 'bloom') return target.bloomC ?? target.overallC ?? null
  const pulse = /^pulse (\d+)$/.exec(phase)
  if (pulse) return target.pulsesC[Number(pulse[1]) - 1] ?? target.overallC ?? null
  // The pour has finished, or nothing is being poured yet.
  if (phase === 'drip finish' || phase === 'idle' || phase === 'unknown') return null
  // Brewing, with or without a stage the brewer named: the recipe's overall temperature is the best answer.
  return target.overallC ?? target.pulsesC[0] ?? null
}

/**
 * What the recipe was aiming for across the phases the brewer actually went through, as segments a chart can draw.
 * Adjacent phases asking for the same temperature become one segment, so the line steps only where the recipe does.
 */
export function targetSegments(bands: Array<{ phase: string, from: number, to: number }>, target: TraceTarget | null | undefined): TargetSegment[] {
  if (!target) return []
  const segments: TargetSegment[] = []
  for (const band of bands) {
    const celsius = temperatureFor(band.phase, target)
    if (celsius === null) continue
    const last = segments[segments.length - 1]
    if (last && last.celsius === celsius && Math.abs(last.to - band.from) < 0.001) last.to = band.to
    else segments.push({ from: band.from, to: band.to, celsius })
  }
  return segments
}
