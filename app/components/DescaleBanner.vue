<script setup lang="ts">
import type { DescaleStatus } from '#shared/types/api'
import { formatDate, formatDateTime } from '../utils/format'

const props = defineProps<{ descale: DescaleStatus }>()
const emit = defineEmits<{ marked: [] }>()
const { confirming, marking, mark } = useDescaleMark(() => emit('marked'))

const shown = computed(() => props.descale.level === 'amber' || props.descale.level === 'red')
const color = computed(() => (props.descale.level === 'red' ? 'error' : 'warning'))
const title = computed(() => (props.descale.level === 'red' ? 'Descale now' : 'Descale soon'))
const description = computed(() => {
  const d = props.descale
  const litres = d.litresSince === null ? '—' : d.litresSince.toFixed(1)
  const since = d.markedAt ? `since ${formatDateTime(d.markedAt)}` : 'since the brewer\'s first brew, never marked'
  const brews = d.brewsSince === null ? '' : ` and ${d.brewsSince} brew${d.brewsSince === 1 ? '' : 's'}`
  const pace = d.dueInDays !== null && d.dueInDays > 0
    ? ` At your pace, about ${Math.max(1, Math.round(d.dueInDays))} day${Math.round(d.dueInDays) === 1 ? '' : 's'} to go, around ${formatDate(d.dueAt)}.`
    : ''
  return `${litres} of ${d.thresholdLitres} L${brews} ${since}.${pace}`
})
const actions = computed(() => [{
  label: 'Mark descaled',
  icon: 'i-lucide-droplets',
  color: 'neutral' as const,
  variant: 'outline' as const,
  onClick: () => (confirming.value = true),
}])
</script>

<template>
  <div v-if="shown">
    <UAlert :color="color" variant="subtle" icon="i-lucide-droplets" :title="title" :description="description" :actions="actions" orientation="horizontal" />
    <ConfirmModal
      v-model:open="confirming"
      title="Mark the brewer as descaled?"
      description="The tally restarts from the brewer's current totals. Only aiden-studio's own record changes; nothing is sent to Fellow."
      confirm-label="Mark descaled"
      :loading="marking"
      @confirm="mark"
    />
  </div>
</template>
