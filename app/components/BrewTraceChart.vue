<script setup lang="ts">
import type { TraceSample, TraceTarget } from '#shared/types/api'
import { targetSegments } from '../utils/brew-target'
import { formatClock, formatTemperature, formatTime } from '../utils/format'

const props = withDefaults(defineProps<{
  samples: TraceSample[]
  startedAt: number
  /** Seconds between samples, which sets how far the last band extends. */
  intervalS?: number
  /** How long the app can take to notice a brew began; a longer gap at the head means samples are actually missing. */
  idlePollS?: number
  /** Expected total length, so a live trace's axis spans the whole brew from the start. */
  expectedS?: number | null
  /** What the recipe asked for, captured when the brew started. Drawn dashed, beside or instead of a measurement. */
  target?: TraceTarget | null
}>(), { intervalS: 5, idlePollS: 60, expectedS: null, target: null })

const PAD = { top: 28, right: 12, bottom: 28, left: 40 }
const ROW_LABEL_WIDTH = 52
/** Heater and pump sit in their own rows above the time axis, whenever no measurement fills the plot. */
const ROWS_HEIGHT = 44

const host = ref<HTMLElement | null>(null)
const width = ref(720)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!host.value) return
  width.value = host.value.clientWidth || width.value
  observer = new ResizeObserver((entries) => {
    const measured = entries[0]?.contentRect.width
    if (measured) width.value = measured
  })
  observer.observe(host.value)
})
onBeforeUnmount(() => observer?.disconnect())

const temperatures = computed(() => props.samples.map(s => s.temperatureC).filter((c): c is number => typeof c === 'number'))
/** Some brewers report the water temperature during a brew and some never do; the drawing follows what arrived. */
const hasTemperatures = computed(() => temperatures.value.length > 0)
/** Heater and pump are worth a row of their own when no measurement is filling the plot. */
const showRows = computed(() => !hasTemperatures.value)
const rowsHeight = computed(() => (showRows.value ? ROWS_HEIGHT : 0))
const hasScale = computed(() => hasTemperatures.value || targets.value.length > 0)
const height = computed(() => (hasTemperatures.value ? 220 : hasScale.value ? 236 : 160))
const padLeft = computed(() => (showRows.value ? ROW_LABEL_WIDTH : PAD.left))

const elapsed = (t: number) => (t - props.startedAt) / 1000
const spanS = computed(() => {
  const last = props.samples[props.samples.length - 1]
  return Math.max(last ? elapsed(last.t) + props.intervalS : props.intervalS * 4, props.expectedS ?? 0, 30)
})
/**
 * How much of the brew ran before the app recorded any of it. A brew is normally noticed within one idle poll of
 * starting, so anything beyond that is a stretch nothing was watched for: a restart mid-brew, whose samples were
 * only ever in memory. The brewer still reports the full length, so the axis keeps it and the gap is drawn as a gap.
 */
const missingHeadS = computed(() => {
  const first = props.samples[0]
  if (!first) return 0
  const gap = elapsed(first.t)
  return gap > props.idlePollS + props.intervalS ? gap : 0
})
const yDomain = computed<[number, number]>(() => {
  const values = [...temperatures.value, ...targets.value.map(t => t.celsius)]
  if (values.length === 0) return [0, 1]
  const lo = Math.floor((Math.min(...values) - 1) / 5) * 5
  const hi = Math.ceil((Math.max(...values) + 1) / 5) * 5
  return hi - lo < 10 ? [lo - 5, hi + 5] : [lo, hi]
})
const plotWidth = computed(() => Math.max(width.value - padLeft.value - PAD.right, 40))
/** Where the bands and the crosshair stop: the time axis is below this. */
const plotBottom = computed(() => height.value - PAD.bottom)
/** Where the temperature scale stops: above the heater and pump rows when they are shown. */
const scaleBottom = computed(() => plotBottom.value - rowsHeight.value)
const x = (seconds: number) => padLeft.value + (seconds / spanS.value) * plotWidth.value
const y = (celsius: number) => {
  const [lo, hi] = yDomain.value
  return PAD.top + (1 - (celsius - lo) / (hi - lo)) * (scaleBottom.value - PAD.top)
}

/** Contiguous runs of one phase, each spanning from its first sample to the next run's first sample. */
const bands = computed(() => {
  const runs: Array<{ phase: string, from: number, to: number }> = []
  const last = props.samples[props.samples.length - 1]
  const previous = props.samples[props.samples.length - 2]
  const tail = last && previous ? Math.max(props.intervalS, elapsed(last.t) - elapsed(previous.t)) : props.intervalS
  props.samples.forEach((sample, i) => {
    const from = elapsed(sample.t)
    const next = props.samples[i + 1]
    const to = next ? elapsed(next.t) : from + tail
    const run = runs[runs.length - 1]
    if (run && run.phase === sample.phase) run.to = to
    else runs.push({ phase: sample.phase, from, to })
  })
  return runs
})

