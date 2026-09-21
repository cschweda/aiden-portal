<script setup lang="ts">
import { formatMillilitres } from '../utils/format'

/** Emitted once a simulated brew is under way, so the page re-reads the brewer straight away. */
const emit = defineEmits<{ brew: [] }>()

const open = ref(true)
// Horizontal keeps the buttons on the text's row, which squeezes the words to one per line on a phone.
const wide = useWideScreen()
const { call } = useApi()
const toast = useToast()
const starting = ref(false)

// The app has no way to start a brew: on a real brewer someone dials one in on the machine. This stands in for them,
// and lives here rather than in the app's own pages so that the demo still shows exactly what the app shows.
async function simulate() {
  starting.value = true
  try {
    const brew = await call<{ profileTitle: string | null, waterMl: number }>('/api/demo/brew', { method: 'POST' })
    toast.add({
      title: 'A brew has started on the sample brewer',
      description: `${brew.profileTitle ?? 'A profile'}, ${formatMillilitres(brew.waterMl)}, as if dialled in on the machine. It runs for under two minutes.`,
      color: 'success',
      icon: 'i-lucide-coffee',
    })
    emit('brew')
  }
  catch {
    // useApi already said why; while a brew runs, that one is in progress.
  }
  finally {
    starting.value = false
  }
}
</script>

<template>
  <UAlert
    v-if="open"
    color="primary"
    variant="subtle"
    icon="i-lucide-flask-conical"
    title="Demo — sample data, no brewer attached"
    description="Every number here is invented and lives in your browser. Simulate a brew and watch the trace fill in, edit profiles, mark a descale: nothing leaves this page, and a reload starts over."
    :orientation="wide ? 'horizontal' : 'vertical'"
    :actions="[
      { label: 'Simulate a brew', icon: 'i-lucide-coffee', color: 'primary', variant: 'solid', loading: starting, onClick: simulate },
      { label: 'Source on GitHub', icon: 'i-lucide-github', color: 'neutral', variant: 'outline', to: 'https://github.com/cschweda/aiden-portal', target: '_blank' },
      { label: 'Start over', icon: 'i-lucide-rotate-ccw', color: 'neutral', variant: 'ghost', onClick: () => reloadNuxtApp({ force: true }) },
    ]"
    close
    @update:open="open = $event"
  />
</template>
