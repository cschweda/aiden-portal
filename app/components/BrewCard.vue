<script setup lang="ts">
import type { DeviceResponse, HistoryResponse, Profile } from '#shared/types/api'
import { isBrewing } from '../../server/lib/fellow/device'
import { lastBrewHeadline, lastBrewWhen } from '../utils/brew-card'
import type { LastBrew } from '../utils/brew-card'
import { formatClock, formatHourMinute } from '../utils/format'
import { describeProfile } from '../utils/profile-form'

/**
 * The brew the dashboard is about: the one running, else the newest in the log.
 *
 * There is deliberately no remote start here. Every brew on this brewer is dialled in on the machine, under Guided
 * Brew. A remote start runs something else, the brewer's separate Instant Brew preset (see ARCHITECTURE.md), and a
 * card built around it once passed that preset off as the profile in use. `POST /api/brew/start` is still there.
 */
const props = defineProps<{
  data: DeviceResponse
  profiles: Profile[]
  /** The brew in progress, with when the tracker first saw it. */
  live?: HistoryResponse['current'] | null
  /** The newest brew in the log. */
  lastBrew?: LastBrew | null
  now?: number
}>()

const brewing = computed(() => isBrewing(props.data.device) === true)
const shown = computed(() => (brewing.value ? props.live ?? null : props.lastBrew ?? null))
const headline = computed(() => {
  if (brewing.value) return props.live?.profileTitle ?? props.live?.profileId ?? 'profile not reported'
  return props.lastBrew ? lastBrewHeadline(props.lastBrew) : 'Nothing logged yet'
})
const when = computed(() => {
  if (brewing.value) return props.live ? `started ${formatHourMinute(props.live.startedAt)}` : null
  return props.lastBrew ? lastBrewWhen(props.lastBrew, props.now ?? Date.now()) : null
})
// The profile as it stands now: one edited since the brew reads as edited. The trace keeps the temperatures that ran.
const recipe = computed(() => props.profiles.find(p => p.id === shown.value?.profileId))
/** Seconds into the brew, for the card's own clock. Falls back to nothing until the tracker reports a start. */
const elapsed = computed(() => {
  const started = props.live?.startedAt
  if (!started || props.now === undefined) return null
  return Math.max(0, (props.now - started) / 1000)
})
</script>

<template>
  <UCard :ui="{ body: 'space-y-5' }">
    <div>
      <p class="text-sm text-muted">
        {{ brewing ? 'Brewing now' : 'Last brew' }}
      </p>
      <p class="mt-1 text-xl font-semibold">
        {{ headline }}
      </p>
      <p v-if="when" class="tabular mt-1 text-sm">
        {{ when }}
      </p>
      <p v-if="recipe" class="mt-1 text-sm text-muted">
        {{ describeProfile(recipe) }}
      </p>
    </div>

    <template v-if="brewing">
      <div
        class="flex items-center justify-center gap-3 rounded-lg bg-success/10 px-4 py-3 text-success ring-1 ring-success/30"
        role="status"
      >
        <UIcon name="i-lucide-coffee" class="size-5 shrink-0" />
        <span class="font-medium">Brewing</span>
        <span v-if="elapsed !== null" class="font-mono text-xl font-semibold tabular tracking-tight">{{ formatClock(elapsed) }}</span>
      </div>
      <p class="text-xs text-muted">
        The brewer finishes on its own; the clock above counts from when this app first saw the brew.
      </p>
    </template>
  </UCard>
</template>
