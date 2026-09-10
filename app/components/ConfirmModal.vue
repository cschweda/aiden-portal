<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  confirmLabel: string
  destructive?: boolean
  loading?: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="description">
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton :color="destructive ? 'error' : 'primary'" :label="confirmLabel" :loading="loading" @click="emit('confirm')" />
      </div>
    </template>
  </UModal>
</template>
