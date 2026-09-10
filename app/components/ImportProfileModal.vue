<script setup lang="ts">
import type { Profile } from '#shared/types/api'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ imported: [profile: Profile] }>()
const { call } = useApi()

const link = ref('')
const busy = ref(false)

watch(open, (isOpen) => {
  if (isOpen) link.value = ''
})

async function submit() {
  if (!link.value.trim()) return
  busy.value = true
  try {
    const profile = await call<Profile>('/api/profiles/import', { method: 'POST', body: { link: link.value.trim() } })
    emit('imported', profile)
    open.value = false
  }
  catch {
    // The toast is already on screen.
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Import from brew.link" description="Paste a brew.link URL or just the id at the end of it. The recipe is copied to your brewer as a new profile.">
    <template #body>
      <form class="flex items-center gap-2" @submit.prevent="submit">
        <UInput v-model="link" placeholder="https://brew.link/p/ws98" class="flex-1 font-mono" autofocus />
        <UButton type="submit" label="Import" :loading="busy" :disabled="!link.trim()" />
      </form>
    </template>
  </UModal>
</template>
