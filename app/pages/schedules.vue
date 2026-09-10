<script setup lang="ts">
import type { Profile, Schedule } from '#shared/types/api'
import { describeDays, secondsToTime } from '../utils/schedule-form'

useHead({ title: 'Schedules' })

const route = useRoute()
const { call } = useApi()
const toast = useToast()
const { refresh: refreshStatus } = useStatus()

const forceFresh = ref(false)
const query = computed(() => (forceFresh.value ? { fresh: 1 } : {}))
const { data: schedules, refresh, status } = useFetch<Schedule[]>('/api/schedules', { query, watch: false, default: () => [] })
const { data: profiles, refresh: refreshProfiles } = useFetch<Profile[]>('/api/profiles', { query, watch: false, default: () => [] })

async function reload(fresh = false) {
  forceFresh.value = fresh
  try {
    await Promise.all([refresh(), refreshProfiles()])
  }
  finally {
    forceFresh.value = false
    await refreshStatus()
  }
}

const titleOf = (profileId: string | undefined) => profiles.value.find(p => p.id === profileId)?.title ?? profileId ?? '—'

const formOpen = ref(false)
const deleting = ref<Schedule | null>(null)
const deleteOpen = computed({ get: () => deleting.value !== null, set: (v) => { if (!v) deleting.value = null } })
const busyId = ref<string | null>(null)

async function toggle(schedule: Schedule, enabled: boolean) {
  busyId.value = schedule.id
  try {
    await call(`/api/schedules/${schedule.id}`, { method: 'PATCH', body: { enabled } })
    toast.add({ title: enabled ? 'Schedule enabled' : 'Schedule paused', description: `${secondsToTime(schedule.secondFromStartOfTheDay ?? 0)} · ${describeDays(schedule.days ?? [])}`, color: 'success', icon: 'i-lucide-check' })
    await reload(true)
  }
  catch {
    // Toast already shown.
  }
  finally {
    busyId.value = null
  }
}

async function onSaved() {
  toast.add({ title: 'Schedule created', color: 'success', icon: 'i-lucide-check' })
  await reload(true)
}

async function confirmDelete() {
  const schedule = deleting.value
  if (!schedule) return
  busyId.value = schedule.id
  try {
    await call(`/api/schedules/${schedule.id}`, { method: 'DELETE' })
    toast.add({ title: 'Schedule deleted', color: 'success', icon: 'i-lucide-check' })
    deleting.value = null
    await reload(true)
  }
  catch {
    // Toast already shown.
  }
  finally {
    busyId.value = null
  }
}

onMounted(() => {
  if (route.query.new !== undefined) formOpen.value = true
})
</script>

<template>
  <UDashboardPanel id="schedules">
    <template #header>
      <UDashboardNavbar title="Schedules">
        <template #right>
          <StatusBadges />
          <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" aria-label="Refresh from the brewer" :loading="status === 'pending'" @click="reload(true)" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <div class="flex flex-wrap items-center gap-2">
          <UButton icon="i-lucide-plus" label="New schedule" :disabled="!profiles.length" @click="formOpen = true" />
          <span class="ml-auto text-sm text-muted">Times are the brewer's local time</span>
        </div>

        <div v-if="status === 'pending' && !schedules.length" class="space-y-3">
          <USkeleton v-for="i in 2" :key="i" class="h-16 w-full" />
        </div>

        <UEmpty
          v-else-if="!schedules.length"
          icon="i-lucide-alarm-clock"
          title="No schedules"
          description="Add one and the brewer will start on its own."
        />

        <ul v-else class="divide-y divide-default rounded-lg border border-default">
          <li v-for="schedule in schedules" :key="schedule.id" class="flex items-center gap-4 px-4 py-3" :class="{ 'opacity-60': schedule.enabled === false }">
            <p class="tabular w-20 text-2xl font-semibold">
              {{ secondsToTime(schedule.secondFromStartOfTheDay ?? 0) }}
            </p>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">
                {{ titleOf(schedule.profileId) }}
              </p>
              <p class="truncate text-sm text-muted">
                {{ describeDays(schedule.days ?? []) }} · {{ schedule.amountOfWater ?? '—' }} ml
              </p>
            </div>
            <span class="font-mono text-xs text-muted">{{ schedule.id }}</span>
            <USwitch :model-value="schedule.enabled !== false" :loading="busyId === schedule.id" :aria-label="schedule.enabled === false ? 'Enable schedule' : 'Pause schedule'" @update:model-value="toggle(schedule, $event)" />
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" aria-label="Delete" @click="deleting = schedule" />
          </li>
        </ul>
      </div>

      <ScheduleForm v-model:open="formOpen" :profiles="profiles" @saved="onSaved" />
      <ConfirmModal
        v-model:open="deleteOpen"
        title="Delete this schedule?"
        :description="deleting ? `The ${secondsToTime(deleting.secondFromStartOfTheDay ?? 0)} brew on ${describeDays(deleting.days ?? []).toLowerCase()} will no longer run.` : ''"
        confirm-label="Delete schedule"
        destructive
        :loading="busyId !== null"
        @confirm="confirmDelete"
      />
    </template>
  </UDashboardPanel>
</template>
