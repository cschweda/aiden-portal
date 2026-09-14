<script setup lang="ts">
import type { DeviceResponse, HistoryResponse, Profile } from '#shared/types/api'
import { isBrewing } from '../../server/lib/fellow/device'
import { formatClock } from '../utils/format'
import { describeProfile } from '../utils/profile-form'

const props = defineProps<{
  data: DeviceResponse
  profiles: Profile[]
  /** The brew in progress, so the card can count rather than offer a button that would be refused. */
  live?: HistoryResponse['current'] | null
  now?: number
}>()
/** Emitted after every attempt, successful or not, so the parent re-reads the brewer. */
const emit = defineEmits<{ done: [] }>()

const { public: { app } } = useRuntimeConfig()
const { call } = useApi()
const toast = useToast()

const profile = computed(() => props.profiles.find(p => p.id === props.data.device.ibSelectedProfileId))
const confirming = ref(false)
const starting = ref(false)
const brewerName = computed(() => props.data.device.displayName ?? 'The brewer')
const brewing = computed(() => isBrewing(props.data.device) === true)
/** Seconds into the brew, for the card's own clock. Falls back to nothing until the tracker reports a start. */
const elapsed = computed(() => {
  const started = props.live?.startedAt
  if (!started || props.now === undefined) return null
  return Math.max(0, (props.now - started) / 1000)
})

function requestStart() {
  if (app.ui.confirmBrewStart) confirming.value = true
  else void start()
}

async function start() {
  starting.value = true
  try {
    const result = await call<{ ok: true, result: { dryRun?: boolean } }>('/api/brew/start', { method: 'POST' })
    toast.add({
      title: result.result.dryRun ? 'Dry run: no brew was started' : 'Brew started',
      description: profile.value?.title,
      color: result.result.dryRun ? 'warning' : 'success',
      icon: 'i-lucide-coffee',
    })
  }
  catch {
    // useApi already showed the server's reason, including the blockers on a 409.
  }
  finally {
    starting.value = false
    confirming.value = false
    emit('done')
  }
}
</script>

<template>
  <UCard :ui="{ body: 'space-y-5' }">
    <div>
      <p class="text-sm text-muted">
        Instant Brew
      </p>
      <p class="mt-1 text-xl font-semibold">
        {{ profile?.title ?? 'No profile selected on the brewer' }}
      </p>
      <p v-if="profile" class="mt-1 text-sm text-muted">
        {{ describeProfile(profile) }}
      </p>
    </div>

    <!-- Mid-brew the button has nothing to offer, so the space carries the clock instead. -->
    <div
      v-if="brewing"
      class="flex items-center justify-center gap-3 rounded-lg bg-success/10 px-4 py-3 text-success ring-1 ring-success/30"
      role="status"
    >
      <UIcon name="i-lucide-coffee" class="size-5 shrink-0" />
      <span class="font-medium">Brewing</span>
      <span v-if="elapsed !== null" class="font-mono text-xl font-semibold tabular tracking-tight">{{ formatClock(elapsed) }}</span>
    </div>

    <UButton
      v-else
      size="xl"
      icon="i-lucide-coffee"
      :label="data.canStartBrew ? 'Start brew' : 'Brewer is not ready'"
      :disabled="!data.canStartBrew"
      :loading="starting"
      block
      @click="requestStart"
    />

    <p class="text-xs text-muted">
      {{ brewing ? 'The brewer finishes on its own; the clock above counts from when this app first saw the brew.' : 'Uses the profile selected on the brewer itself; Fellow does not allow choosing it remotely.' }}
    </p>

    <ConfirmModal
      v-model:open="confirming"
      title="Start a brew?"
      :description="profile ? `${brewerName} will brew ${profile.title} now.` : `${brewerName} will brew its selected profile now.`"
      confirm-label="Start brew"
      :loading="starting"
      @confirm="start"
    />
  </UCard>
</template>
