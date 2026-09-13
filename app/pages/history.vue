<script setup lang="ts">
import type { BrewRecord, BrewSummary, HistoryResponse } from '#shared/types/api'
import { describeCountdown } from '../utils/countdown'
import { formatAgo, formatDateTime, formatDuration, formatHours, formatLitresFromMl, formatMillilitres, formatTime } from '../utils/format'

useHead({ title: 'History' })

const history = useApiFetch<HistoryResponse>('/api/history', { key: 'history' })
const { call } = useApi()

const selected = ref<BrewRecord | null>(null)
const loadingTrace = ref<string | null>(null)
async function showTrace(brew: BrewSummary) {
  loadingTrace.value = brew.id
  try {
    selected.value = await call<BrewRecord>(`/api/history/brews/${brew.id}`)
  }
  catch {
    // useApi already showed the reason.
  }
  finally {
    loadingTrace.value = null
  }
}

const live = computed(() => history.data.value?.current ?? null)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 1_000)
})
onBeforeUnmount(() => clearInterval(clock))
const countdown = computed(() => (live.value ? describeCountdown(live.value.expected, (now.value - live.value.startedAt) / 1000) : ''))
const traced = computed(() => selected.value ?? history.data.value?.lastTraced ?? null)

// While a brew runs the trace grows every few seconds; otherwise the page only re-reads on request.
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll = setInterval(() => {
    if (history.data.value?.current || history.data.value?.cleanings.current) void history.reload()
  }, 5_000)
})
onBeforeUnmount(() => clearInterval(poll))

const tiles = computed(() => {
  const s = history.data.value?.stats
  if (!s) return []
  const period = (label: string, p: { brews: number, waterMl: number }) => ({ label, value: String(p.brews), sub: p.brews ? formatLitresFromMl(p.waterMl) : 'no brews' })
  return [
    period('Today', s.today),
    period('This week', s.thisWeek),
    period('This month', s.thisMonth),
    { label: 'Logged', value: String(s.logged.brews), sub: s.logged.since ? `since ${formatDateTime(s.logged.since)}` : 'nothing yet' },
    { label: 'Average brew', value: formatDuration(s.averageDurationS), sub: 'watched brews only' },
    { label: 'Between brews', value: formatHours(s.averageBetweenBrewsH), sub: 'last thirty brews' },
    { label: 'Most used profile', value: s.favouriteProfile?.title ?? s.favouriteProfile?.profileId ?? '—', sub: s.favouriteProfile ? `${s.favouriteProfile.brews} brew${s.favouriteProfile.brews === 1 ? '' : 's'}` : 'no brews logged yet' },
    { label: 'Last brew', value: s.lastBrewAt ? formatAgo(s.lastBrewAt) : '—', sub: s.lastBrewAt ? formatDateTime(s.lastBrewAt) : 'nothing yet' },
  ]
})

function kind(brew: BrewSummary): { label: string, color: 'success' | 'neutral' | 'warning' } {
  if (!brew.observed) return { label: 'Inferred', color: 'neutral' }
  if (!brew.counted) return { label: 'Not counted', color: 'warning' }
  return { label: 'Watched', color: 'success' }
}

const pollingLine = computed(() => {
  const p = history.data.value?.polling
  if (!p) return ''
  const store = history.data.value?.storeError
  if (store) return `The history directory cannot be used (${store}); nothing is being logged.`
  if (!p.enabled) return 'Background reads are off (HISTORY_ENABLED=false); the log only grows while a page is open.'
  const last = p.lastPollAt ? `last read ${formatTime(p.lastPollAt)}` : 'no read yet'
  const trouble = p.failures ? `, ${p.failures} failed in a row (${p.lastError})` : ''
  return `Reading the brewer every ${p.idlePollSeconds} s, every ${p.brewPollSeconds} s during a brew; ${last}${trouble}.`
})
</script>

