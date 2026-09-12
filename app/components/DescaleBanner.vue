<script setup lang="ts">
import type { CurrentCleaning, DescaleStatus } from '#shared/types/api'
import { formatAgo, formatDate, formatDateTime, formatTime } from '../utils/format'

const props = defineProps<{ descale: DescaleStatus, cleaning?: CurrentCleaning | null, lastCleaningEndedAt?: number | null }>()

/** A descale program pauses a few minutes between its phases; ten quiet minutes means it has finished. */
const PROGRAM_GAP_MS = 10 * 60_000
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 15_000)
})
onBeforeUnmount(() => clearInterval(clock))
const emit = defineEmits<{ marked: [] }>()
const { confirming, marking, mark } = useDescaleMark(() => emit('marked'))

/** A cycle that ended after the last mark (or with no mark) within the last day is worth a prompt. */
const finishedUnmarked = computed(() => {
  const ended = props.lastCleaningEndedAt ?? null
  if (ended === null || now.value - ended > 86_400_000) return false
  return (props.descale.markedAt ?? 0) < ended
})
const pausing = computed(() => {
  const ended = props.lastCleaningEndedAt ?? null
  return ended !== null && now.value - ended < PROGRAM_GAP_MS && (props.descale.markedAt ?? 0) < ended
})
type Mode = 'running' | 'pausing' | 'finished' | 'due' | 'hidden'
const mode = computed<Mode>(() => {
  if (props.cleaning) return 'running'
  if (pausing.value) return 'pausing'
  if (finishedUnmarked.value) return 'finished'
  if (props.descale.level === 'amber' || props.descale.level === 'red') return 'due'
  return 'hidden'
})
const shown = computed(() => mode.value !== 'hidden')
const color = computed(() => (mode.value === 'running' || mode.value === 'pausing' ? 'info' : mode.value === 'finished' ? 'success' : props.descale.level === 'red' ? 'error' : 'warning'))
const icon = computed(() => (mode.value === 'running' || mode.value === 'pausing' ? 'i-lucide-loader-circle' : 'i-lucide-droplets'))
const title = computed(() => {
  if (mode.value === 'running') return props.cleaning?.kind === 'rinse' ? 'Rinse running' : 'Descale cycle running'
  if (mode.value === 'pausing') return 'Descale program pausing between phases'
  if (mode.value === 'finished') return 'Descale cycle finished'
  return props.descale.level === 'red' ? 'Descale now' : 'Descale soon'
})
const description = computed(() => {
  const d = props.descale
  if (mode.value === 'running' && props.cleaning) return `This phase started ${formatTime(props.cleaning.startedAt)} (${formatAgo(props.cleaning.startedAt)}). Mark it descaled once the whole program is done.`
  if (mode.value === 'pausing' && props.lastCleaningEndedAt) return `The last phase ended ${formatTime(props.lastCleaningEndedAt)}; the brewer waits a few minutes between phases.`
  if (mode.value === 'finished' && props.lastCleaningEndedAt) return `Ended ${formatTime(props.lastCleaningEndedAt)} (${formatAgo(props.lastCleaningEndedAt)}). If that was a descale, mark it so the tally restarts.`
  const litres = d.litresSince === null ? '—' : d.litresSince.toFixed(1)
  const since = d.markedAt ? `since ${formatDateTime(d.markedAt)}` : 'since the brewer\'s first brew, never marked'
  const brews = d.brewsSince === null ? '' : ` and ${d.brewsSince} brew${d.brewsSince === 1 ? '' : 's'}`
  const pace = d.dueInDays !== null && d.dueInDays > 0
    ? ` At your pace, about ${Math.max(1, Math.round(d.dueInDays))} day${Math.round(d.dueInDays) === 1 ? '' : 's'} to go, around ${formatDate(d.dueAt)}.`
    : ''
  return `${litres} of ${d.thresholdLitres} L${brews} ${since}.${pace}`
})
const actions = computed(() => mode.value === 'running' || mode.value === 'pausing' ? [] : [{
  label: 'Mark descaled',
  icon: 'i-lucide-droplets',
  color: 'neutral' as const,
  variant: 'outline' as const,
  onClick: () => (confirming.value = true),
}])
</script>

<template>
  <div v-if="shown">
    <UAlert :color="color" variant="subtle" :icon="icon" :title="title" :description="description" :actions="actions" orientation="horizontal" />
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
