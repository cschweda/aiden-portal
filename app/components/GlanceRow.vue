<script setup lang="ts">
import type { DeviceResponse, HistoryResponse } from '#shared/types/api'
import { formatClock, formatHourMinute, formatLitresFromMl, formatWaterFromLitres } from '../utils/format'

/**
 * The four readings worth crossing the room for: is there coffee, does the brewer need descaling, how much has been
 * brewed today, and how the last brew went. Each tile carries one number, in the mono face the rest of the app uses
 * for instrument readings, with everything else kept small and quiet around it.
 */
const props = defineProps<{
  device: DeviceResponse
  history: HistoryResponse
  /** Ticking clock from the page, so the coffee reading counts up without its own timer. */
  now: number
}>()

/**
 * A span of time as a numeral and a word, because the mono face is set for figures: "37" and "minutes" read as a
 * reading, where "1 h 37 min" set in mono sprawls into gaps.
 */
function bigDuration(seconds: number): { value: string, unit: string } {
  const s = Math.max(0, Math.round(seconds))
  if (s < 3600) {
    const m = Math.floor(s / 60)
    return { value: String(m), unit: m === 1 ? 'minute' : 'minutes' }
  }
  const h = Math.floor(s / 3600)
  return { value: `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`, unit: 'hours' }
}

type Tone = 'default' | 'fresh' | 'warn' | 'quiet'

interface Tile {
  key: string
  label: string
  value: string
  unit?: string
  sub: string
  tone: Tone
  /** 0 to 1, drawn as a thin bar under the reading. */
  fill?: number
}

const coffee = computed<Tile>(() => {
  const since = props.history.coffee.sittingSince
  const carafeOut = props.device.device.carafePresent === false
  if (since === null) {
    return {
      key: 'coffee',
      label: 'Coffee sitting',
      value: 'None',
      sub: carafeOut ? 'the carafe is off the plate' : 'nothing brewed recently',
      tone: 'quiet',
    }
  }
  const minutes = (props.now - since) / 60_000
  const fresh = minutes <= props.history.coffee.freshMinutes
  const span = bigDuration((props.now - since) / 1000)
  return {
    key: 'coffee',
    label: 'Coffee sitting',
    value: span.value,
    unit: span.unit,
    sub: `brewed at ${formatHourMinute(since)}, ${fresh ? 'still fresh' : 'past its best'}`,
    tone: fresh ? 'fresh' : 'warn',
  }
})

const descale = computed<Tile>(() => {
  const d = props.history.descale
  const litres = d.litresSince
  const days = d.dueInDays
  return {
    key: 'descale',
    label: 'Water since descale',
    value: formatWaterFromLitres(litres),
    unit: `of ${d.thresholdLitres} L`,
    sub: d.level === 'red'
      ? 'the threshold is reached; descale now'
      : days !== null && days > 0
        ? `about ${Math.max(1, Math.round(days))} day${Math.round(days) === 1 ? '' : 's'} to go`
        : `${d.brewsSince ?? 0} brew${d.brewsSince === 1 ? '' : 's'} since the last mark`,
    tone: d.level === 'red' ? 'warn' : d.level === 'amber' ? 'warn' : 'default',
    fill: d.ratio ?? 0,
  }
})

const today = computed<Tile>(() => {
  const s = props.history.stats
  return {
    key: 'today',
    label: 'Brewed today',
    value: String(s.today.brews),
    unit: s.today.brews === 1 ? 'brew' : 'brews',
    sub: s.today.brews
      ? `${formatLitresFromMl(s.today.waterMl)} today, ${s.thisWeek.brews} this week, ${s.thisMonth.brews} this month`
      : `${s.thisWeek.brews} this week, ${s.thisMonth.brews} this month`,
    tone: s.today.brews ? 'default' : 'quiet',
  }
})

const last = computed<Tile>(() => {
  const brew = props.history.recent[0]
  if (!brew) {
    return { key: 'last', label: 'Last brew', value: 'None', sub: 'nothing logged yet', tone: 'quiet' }
  }
  return {
    key: 'last',
    label: 'Last brew took',
    value: brew.durationS === null ? '—' : formatClock(brew.durationS),
    unit: brew.durationS === null ? 'not timed' : 'min',
    sub: `${brew.profileTitle ?? 'selected profile'}, at ${formatHourMinute(brew.startedAt)}`,
    tone: 'default',
  }
})

const tiles = computed(() => [coffee.value, descale.value, today.value, last.value])

const toneClass: Record<Tone, string> = {
  default: 'text-default',
  fresh: 'text-success',
  warn: 'text-warning',
  quiet: 'text-muted',
}
const barClass: Record<Tone, string> = {
  default: 'bg-primary',
  fresh: 'bg-success',
  warn: 'bg-warning',
  quiet: 'bg-muted',
}
</script>

<template>
  <section class="grid gap-px overflow-hidden rounded-xl bg-accented sm:grid-cols-2 xl:grid-cols-4">
    <div v-for="tile in tiles" :key="tile.key" class="flex flex-col justify-between gap-3 bg-default p-5">
      <p class="text-sm text-muted">
        {{ tile.label }}
      </p>
      <p class="flex items-baseline gap-2">
        <span class="font-mono text-4xl font-semibold tabular tracking-tight" :class="toneClass[tile.tone]">{{ tile.value }}</span>
        <span v-if="tile.unit" class="text-sm text-muted">{{ tile.unit }}</span>
      </p>
      <div class="space-y-2">
        <div v-if="tile.fill !== undefined" class="h-1 w-full overflow-hidden rounded-full bg-accented">
          <div class="h-full rounded-full" :class="barClass[tile.tone]" :style="{ width: `${Math.min(100, Math.max(2, tile.fill * 100))}%` }" />
        </div>
        <p class="text-xs text-muted">
          {{ tile.sub }}
        </p>
      </div>
    </div>
  </section>
</template>
