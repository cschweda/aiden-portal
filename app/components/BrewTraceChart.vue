<script setup lang="ts">
import type { TraceSample } from '#shared/types/api'
import { formatClock, formatTemperature, formatTime } from '../utils/format'

const props = withDefaults(defineProps<{
  samples: TraceSample[]
  startedAt: number
  /** Seconds between samples, which sets how far the last band extends. */
  intervalS?: number
  /** Expected total length, so a live trace's axis spans the whole brew from the start. */
  expectedS?: number | null
}>(), { intervalS: 5, expectedS: null })

const HEIGHT = 220
const PAD = { top: 28, right: 12, bottom: 28, left: 40 }

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

const elapsed = (t: number) => (t - props.startedAt) / 1000
const spanS = computed(() => {
  const last = props.samples[props.samples.length - 1]
  return Math.max(last ? elapsed(last.t) + props.intervalS : props.intervalS * 4, props.expectedS ?? 0, 30)
})
const temperatures = computed(() => props.samples.map(s => s.temperatureC).filter((c): c is number => typeof c === 'number'))
const yDomain = computed<[number, number]>(() => {
  if (temperatures.value.length === 0) return [80, 100]
  const lo = Math.floor((Math.min(...temperatures.value) - 1) / 5) * 5
  const hi = Math.ceil((Math.max(...temperatures.value) + 1) / 5) * 5
  return hi - lo < 10 ? [lo - 5, hi + 5] : [lo, hi]
})
const plotWidth = computed(() => Math.max(width.value - PAD.left - PAD.right, 40))
const x = (seconds: number) => PAD.left + (seconds / spanS.value) * plotWidth.value
const y = (celsius: number) => {
  const [lo, hi] = yDomain.value
  return PAD.top + (1 - (celsius - lo) / (hi - lo)) * (HEIGHT - PAD.top - PAD.bottom)
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
    const last = runs[runs.length - 1]
    if (last && last.phase === sample.phase) last.to = to
    else runs.push({ phase: sample.phase, from, to })
  })
  return runs
})

const xTicks = computed(() => {
  const span = spanS.value
  const step = span <= 120 ? 15 : span <= 600 ? 60 : span <= 1800 ? 300 : span <= 7200 ? 900 : span <= 21_600 ? 1800 : span <= 43_200 ? 3600 : 7200
  const ticks: number[] = []
  for (let s = 0; s <= span; s += step) ticks.push(s)
  return ticks
})
const yTicks = computed(() => {
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
      :height="HEIGHT"
      class="block w-full"
      role="img"
      :aria-label="`Water temperature over the brew, ${samples.length} samples`"
      @mousemove="onMove"
      @mouseleave="hovered = null"
    >
      <g v-for="(band, i) in bands" :key="`${band.phase}-${band.from}`">
        <rect
          :x="x(band.from)"
          :y="PAD.top - 20"
          :width="Math.max(0, x(band.to) - x(band.from))"
          :height="HEIGHT - PAD.top - PAD.bottom + 20"
          :fill="i % 2 ? 'var(--ui-bg-elevated)' : 'transparent'"
        />
        <text v-if="x(band.to) - x(band.from) >= 34" :x="x(band.from) + 4" :y="PAD.top - 8" font-size="10" fill="var(--ui-text-muted)">{{ band.phase }}</text>
      </g>
      <g v-for="c in yTicks" :key="c">
        <line :x1="PAD.left" :x2="width - PAD.right" :y1="y(c)" :y2="y(c)" stroke="var(--ui-border)" stroke-width="1" />
        <text :x="PAD.left - 6" :y="y(c) + 3" text-anchor="end" font-size="10" fill="var(--ui-text-muted)">{{ c }}°</text>
      </g>
      <text v-for="s in xTicks" :key="s" :x="x(s)" :y="HEIGHT - 8" text-anchor="middle" font-size="10" fill="var(--ui-text-muted)">{{ formatClock(s) }}</text>
      <path :d="linePath" fill="none" stroke="var(--ui-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
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
      <line
        v-if="hoverSample"
        :x1="x(elapsed(hoverSample.t))"
        :x2="x(elapsed(hoverSample.t))"
        :y1="PAD.top - 20"
        :y2="HEIGHT - PAD.bottom"
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
        {{ formatTemperature(hoverSample.temperatureC) }} · heater {{ onOff(hoverSample.heaterOn) }} · pump {{ onOff(hoverSample.pumpOn) }}
      </p>
    </div>
    <p v-if="temperatures.length === 0" class="mt-1 text-xs text-muted">
      No water temperature was reported during this brew; the bands show the phases.
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
            <th class="py-1 pr-3 font-medium">
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
            <td class="py-1 pr-3">
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
