<script setup lang="ts">
import type { Profile } from '#shared/types/api'
import { describeProfile } from '../utils/profile-form'

useHead({ title: 'Profiles' })

const route = useRoute()
const { call } = useApi()
const toast = useToast()
const { refresh: refreshStatus } = useStatus()

const resource = useApiFetch<Profile[]>('/api/profiles', { key: 'profiles', defaultValue: () => [] })
const profiles = computed(() => resource.data.value ?? [])

async function reload(fresh = false) {
  await resource.reload({ fresh })
  await refreshStatus()
}

const editorOpen = ref(false)
const editing = ref<Profile | null>(null)
const importOpen = ref(false)
const shareOpen = ref(false)
const shareLink = ref('')
const shareTitle = ref('')
const deleting = ref<Profile | null>(null)
const deleteOpen = computed({ get: () => deleting.value !== null, set: (v) => { if (!v) deleting.value = null } })
const busy = ref(false)

function create() {
  editing.value = null
  editorOpen.value = true
}

function edit(profile: Profile) {
  editing.value = profile
  editorOpen.value = true
}

async function onSaved(title: string) {
  editorOpen.value = false
  toast.add({ title: editing.value ? 'Profile saved' : 'Profile created', description: title, color: 'success', icon: 'i-lucide-check' })
  await reload(true)
}

async function onImported(profile: Profile) {
  toast.add({ title: 'Profile imported', description: profile.title, color: 'success', icon: 'i-lucide-check' })
  await reload(true)
}

async function share(profile: Profile) {
  busy.value = true
  try {
    const { link } = await call<{ link: string }>(`/api/profiles/${profile.id}/share`, { method: 'POST' })
    shareLink.value = link
    shareTitle.value = profile.title
    shareOpen.value = true
  }
  catch {
    // Toast already shown.
  }
  finally {
    busy.value = false
  }
}

async function confirmDelete() {
  const profile = deleting.value
  if (!profile) return
  busy.value = true
  try {
    await call(`/api/profiles/${profile.id}`, { method: 'DELETE' })
    toast.add({ title: 'Profile deleted', description: profile.title, color: 'success', icon: 'i-lucide-check' })
    deleting.value = null
    await reload(true)
  }
  catch {
    // Toast already shown.
  }
  finally {
    busy.value = false
  }
}

onMounted(() => {
  if (route.query.new !== undefined) create()
})
</script>

<template>
  <UDashboardPanel id="profiles">
    <template #header>
      <UDashboardNavbar title="Profiles">
        <template #right>
          <StatusBadges />
          <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" aria-label="Refresh from the brewer" :loading="resource.loading.value" @click="reload(true)" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <div class="flex flex-wrap items-center gap-2">
          <UButton icon="i-lucide-plus" label="New profile" @click="create" />
          <UButton icon="i-lucide-link" label="Import from brew.link" color="neutral" variant="outline" @click="importOpen = true" />
          <span class="ml-auto text-sm text-muted">{{ profiles.length }} on the brewer</span>
        </div>

        <ApiErrorAlert v-if="resource.failure.value" :failure="resource.failure.value" what="the profiles" :stale="resource.stale.value" />

        <div v-if="resource.loading.value && !profiles.length" class="space-y-3">
          <USkeleton v-for="i in 3" :key="i" class="h-16 w-full" />
        </div>

        <UEmpty
          v-else-if="!profiles.length && !resource.failure.value"
          icon="i-lucide-coffee"
          title="No profiles yet"
          description="Create one from scratch or import a recipe someone shared with you."
        />

        <ul v-else class="divide-y divide-default rounded-lg border border-default">
          <li v-for="profile in profiles" :key="profile.id" class="flex items-center gap-4 px-4 py-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="truncate font-medium">
                  {{ profile.title }}
                </p>
                <UBadge v-if="profile.isDefaultProfile" label="Default" color="neutral" variant="subtle" size="sm" />
                <UBadge v-if="profile.instantBrew" label="Instant Brew" color="primary" variant="subtle" size="sm" />
              </div>
              <p class="truncate text-sm text-muted">
                {{ describeProfile(profile) }}
              </p>
            </div>
            <span class="font-mono text-xs text-muted">{{ profile.id }}</span>
            <div class="flex items-center gap-1">
              <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" aria-label="Edit" @click="edit(profile)" />
              <UButton icon="i-lucide-share-2" color="neutral" variant="ghost" size="sm" aria-label="Share" :disabled="busy" @click="share(profile)" />
              <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" aria-label="Delete" @click="deleting = profile" />
            </div>
          </li>
        </ul>
      </div>

      <ProfileEditor v-model:open="editorOpen" :profile="editing" @saved="onSaved" />
      <ImportProfileModal v-model:open="importOpen" @imported="onImported" />
      <ShareLinkModal v-model:open="shareOpen" :link="shareLink" :title="shareTitle" />
      <ConfirmModal
        v-model:open="deleteOpen"
        title="Delete this profile?"
        :description="deleting ? `${deleting.title} will be removed from the brewer. Schedules that use it will stop working.` : ''"
        confirm-label="Delete profile"
        destructive
        :loading="busy"
        @confirm="confirmDelete"
      />
    </template>
  </UDashboardPanel>
</template>
