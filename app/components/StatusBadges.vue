<script setup lang="ts">
const { status } = useStatus()

const fellow = computed(() => {
  const value = status.value?.fellow ?? 'unknown'
  if (value === 'ok') return { label: 'Fellow connected', color: 'success' as const }
  if (value === 'unknown') return { label: 'Fellow not contacted yet', color: 'neutral' as const }
  return { label: `Fellow: ${value}`, color: 'error' as const }
})
</script>

<template>
  <div class="flex items-center gap-2">
    <UBadge v-if="status?.dryRun" color="warning" variant="subtle" label="Dry run" />
    <UTooltip :text="fellow.label">
      <UBadge :color="fellow.color" variant="subtle" class="gap-1.5">
        <span class="size-1.5 rounded-full bg-current" />
        <span class="sr-only sm:not-sr-only">{{ fellow.color === 'success' ? 'Fellow' : fellow.color === 'neutral' ? 'Fellow' : 'Fellow error' }}</span>
      </UBadge>
    </UTooltip>
  </div>
</template>
