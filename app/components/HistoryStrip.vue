<script setup lang="ts">
import type { DescaleStatus, HistoryStats } from '#shared/types/api'
import { formatLitresFromMl } from '../utils/format'

const props = defineProps<{ stats: HistoryStats, descale?: DescaleStatus | null }>()

/** A standing reminder, long before the banner appears: how far through a descale cycle the brewer is. */
const descaleTile = computed(() => {
  const d = props.descale
  if (!d || d.level === 'unknown') return null
  const brews = d.thresholdBrews && d.brewsSince !== null ? `${d.brewsSince} of ${d.thresholdBrews} brews` : `${d.brewsSince ?? '—'} brews`
  const litres = d.litresSince === null ? '' : `${d.litresSince.toFixed(1)} of ${d.thresholdLitres} L`
  const percent = d.ratio === null ? 0 : Math.min(100, Math.round(d.ratio * 100))
  return { brews, litres, percent, level: d.level, color: ({ ok: 'success', amber: 'warning', red: 'error' } as const)[d.level] }
})

const tiles = computed(() => {
  const s = props.stats
  const period = (label: string, p: { brews: number, waterMl: number }) => ({ label, value: String(p.brews), sub: p.brews ? formatLitresFromMl(p.waterMl) : 'no brews' })
  return [
    period('Today', s.today),
    period('This week', s.thisWeek),
    period('This month', s.thisMonth),
    {
      label: 'Most used profile',
      value: s.favouriteProfile?.title ?? s.favouriteProfile?.profileId ?? '—',
      sub: s.favouriteProfile ? `${s.favouriteProfile.brews} of ${s.logged.brews} logged brew${s.logged.brews === 1 ? '' : 's'}` : 'no brews logged yet',
    },
  ]
})
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-baseline justify-between">
      <h3 class="text-base font-semibold">
        Brews
      </h3>
      <UButton to="/history" variant="link" color="neutral" label="History" trailing-icon="i-lucide-chevron-right" size="sm" />
    </div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <div v-for="tile in tiles" :key="tile.label" class="rounded-lg border border-default px-4 py-3">
        <p class="text-sm text-muted">
          {{ tile.label }}
        </p>
        <p class="tabular truncate text-2xl font-semibold">
          {{ tile.value }}
        </p>
        <p class="text-xs text-muted">
          {{ tile.sub }}
        </p>
      </div>

      <div v-if="descaleTile" class="flex flex-col gap-1.5 rounded-lg border border-default px-4 py-3">
        <p class="text-sm text-muted">
          Since descale
        </p>
        <p class="tabular truncate text-2xl font-semibold">
          {{ descaleTile.brews }}
        </p>
        <UProgress :model-value="descaleTile.percent" :color="descaleTile.color" size="xs" />
        <p class="tabular text-xs text-muted">
          {{ descaleTile.litres }}
        </p>
      </div>
    </div>
  </section>
</template>