/** Contiguous stretches where a pump or heater was on, for the timeline rows. */
function runsOf(key: 'heaterOn' | 'pumpOn') {
  const runs: Array<{ from: number, to: number }> = []
  const last = props.samples[props.samples.length - 1]
  const previous = props.samples[props.samples.length - 2]
  const tail = last && previous ? Math.max(props.intervalS, elapsed(last.t) - elapsed(previous.t)) : props.intervalS
  props.samples.forEach((sample, i) => {
    if (sample[key] !== true) return
    const from = elapsed(sample.t)
    const next = props.samples[i + 1]
    const to = next ? elapsed(next.t) : from + tail
    const run = runs[runs.length - 1]
    if (run && Math.abs(run.to - from) < 0.001) run.to = to
    else runs.push({ from, to })
  })
  return runs
}
const rows = computed(() => {
  const first = plotBottom.value - ROWS_HEIGHT + 6
  return [
    { label: 'Heater', y: first, runs: runsOf('heaterOn'), reported: props.samples.some(s => s.heaterOn !== undefined) },
    { label: 'Pump', y: first + 20, runs: runsOf('pumpOn'), reported: props.samples.some(s => s.pumpOn !== undefined) },
  ]
})

/** The recipe's temperature across the phases the brewer went through, as a stepped dashed line. */
const targets = computed(() => targetSegments(bands.value, props.target))

const xTicks = computed(() => {
  const span = spanS.value
  const step = span <= 120 ? 15 : span <= 600 ? 60 : span <= 1800 ? 300 : span <= 7200 ? 900 : span <= 21_600 ? 1800 : span <= 43_200 ? 3600 : 7200
  const ticks: number[] = []
  for (let s = 0; s <= span; s += step) ticks.push(s)
  return ticks
})
const yTicks = computed(() => {
  if (!hasScale.value) return []
  const [lo, hi] = yDomain.value
  const step = hi - lo > 30 ? 10 : 5
  const ticks: number[] = []
  for (let c = lo; c <= hi; c += step) ticks.push(c)
  return ticks
})

const linePath = computed(() => {
  let path = ''
  let pen = false
  for (const sample of props.samples) {
    if (typeof sample.temperatureC !== 'number') {
      pen = false
      continue
    }
    path += `${pen ? 'L' : 'M'}${x(elapsed(sample.t)).toFixed(1)},${y(sample.temperatureC).toFixed(1)} `
    pen = true
  }
  return path.trim()
})

const hovered = ref<number | null>(null)
function onMove(event: MouseEvent) {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const px = event.clientX - rect.left
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  props.samples.forEach((sample, i) => {
    const distance = Math.abs(x(elapsed(sample.t)) - px)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  })
  hovered.value = best >= 0 && bestDistance < 40 ? best : null
}
const hoverSample = computed(() => (hovered.value === null ? null : props.samples[hovered.value] ?? null))
const tooltipStyle = computed(() => {
  if (!hoverSample.value) return {}
  const px = x(elapsed(hoverSample.value.t))
  const flip = px > width.value * 0.6
  return { left: `${flip ? px - 10 : px + 10}px`, transform: flip ? 'translateX(-100%)' : undefined }
})

const showTable = ref(false)
const onOff = (value: boolean | undefined) => (value === undefined ? '—' : value ? 'on' : 'off')
</script>

