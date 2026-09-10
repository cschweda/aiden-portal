<script setup lang="ts">
useHead({ title: 'Profiles' })
</script>

<template>
  <UDashboardPanel id="profiles">
    <template #header>
      <UDashboardNavbar title="Profiles">
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
