<script setup lang="ts">
import type { DeviceResponse, Profile } from '#shared/types/api'
import { describeProfile } from '../utils/profile-form'

const props = defineProps<{ data: DeviceResponse, profiles: Profile[] }>()
const emit = defineEmits<{ started: [] }>()

const { public: { app } } = useRuntimeConfig()
const { call } = useApi()
const toast = useToast()

const profile = computed(() => props.profiles.find(p => p.id === props.data.device.ibSelectedProfileId))
const confirming = ref(false)
const starting = ref(false)

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
      description: profile.value ? profile.value.title : undefined,
      color: result.result.dryRun ? 'warning' : 'success',
      icon: 'i-lucide-coffee',
    })
    emit('started')
  }
  catch {
    // The toast is already on screen.
  }
  finally {
    starting.value = false
    confirming.value = false
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

    <UModal v-model:open="confirming" title="Start a brew?" :description="profile ? `${data.device.displayName ?? 'The brewer'} will brew ${profile.title} now.` : `${data.device.displayName ?? 'The brewer'} will brew its selected profile now.`">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="confirming = false" />
          <UButton icon="i-lucide-coffee" label="Start brew" :loading="starting" @click="start" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