<template>
  <div ref="host" class="relative">
    <svg
      :width="width"
      :height="height"
      class="block w-full"
      role="img"
      :aria-label="hasTemperatures
        ? `Water temperature over the brew, ${samples.length} samples`
        : `What the brewer reported through the brew: phase, heater and pump, ${samples.length} samples`"
      @mousemove="onMove"
      @mouseleave="hovered = null"
    >
      <!-- The brew was already running when the app joined it; nothing was recorded for this stretch. -->
      <g v-if="missingHeadS > 0">
        <rect
          :x="x(0)"
          :y="PAD.top - 20"
          :width="Math.max(0, x(missingHeadS) - x(0))"
          :height="plotBottom - PAD.top + 20"
          fill="var(--ui-border)"
          opacity="0.35"
        />
        <text v-if="x(missingHeadS) - x(0) >= 72" :x="x(0) + 4" :y="PAD.top - 8" font-size="10" fill="var(--ui-text-muted)">not recorded</text>
      </g>

      <g v-for="(band, i) in bands" :key="`${band.phase}-${band.from}`">
        <rect
          :x="x(band.from)"
          :y="PAD.top - 20"
          :width="Math.max(0, x(band.to) - x(band.from))"
          :height="plotBottom - PAD.top + 20"
          :fill="i % 2 ? 'var(--ui-bg-elevated)' : 'transparent'"
        />
        <text v-if="x(band.to) - x(band.from) >= 34" :x="x(band.from) + 4" :y="PAD.top - 8" font-size="10" fill="var(--ui-text-muted)">{{ band.phase }}</text>
      </g>

      <template v-if="hasScale">
        <g v-for="c in yTicks" :key="c">
          <line :x1="padLeft" :x2="width - PAD.right" :y1="y(c)" :y2="y(c)" stroke="var(--ui-border)" stroke-width="1" />
          <text :x="padLeft - 6" :y="y(c) + 3" text-anchor="end" font-size="10" fill="var(--ui-text-muted)">{{ c }}°</text>
        </g>
        <!-- What the recipe asked for: dashed, and never mistaken for a reading. -->
        <g v-for="segment in targets" :key="`target-${segment.from}`">
          <line
            :x1="x(segment.from)"
            :x2="x(segment.to)"
            :y1="y(segment.celsius)"
            :y2="y(segment.celsius)"
            stroke="var(--ui-primary)"
            stroke-width="2"
            stroke-dasharray="5 4"
            opacity="0.75"
          />
        </g>
        <path v-if="hasTemperatures" :d="linePath" fill="none" stroke="var(--ui-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <template v-for="(sample, i) in samples" :key="sample.t">
          <circle
            v-if="typeof sample.temperatureC === 'number'"
            :cx="x(elapsed(sample.t))"
            :cy="y(sample.temperatureC)"
            :r="hovered === i ? 5 : 3"
            fill="var(--ui-primary)"
            stroke="var(--ui-bg)"
            stroke-width="2"
          />
        </template>
      </template>

      <!-- Heater and pump, whenever no measurement is filling the plot. -->
      <template v-if="showRows">
        <g v-for="row in rows" :key="row.label">
          <text :x="padLeft - 8" :y="row.y + 11" text-anchor="end" font-size="10" fill="var(--ui-text-muted)">{{ row.label }}</text>
          <rect :x="padLeft" :y="row.y" :width="plotWidth" height="14" rx="3" fill="var(--ui-border)" opacity="0.45" />
          <rect
            v-for="run in row.runs"
            :key="`${row.label}-${run.from}`"
            :x="x(run.from)"
            :y="row.y"
            :width="Math.max(1, x(run.to) - x(run.from))"
            height="14"
            rx="3"
            fill="var(--ui-primary)"
          />
          <text v-if="!row.reported" :x="padLeft + 6" :y="row.y + 11" font-size="10" fill="var(--ui-text-muted)">not reported</text>
        </g>
      </template>

      <text v-for="s in xTicks" :key="s" :x="x(s)" :y="height - 8" text-anchor="middle" font-size="10" fill="var(--ui-text-muted)">{{ formatClock(s) }}</text>
      <line
        v-if="hoverSample"
        :x1="x(elapsed(hoverSample.t))"
        :x2="x(elapsed(hoverSample.t))"
        :y1="PAD.top - 20"
        :y2="plotBottom"
        stroke="var(--ui-text-muted)"
        stroke-width="1"
        stroke-dasharray="3 3"
      />
    </svg>

    <div v-if="hoverSample" class="pointer-events-none absolute top-1 rounded-md border border-default bg-elevated px-2 py-1 text-xs shadow-sm" :style="tooltipStyle">
      <p class="font-medium">
        {{ formatClock(elapsed(hoverSample.t)) }} · {{ hoverSample.phase }}
      </p>
      <p class="text-muted">
        <template v-if="hasTemperatures">{{ formatTemperature(hoverSample.temperatureC) }} · </template>heater {{ onOff(hoverSample.heaterOn) }} · pump {{ onOff(hoverSample.pumpOn) }}
      </p>
    </div>

    <p v-if="missingHeadS > 0" class="mt-1 text-xs text-muted">
      This brew was already running when the app started watching it, so the first {{ formatClock(missingHeadS) }}
      went unrecorded. Its length comes from the brewer, which keeps the real start.
    </p>

    <p v-if="!hasTemperatures" class="mt-1 text-xs text-muted">
      <template v-if="targets.length">
        This brewer does not report the water temperature it reaches. The dashed line is the temperature the recipe
        asked for, held against the phases it actually went through, with the heater and pump beneath.
      </template>
      <template v-else>
        This brewer does not report the water temperature, so the trace shows what it does report: the phase it is
        in, and when the heater and pump run.
      </template>
    </p>

    <div class="mt-1">
      <UButton :label="showTable ? 'Hide samples' : 'Show samples'" variant="link" color="neutral" size="xs" @click="showTable = !showTable" />
    </div>
    <div v-if="showTable" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-left text-muted">
            <th class="py-1 pr-3 font-medium">
              Time
            </th>
            <th class="py-1 pr-3 font-medium">
              Elapsed
            </th>
            <th class="py-1 pr-3 font-medium">
              Phase
            </th>
            <th v-if="hasTemperatures" class="py-1 pr-3 font-medium">
              Water
            </th>
            <th class="py-1 pr-3 font-medium">
              Heater
            </th>
            <th class="py-1 font-medium">
              Pump
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="sample in samples" :key="sample.t" class="border-t border-default tabular">
            <td class="py-1 pr-3">
              {{ formatTime(sample.t) }}
            </td>
            <td class="py-1 pr-3">
              {{ formatClock(elapsed(sample.t)) }}
            </td>
            <td class="py-1 pr-3">
              {{ sample.phase }}
            </td>
            <td v-if="hasTemperatures" class="py-1 pr-3">
              {{ formatTemperature(sample.temperatureC) }}
            </td>
            <td class="py-1 pr-3">
              {{ onOff(sample.heaterOn) }}
            </td>
            <td class="py-1">
              {{ onOff(sample.pumpOn) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
