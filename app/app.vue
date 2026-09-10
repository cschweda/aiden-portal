<script setup lang="ts">
const { public: { app } } = useRuntimeConfig()
useHead({ titleTemplate: title => (title ? `${title} · ${app.name}` : app.name) })
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
