<script setup lang="ts">
import type { DeviceResponse, Profile } from '#shared/types/api'
import { describeProfile } from '../utils/profile-form'

const props = defineProps<{ data: DeviceResponse, profiles: Profile[] }>()
/** Emitted after every attempt, successful or not, so the parent re-reads the brewer. */
const emit = defineEmits<{ done: [] }>()

const { public: { app } } = useRuntimeConfig()
const { call } = useApi()
const toast = useToast()

const profile = computed(() => props.profiles.find(p => p.id === props.data.device.ibSelectedProfileId))
const confirming = ref(false)
const starting = ref(false)
const brewerName = computed(() => props.data.device.displayName ?? 'The brewer')

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

    <UButton
      size="xl"
      icon="i-lucide-coffee"
      :label="data.canStartBrew ? 'Start brew' : 'Brewer is not ready'"
      :disabled="!data.canStartBrew"
      :loading="starting"
      block
      @click="requestStart"
    />

    <p class="text-xs text-muted">
      Uses the profile selected on the brewer itself; Fellow does not allow choosing it remotely.
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
