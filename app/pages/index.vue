<script setup lang="ts">
import type { DeviceResponse, HistoryResponse, Profile } from '#shared/types/api'
import { isBrewing } from '../../server/lib/fellow/device'
import { describeCountdown } from '../utils/countdown'
import { formatDateTime, formatTime } from '../utils/format'

useHead({ title: 'Dashboard' })

const demo = useRuntimeConfig().public.demo === true

const { refresh: refreshStatus } = useStatus()
const device = useApiFetch<DeviceResponse>('/api/device', { key: 'device' })
const profiles = useApiFetch<Profile[]>('/api/profiles', { key: 'profiles', defaultValue: () => [] })
const history = useApiFetch<HistoryResponse>('/api/history', { key: 'history' })

async function refreshNow() {
  await Promise.all([device.reload({ fresh: true }), profiles.reload({ fresh: true }), history.reload()])
  await refreshStatus()
}

// While a brew runs, keep the readout and the trace current without the user pressing anything.
let poll: ReturnType<typeof setInterval> | undefined
let ticks = 0
onMounted(() => {
  poll = setInterval(() => {
    ticks += 1
    const brewing = (device.data.value && isBrewing(device.data.value.device)) || history.data.value?.current || history.data.value?.cleanings.current
    if (!brewing) return
    void history.reload()
    if (ticks % 3 === 0) void device.reload({ fresh: true }).then(() => refreshStatus())
  }, 5_000)
})
onBeforeUnmount(() => clearInterval(poll))

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 1_000)
})
onBeforeUnmount(() => clearInterval(clock))

const trace = computed(() => {
  const h = history.data.value
  if (!h) return null
  if (h.current) return { title: 'Brewing now', brew: h.current, live: true, expected: h.current.expected }
  if (h.lastTraced) return { title: 'Last brew', brew: h.lastTraced, live: false, expected: null }
  return null
})
const countdown = computed(() => (trace.value?.live ? describeCountdown(trace.value.expected, (now.value - trace.value.brew.startedAt) / 1000) : ''))

// When the readings on screen were fetched, so a stale panel is never mistaken for a live one.
const readAt = ref<number | null>(null)
watch(() => device.data.value, (value) => {
  if (value) readAt.value = Date.now()
})
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #right>
          <StatusBadges />
          <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" aria-label="Refresh from the brewer" :loading="device.loading.value" @click="refreshNow" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-8">
        <DemoBanner v-if="demo" />
        <ApiErrorAlert v-if="device.failure.value" :failure="device.failure.value" what="the brewer" :stale="device.stale.value" />
        <DescaleBanner v-if="history.data.value" :descale="history.data.value.descale" :cleaning="history.data.value.cleanings.current" :last-cleaning-ended-at="history.data.value.cleanings.lastEndedAt" @marked="history.reload()" />

        <div v-if="device.loading.value && !device.data.value" class="space-y-4">
          <USkeleton class="h-4 w-32" />
          <USkeleton class="h-12 w-48" />
          <USkeleton class="h-6 w-full max-w-lg" />
        </div>

        <div v-else-if="device.data.value" class="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <BrewerReadout :data="device.data.value" />
          <InstantBrewCard :data="device.data.value" :profiles="profiles.data.value ?? []" @done="refreshNow" />
        </div>

        <ApiErrorAlert v-if="profiles.failure.value && !device.failure.value" :failure="profiles.failure.value" what="the profiles" :stale="profiles.stale.value" />

        <SensorPanel v-if="device.data.value" :data="device.data.value" :profiles="profiles.data.value ?? []" :read-at="readAt" :coffee="history.data.value?.coffee ?? null" :descale="history.data.value?.descale ?? null" @marked="history.reload()" />

        <ApiErrorAlert v-if="history.failure.value && !device.failure.value" :failure="history.failure.value" what="the brew history" :stale="history.stale.value" />
        <HistoryStrip v-if="history.data.value" :stats="history.data.value.stats" />

        <section v-if="trace && history.data.value" class="space-y-3">
          <div class="flex items-baseline justify-between gap-4">
            <h3 class="text-base font-semibold">
              {{ trace.title }}
            </h3>
            <p class="truncate text-sm text-muted">
              {{ trace.brew.profileTitle ?? trace.brew.profileId ?? 'selected profile' }} · {{ trace.live ? `started ${formatTime(trace.brew.startedAt)}` : formatDateTime(trace.brew.startedAt) }}<template v-if="countdown"> · {{ countdown }}</template>
            </p>
          </div>
          <BrewTraceChart :samples="trace.brew.samples" :started-at="trace.brew.startedAt" :interval-s="history.data.value.polling.brewPollSeconds" :idle-poll-s="history.data.value.polling.idlePollSeconds" :expected-s="trace.expected?.seconds ?? null" :target="trace.brew.target ?? null" />
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
