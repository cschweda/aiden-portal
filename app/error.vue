<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()
</script>

<template>
  <UApp>
    <main class="min-h-screen flex items-center justify-center p-8">
      <div class="max-w-md space-y-4">
        <p class="font-mono text-sm text-muted">
          {{ error.statusCode }}
        </p>
        <h1 class="text-2xl font-semibold">
          {{ error.statusCode === 404 ? 'There is nothing at this address.' : 'Something broke.' }}
        </h1>
        <p class="text-muted">
          {{ error.statusCode === 404 ? 'Check the link, or head back to the dashboard.' : error.message }}
        </p>
        <UButton to="/" label="Go to the dashboard" @click="clearError({ redirect: '/' })" />
      </div>
    </main>
  </UApp>
</template>
