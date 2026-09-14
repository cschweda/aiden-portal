<script setup lang="ts">
import type { DeviceResponse, HistoryResponse } from '#shared/types/api'
import { brewPhase, isBrewing } from '../../server/lib/fellow/device'
import { describeCountdown } from '../utils/countdown'
import { formatClock } from '../utils/format'

/**
 * The one thing worth seeing first. Idle, it is the brewer's state in a word with the checks that back it up.
 * Brewing, the composition changes rather than just its colour: the elapsed clock takes over, with the phase it is
 * in and how far through it is. A glance from across the kitchen should answer "is it done yet".
 */
const props = defineProps<{
  data: DeviceResponse
  /** The brew in progress, when there is one, for the clock and the run of the bar. */
  live?: HistoryResponse['current'] | null
  now: number
}>()

type Tone = 'success' | 'error' | 'neutral' | 'primary'

const brewing = computed(() => isBrewing(props.data.device) === true)

const word = computed<{ text: string, tone: Tone }>(() => {
  const d = props.data.device
  if (d.isConnected === false) return { text: 'Offline', tone: 'error' }
  if (brewing.value) return { text: 'Brewing', tone: 'primary' }
  if (d.cleaning) return { text: 'Cleaning', tone: 'neutral' }
  if (d.rinsing) return { text: 'Rinsing', tone: 'neutral' }
  if (props.data.canStartBrew) return { text: 'Ready', tone: 'primary' }
  return { text: 'Not ready', tone: 'neutral' }
})

/** Seconds since the brew began, from the tracker's start where there is one, the brewer's own otherwise. */
const elapsedS = computed(() => {
  const started = props.live?.startedAt
  if (!started) return 0
  return Math.max(0, (props.now - started) / 1000)
})
const phase = computed(() => brewPhase(props.data.device) ?? 'brewing')
const countdown = computed(() => describeCountdown(props.live?.expected, elapsedS.value))
/** How far through the expected length, capped so a long brew fills the bar rather than overflowing it. */
const progress = computed(() => {
  const expected = props.live?.expected?.seconds
  if (!expected || expected <= 0) return null
  return Math.min(1, elapsedS.value / expected)
})

const chips = computed(() => {
  const d = props.data.device
  const chip = (label: string, ok: boolean | undefined, bad = 'Unknown', good = label) => ({
    label: ok === undefined ? `${label}: ${bad.toLowerCase()}` : ok ? good : `${label}: ${bad.toLowerCase()}`,
    tone: (ok === undefined ? 'neutral' : ok ? 'success' : 'error') as Tone,
  })
  return [
    chip('Connection', d.isConnected, 'offline', 'Connected'),
    chip('Lid', d.lidClosed, 'open', 'Lid closed'),
    chip('Water', d.missingWater === undefined ? undefined : !d.missingWater, 'empty', 'Water ready'),
    chip('Carafe', d.carafePresent, 'missing', 'Carafe in place'),
    d.singleBrewBasketPresent
      ? { label: 'Single-serve basket', tone: 'success' as Tone }
      : d.batchBrewBasketPresent
        ? { label: 'Batch basket', tone: 'success' as Tone }
        : d.singleBrewBasketPresent === undefined && d.batchBrewBasketPresent === undefined
          ? { label: 'Basket: unknown', tone: 'neutral' as Tone }
          : { label: 'No basket', tone: 'error' as Tone },
    ...(d.cleaning ? [{ label: 'Cleaning cycle running', tone: 'neutral' as Tone }] : []),
    ...(d.rinsing ? [{ label: 'Rinse cycle running', tone: 'neutral' as Tone }] : []),
  ]
})

const toneClass: Record<Tone, string> = {
  success: 'text-success',
  error: 'text-error',
  neutral: 'text-muted',
  primary: 'text-primary',
}
</script>

<template>
  <section class="space-y-5">
    <!-- Brewing: the clock is the headline, because the only question then is how long is left. -->
    <template v-if="brewing">
      <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p class="text-sm text-muted">
          {{ data.device.displayName ?? 'Your brewer' }} is brewing
        </p>
        <p class="text-sm text-primary">
          {{ phase }}
        </p>
      </div>
      <p class="font-mono text-6xl font-semibold tabular leading-none tracking-tight text-primary sm:text-7xl">
        {{ formatClock(elapsedS) }}
      </p>
      <div v-if="progress !== null" class="h-1.5 w-full overflow-hidden rounded-full bg-accented">
        <div class="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" :style="{ width: `${Math.max(2, progress * 100)}%` }" />
      </div>
      <p v-if="countdown" class="text-sm text-muted">
        {{ countdown }}
      </p>
      <div v-if="data.device.heaterOn || data.device.pumpOn" class="flex flex-wrap gap-2">
        <UBadge v-if="data.device.heaterOn" color="primary" variant="subtle" label="Heater on" />
        <UBadge v-if="data.device.pumpOn" color="primary" variant="subtle" label="Pump on" />
      </div>
    </template>

    <!-- Idle: the state in a word, with the checks that back it up. -->
    <template v-else>
      <div>
        <p class="text-sm text-muted">
          {{ data.device.displayName ?? 'Your brewer' }}
        </p>
        <h2 class="mt-1 text-6xl font-semibold leading-none tracking-tight sm:text-7xl" :class="toneClass[word.tone]">
          {{ word.text }}
        </h2>
      </div>

      <ul class="flex flex-wrap gap-2">
        <li v-for="chip in chips" :key="chip.label">
          <UBadge :color="chip.tone === 'primary' ? 'primary' : chip.tone" variant="subtle" :label="chip.label" />
        </li>
      </ul>

      <ul v-if="data.blockers.length" class="space-y-1 text-sm text-muted">
        <li v-for="reason in data.blockers" :key="reason" class="flex items-start gap-2">
          <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0 text-error" />
          <span>{{ reason }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
