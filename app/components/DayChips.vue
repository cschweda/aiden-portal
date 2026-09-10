<script setup lang="ts">
import { DAY_LABELS } from '../utils/schedule-form'

const days = defineModel<boolean[]>({ required: true })

function toggle(index: number) {
  days.value = days.value.map((on, i) => (i === index ? !on : on))
}
</script>

<template>
  <div class="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
    <UButton
      v-for="(label, i) in DAY_LABELS"
      :key="label"
      :label="label"
      size="sm"
      :color="days[i] ? 'primary' : 'neutral'"
      :variant="days[i] ? 'solid' : 'outline'"
      :aria-pressed="days[i]"
      class="w-12 justify-center"
      @click="toggle(i)"
    />
  </div>
</template>
