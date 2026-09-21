<script setup lang="ts">
import type { DeviceResponse, HistoryResponse, Profile } from '#shared/types/api'
import { isBrewing } from '../../server/lib/fellow/device'
import { formatClock } from '../utils/format'
import { lastBrewedLabel, presetHeadline, startConfirmation } from '../utils/instant-brew'
import type { LastBrew } from '../utils/instant-brew'
import { describeProfile } from '../utils/profile-form'

const props = defineProps<{
  data: DeviceResponse
  profiles: Profile[]
  /** The brew in progress, so the card can count rather than offer a button that would be refused. */
  live?: HistoryResponse['current'] | null
  /** The newest brew in the log, shown beside the preset because the two are easily taken for one another. */
  lastBrew?: LastBrew | null
  /** When the brewer last reported a change: the preset is only as fresh as that. */
  reportedAt?: number | null
  now?: number
}>()
/** Emitted after every attempt, successful or not, so the parent re-reads the brewer. */
const emit = defineEmits<{ done: [] }>()

const { public: { app } } = useRuntimeConfig()
const { call } = useApi()
const toast = useToast()

// The Instant Brew preset: what a remote start runs. It is not the profile last dialled in on the machine.
const profile = computed(() => props.profiles.find(p => p.id === props.data.device.ibSelectedProfileId))
const headline = computed(() => presetHeadline(profile.value?.title, props.data.device.ibSelectedProfileId, props.data.device.ibWaterQuantity))
const lastBrewed = computed(() => lastBrewedLabel(props.lastBrew, props.now ?? Date.now()))
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
      description: headline.value ?? undefined,
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
        Instant Brew preset
      </p>
      <p class="mt-1 text-xl font-semibold">
        {{ headline ?? 'No Instant Brew preset reported' }}
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

    <p v-if="lastBrewed" class="text-sm">
      <span class="text-muted">Last brewed:</span> {{ lastBrewed }}
    </p>

    <p class="text-xs text-muted">
      {{ brewing ? 'The brewer finishes on its own; the clock above counts from when this app first saw the brew.' : 'Set on the brewer, separately from the profile you dial in for a brew; Fellow does not allow changing it remotely. This is what the brewer last reported, so a change made on the machine can take a while to show.' }}
    </p>

    <ConfirmModal
      v-model:open="confirming"
      title="Start a brew?"
      :description="startConfirmation(brewerName, headline, reportedAt)"
      confirm-label="Start brew"
      :loading="starting"
      @confirm="start"
    />
  </UCard>
</template>