<template>
  <UDashboardPanel id="history">
    <template #header>
      <UDashboardNavbar title="History">
        <template #right>
          <StatusBadges />
          <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" aria-label="Re-read the history" :loading="history.loading.value" @click="history.reload()" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-8">
        <ApiErrorAlert v-if="history.failure.value" :failure="history.failure.value" what="the brew history" :stale="history.stale.value" />

        <div v-if="history.loading.value && !history.data.value" class="space-y-4">
          <USkeleton class="h-24 w-full" />
          <USkeleton class="h-56 w-full" />
        </div>

        <template v-else-if="history.data.value">
          <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          </section>

          <section v-if="live" class="space-y-3">
            <div class="flex items-baseline justify-between">
              <h3 class="text-base font-semibold">
                Brewing now
              </h3>
              <p class="text-sm text-muted">
                {{ live.profileTitle ?? live.profileId ?? 'selected profile' }} · started {{ formatTime(live.startedAt) }}<template v-if="countdown"> · {{ countdown }}</template>
              </p>
            </div>
            <BrewTraceChart :samples="live.samples" :started-at="live.startedAt" :interval-s="history.data.value.polling.brewPollSeconds" :idle-poll-s="history.data.value.polling.idlePollSeconds" :expected-s="live.expected?.seconds ?? null" :target="live.target ?? null" />
          </section>

          <section v-if="traced" class="space-y-3">
            <div class="flex items-baseline justify-between gap-4">
              <h3 class="text-base font-semibold">
                {{ selected ? 'Brew trace' : 'Last brew' }}
              </h3>
              <p class="truncate text-sm text-muted">
                {{ traced.profileTitle ?? traced.profileId ?? 'selected profile' }} · {{ formatDateTime(traced.startedAt) }} · {{ formatDuration(traced.durationS) }} · {{ formatMillilitres(traced.waterMl ?? undefined) }}
              </p>
            </div>
            <BrewTraceChart :samples="traced.samples" :started-at="traced.startedAt" :interval-s="history.data.value.polling.brewPollSeconds" :idle-poll-s="history.data.value.polling.idlePollSeconds" :target="traced.target ?? null" />
          </section>

          <section class="space-y-3">
            <h3 class="text-base font-semibold">
              Brews
            </h3>
            <p v-if="history.data.value.recent.length === 0" class="text-sm text-muted">
              Nothing logged yet. Brews are logged as they happen, and brews the app missed are inferred from the brewer's counter.
            </p>
            <ul v-else class="divide-y divide-default rounded-lg border border-default">
              <li v-for="brew in history.data.value.recent" :key="brew.id" class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span class="tabular w-36 shrink-0">{{ formatDateTime(brew.startedAt) }}</span>
                <span class="min-w-0 flex-1 truncate">{{ brew.profileTitle ?? brew.profileId ?? 'selected profile unknown' }}</span>
                <span class="tabular w-24 text-muted">{{ formatDuration(brew.durationS) }}</span>
                <span class="tabular w-20 text-muted">{{ formatMillilitres(brew.waterMl ?? undefined) }}</span>
                <UBadge :label="kind(brew).label" :color="kind(brew).color" variant="subtle" size="sm" />
                <UButton v-if="brew.sampleCount > 0" label="Trace" size="xs" variant="ghost" color="neutral" :loading="loadingTrace === brew.id" @click="showTrace(brew)" />
              </li>
            </ul>
            <p class="text-xs text-muted">
              The profile is the one selected on the brewer when the brew was seen; Fellow does not report which profile ran.
              <template v-if="history.data.value.skippedLines">
                {{ history.data.value.skippedLines }} unreadable line{{ history.data.value.skippedLines === 1 ? '' : 's' }} in the log were skipped.
              </template>
            </p>
          </section>

          <section class="space-y-3">
            <h3 class="text-base font-semibold">
              Descale
            </h3>
            <p class="text-sm text-muted">
              The tally and the Mark descaled button are on the dashboard, beside the totals they count from.
            </p>
            <div class="grid gap-4 sm:grid-cols-3">
              <div class="rounded-lg border border-default px-4 py-3">
                <p class="text-sm text-muted">
                  Cleaning cycles seen
                </p>
                <p class="tabular text-2xl font-semibold">
                  {{ history.data.value.cleanings.count }}
                </p>
                <p class="text-xs text-muted">
                  {{ history.data.value.cleanings.current ? `one running since ${formatTime(history.data.value.cleanings.current.startedAt)}` : 'none running' }}
                </p>
              </div>
              <div class="rounded-lg border border-default px-4 py-3">
                <p class="text-sm text-muted">
                  Last cycle ended
                </p>
                <p class="tabular text-2xl font-semibold">
                  {{ history.data.value.cleanings.lastEndedAt ? formatAgo(history.data.value.cleanings.lastEndedAt) : '—' }}
                </p>
                <p class="text-xs text-muted">
                  {{ history.data.value.cleanings.lastEndedAt ? formatDateTime(history.data.value.cleanings.lastEndedAt) : 'no cycle seen yet' }}
                </p>
              </div>
              <div class="rounded-lg border border-default px-4 py-3">
                <p class="text-sm text-muted">
                  Average cycle
                </p>
                <p class="tabular text-2xl font-semibold">
                  {{ formatDuration(history.data.value.cleanings.averageDurationS) }}
                </p>
                <p class="text-xs text-muted">
                  cycles watched from the start
                </p>
              </div>
            </div>
            <ul v-if="history.data.value.cleanings.recent.length" class="divide-y divide-default rounded-lg border border-default text-sm">
              <li v-for="cycle in history.data.value.cleanings.recent" :key="cycle.id" class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                <span class="tabular w-36 shrink-0">{{ formatDateTime(cycle.startedAt) }}</span>
                <span class="w-16">{{ cycle.kind === 'clean' ? 'Descale' : 'Rinse' }}</span>
                <span class="tabular w-24 text-muted">{{ formatDuration(cycle.durationS) }}</span>
                <span class="tabular w-20 text-muted">{{ formatMillilitres(cycle.waterMl ?? undefined) }}</span>
                <span class="text-xs text-muted">ended {{ formatTime(cycle.endedAt) }}<template v-if="cycle.cyclesDelta"> · counted as {{ cycle.cyclesDelta }} brew{{ cycle.cyclesDelta === 1 ? '' : 's' }} by the brewer</template></span>
                <UBadge v-if="!cycle.observedStart" label="Seen mid-way" color="neutral" variant="subtle" size="sm" />
              </li>
            </ul>
            <p class="text-xs text-muted">
              Marked descaled:
            </p>
            <p v-if="!history.data.value.descaleHistory.length" class="text-sm text-muted">
              Never marked yet.
            </p>
            <ul v-if="history.data.value.descaleHistory.length" class="divide-y divide-default rounded-lg border border-default text-sm">
              <li v-for="mark in [...history.data.value.descaleHistory].reverse()" :key="mark.at" class="flex flex-wrap gap-x-4 px-4 py-2">
                <span class="tabular w-36">{{ formatDateTime(mark.at) }}</span>
                <span class="text-muted">at {{ mark.brews ?? '—' }} brews and {{ formatLitresFromMl(mark.waterMl ?? undefined) }} lifetime</span>
              </li>
            </ul>
          </section>

          <p class="text-xs text-muted">
            {{ pollingLine }}
          </p>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
