<script setup lang="ts">
import type { DescaleStatus } from '#shared/types/api'
import { formatAgo, formatDate, formatDateTime } from '../utils/format'

const props = defineProps<{ descale: DescaleStatus }>()
const emit = defineEmits<{ marked: [] }>()
const { confirming, marking, mark } = useDescaleMark(() => emit('marked'))

const color = computed(() => ({ ok: 'success', amber: 'warning', red: 'error', unknown: 'neutral' } as const)[props.descale.level])
const percent = computed(() => (props.descale.ratio === null ? 0 : Math.min(100, Math.round(props.descale.ratio * 100))))
const headline = computed(() => {
  switch (props.descale.level) {
    case 'red': return 'Descale now'
    case 'amber': return 'Descale soon'
    case 'ok': return 'No descale needed yet'
    default: return 'Brewer totals unavailable'
  }
})
const headlineClass = computed(() => ({ red: 'text-error', amber: 'text-warning', ok: 'text-success', unknown: 'text-muted' })[props.descale.level])
const litres = computed(() => (props.descale.litresSince === null ? '—' : props.descale.litresSince.toFixed(1)))
const estimate = computed(() => {
  const d = props.descale
  if (d.level === 'unknown') return 'The estimate needs the brewer\'s totals.'
  if (d.dueInDays === 0) return 'The threshold has been reached.'
  if (d.dueInDays === null) return 'An estimate appears after a few days of logged brews.'
  const days = Math.max(1, Math.round(d.dueInDays))
  const basis = d.paceBasis === 'log' ? 'the brew log' : 'the litres since the last mark'
  return `At your pace, about ${days} day${days === 1 ? '' : 's'} to go, around ${formatDate(d.dueAt)}, judging by ${basis}.`
})
</script>

<template>
  <UCard :ui="{ body: 'space-y-4' }">
    <div>
      <p class="text-sm text-muted">
        Descale
      </p>
      <p class="mt-1 text-xl font-semibold" :class="headlineClass">
        {{ headline }}
      </p>
      <p class="mt-1 text-sm text-muted">
        {{ descale.markedAt ? `Since ${formatDateTime(descale.markedAt)} (${formatAgo(descale.markedAt)})` : 'Since the brewer\'s first brew; never marked' }}
      </p>
    </div>

    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-muted">
          Water since
        </dt>
        <dd class="tabular text-lg font-medium">
          {{ litres }} of {{ descale.thresholdLitres }} L
        </dd>
      </div>
      <div>
        <dt class="text-muted">
          Brews since
        </dt>
        <dd class="tabular text-lg font-medium">
          {{ descale.brewsSince ?? '—' }}<span v-if="descale.thresholdBrews"> of {{ descale.thresholdBrews }}</span>
        </dd>
      </div>
    </dl>

    <UProgress :model-value="percent" :color="color" size="sm" />

    <p v-if="descale.cleaningMl" class="text-xs text-muted">
      Cleaning cycles since then used {{ (descale.cleaningMl / 1000).toFixed(1) }} L and counted as {{ descale.cleaningBrews }} brew{{ descale.cleaningBrews === 1 ? '' : 's' }} on the brewer; both are left out.
    </p>

    <p class="text-xs text-muted">
      {{ estimate }}
    </p>

    <UButton icon="i-lucide-droplets" label="Mark descaled" color="neutral" variant="outline" block @click="confirming = true" />

    <ConfirmModal
      v-model:open="confirming"
      title="Mark the brewer as descaled?"
      description="The tally restarts from the brewer's current totals. Only aiden-studio's own record changes; nothing is sent to Fellow."
      confirm-label="Mark descaled"
      :loading="marking"
      @confirm="mark"
    />
  </UCard>
</template>
