<script setup lang="ts">
import type { DeviceResponse } from '#shared/types/api'
import { isBrewing } from '../../server/lib/fellow/device'

const props = defineProps<{ data: DeviceResponse }>()

type Tone = 'success' | 'error' | 'neutral' | 'primary'

const word = computed<{ text: string, tone: Tone }>(() => {
  const d = props.data.device
  if (d.isConnected === false) return { text: 'Offline', tone: 'error' }
  if (isBrewing(d)) return { text: 'Brewing', tone: 'primary' }
  if (d.cleaning) return { text: 'Cleaning', tone: 'neutral' }
  if (d.rinsing) return { text: 'Rinsing', tone: 'neutral' }
  if (props.data.canStartBrew) return { text: 'Ready', tone: 'primary' }
  return { text: 'Not ready', tone: 'neutral' }
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
    ...(d.heaterOn ? [{ label: 'Heater on', tone: 'primary' as Tone }] : []),
    ...(d.pumpOn ? [{ label: 'Pump on', tone: 'primary' as Tone }] : []),
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
  <section class="space-y-6">
    <div>
      <p class="text-sm text-muted">
        {{ data.device.displayName ?? 'Your brewer' }}
      </p>
      <h2 class="mt-1 text-5xl font-semibold tracking-tight" :class="toneClass[word.tone]">
        {{ word.text }}
      </h2>
    </div>

    <ul class="flex flex-wrap gap-2">
      <li v-for="chip in chips" :key="chip.label">
        <UBadge :color="chip.tone === 'primary' ? 'primary' : chip.tone" variant="subtle" :label="chip.label" />
      </li>
    </ul>

    <ul v-if="data.blockers.length && word.text !== 'Brewing'" class="space-y-1 text-sm text-muted">
      <li v-for="reason in data.blockers" :key="reason" class="flex items-start gap-2">
        <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0 text-error" />
        <span>{{ reason }}</span>
      </li>
    </ul>

  </section>
</template>
