<script setup lang="ts">
const open = ref(true)
// Horizontal keeps the buttons on the text's row, which squeezes the words to one per line on a phone.
const wide = useWideScreen()
</script>

<template>
  <UAlert
    v-if="open"
    color="primary"
    variant="subtle"
    icon="i-lucide-flask-conical"
    title="Demo — sample data, no brewer attached"
    description="Every number here is invented and lives in your browser. Edit profiles, start a brew and watch the trace fill in, mark a descale: nothing leaves this page, and a reload starts over."
    :orientation="wide ? 'horizontal' : 'vertical'"
    :actions="[
      { label: 'Source on GitHub', icon: 'i-lucide-github', color: 'neutral', variant: 'outline', to: 'https://github.com/cschweda/aiden-portal', target: '_blank' },
      { label: 'Start over', icon: 'i-lucide-rotate-ccw', color: 'neutral', variant: 'ghost', onClick: () => reloadNuxtApp({ force: true }) },
    ]"
    close
    @update:open="open = $event"
  />
</template>
