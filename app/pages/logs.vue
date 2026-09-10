<script setup lang="ts">
useHead({ title: 'Logs' })
</script>

<template>
  <UDashboardPanel id="logs">
    <template #header>
      <UDashboardNavbar title="Logs">
        <template #right>
          <StatusBadges />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-5xl">
        <p class="text-muted">
          Coming in this checkpoint.
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
