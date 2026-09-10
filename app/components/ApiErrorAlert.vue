<script setup lang="ts">
import type { ApiFailure } from '../utils/api-error'

const props = defineProps<{
  failure: ApiFailure
  /** What could not be read, in the sentence "Could not read <what>". */
  what: string
  /** The page still shows data from before the failure. */
  stale?: boolean
}>()

const authFailed = computed(() => props.failure.code === 'fellow_auth_failed')
const title = computed(() => {
  if (authFailed.value) return 'Fellow rejected the login'
  return props.stale ? `Could not refresh ${props.what}; showing the last known state` : `Could not read ${props.what}`
})
const description = computed(() =>
  authFailed.value ? 'Check FELLOW_EMAIL and FELLOW_PASSWORD in .env, then restart the app.' : props.failure.message,
)
</script>

<template>
  <UAlert :color="stale ? 'warning' : 'error'" variant="subtle" :icon="authFailed ? 'i-lucide-key-round' : 'i-lucide-cloud-off'" :title="title">
    <template #description>
      <span>{{ description }}</span>
      <span class="ml-2 font-mono text-xs opacity-80">{{ failure.code }}</span>
    </template>
  </UAlert>
</template>
