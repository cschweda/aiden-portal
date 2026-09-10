<script setup lang="ts">
import type { DeviceResponse, Profile } from '#shared/types/api'
import { describeApiError } from '../utils/api-error'
import { describeProfile } from '../utils/profile-form'

useHead({ title: 'Dashboard' })

const { status, refresh: refreshStatus } = useStatus()
const forceFresh = ref(false)
const query = computed(() => (forceFresh.value ? { fresh: 1 } : {}))

const { data: deviceData, refresh: refreshDevice, status: deviceStatus, error: deviceError } = useFetch<DeviceResponse>('/api/device', { query, watch: false })
const { data: profiles, refresh: refreshProfiles } = useFetch<Profile[]>('/api/profiles', { query, watch: false, default: () => [] })

const refreshing = ref(false)
async function refreshNow() {
  refreshing.value = true
  forceFresh.value = true
  try {
    await Promise.all([refreshDevice(), refreshProfiles()])
  }
  finally {
    forceFresh.value = false
    refreshing.value = false
    await refreshStatus()
  }
}

// While a brew runs, keep the readout current without the user pressing anything.
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll = setInterval(() => {
    if (deviceData.value?.device.brewing) void refreshNow()
  }, 15_000)
})
onBeforeUnmount(() => clearInterval(poll))

const quickProfiles = computed(() => profiles.value.slice(0, 6))
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #right>
          <StatusBadges />
          <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" aria-label="Refresh from the brewer" :loading="refreshing" @click="refreshNow" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-8">
        <UAlert
          v-if="status?.fellow === 'fellow_auth_failed'"
          color="error"
          variant="subtle"
          icon="i-lucide-key-round"
          title="Fellow rejected the login"
          description="Check FELLOW_EMAIL and FELLOW_PASSWORD in .env, then restart the app."
        />
        <UAlert
          v-else-if="deviceError"
          color="error"
          variant="subtle"
          icon="i-lucide-cloud-off"
          title="The brewer could not be read"
          :description="describeApiError(deviceError).message"
        />

        <div v-if="deviceStatus === 'pending' && !deviceData" class="space-y-4">
          <USkeleton class="h-4 w-32" />
          <USkeleton class="h-12 w-48" />
          <USkeleton class="h-6 w-full max-w-lg" />
        </div>

        <div v-else-if="deviceData" class="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <BrewerReadout :data="deviceData" />
          <InstantBrewCard :data="deviceData" :profiles="profiles" @started="refreshNow" />
        </div>

        <section v-if="profiles.length" class="space-y-3">
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
