<script setup lang="ts">
import type { DeviceResponse, Profile } from '#shared/types/api'
import { isBrewing } from '../../server/lib/fellow/device'
import { describeProfile } from '../utils/profile-form'

useHead({ title: 'Dashboard' })

const { refresh: refreshStatus } = useStatus()
const device = useApiFetch<DeviceResponse>('/api/device', { key: 'device' })
const profiles = useApiFetch<Profile[]>('/api/profiles', { key: 'profiles', defaultValue: () => [] })

async function refreshNow() {
  await Promise.all([device.reload({ fresh: true }), profiles.reload({ fresh: true })])
  await refreshStatus()
}

// While a brew runs, keep the readout current without the user pressing anything. Profiles do not change mid-brew.
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll = setInterval(() => {
    if (device.data.value && isBrewing(device.data.value.device)) void device.reload({ fresh: true }).then(() => refreshStatus())
  }, 15_000)
})
onBeforeUnmount(() => clearInterval(poll))

const quickProfiles = computed(() => (profiles.data.value ?? []).slice(0, 6))
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
        <ApiErrorAlert v-if="device.failure.value" :failure="device.failure.value" what="the brewer" :stale="device.stale.value" />

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

        <section v-if="quickProfiles.length" class="space-y-3">
          <div class="flex items-baseline justify-between">
            <h3 class="text-base font-semibold">
              Profiles
            </h3>
            <UButton to="/profiles" variant="link" color="neutral" label="Manage" trailing-icon="i-lucide-chevron-right" size="sm" />
          </div>
          <ul class="divide-y divide-default rounded-lg border border-default">
            <li v-for="profile in quickProfiles" :key="profile.id" class="flex items-center justify-between gap-4 px-4 py-3">
              <div class="min-w-0">
                <p class="truncate font-medium">
                  {{ profile.title }}
                </p>
                <p class="truncate text-sm text-muted">
                  {{ describeProfile(profile) }}
                </p>
              </div>
              <span class="font-mono text-xs text-muted">{{ profile.id }}</span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
