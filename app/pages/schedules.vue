<script setup lang="ts">
useHead({ title: 'Schedules' })
</script>

<template>
  <UDashboardPanel id="schedules">
    <template #header>
      <UDashboardNavbar title="Schedules">
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
