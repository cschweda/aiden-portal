<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { public: { app } } = useRuntimeConfig()
const { status } = useStatus()

const items: NavigationMenuItem[] = [
  { label: 'Dashboard', icon: 'i-lucide-gauge', to: '/' },
  { label: 'Profiles', icon: 'i-lucide-sliders-horizontal', to: '/profiles' },
  { label: 'Schedules', icon: 'i-lucide-alarm-clock', to: '/schedules' },
  { label: 'Logs', icon: 'i-lucide-scroll-text', to: '/logs' },
]
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar id="nav" :min-size="14" :default-size="16" :max-size="22" resizable>
      <template #header>
        <div class="flex items-center gap-2.5 px-1.5">
          <span class="size-2.5 rounded-full bg-primary" aria-hidden="true" />
          <span class="font-semibold tracking-tight">{{ app.name }}</span>
        </div>
      </template>

      <UNavigationMenu :items="items" orientation="vertical" />

      <template #footer>
        <div class="flex w-full items-center justify-between">
          <span class="font-mono text-xs text-muted">v{{ status?.version ?? '…' }}</span>
          <ColorModeToggle />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
