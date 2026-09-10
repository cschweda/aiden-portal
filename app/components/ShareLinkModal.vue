<script setup lang="ts">
const props = defineProps<{ link: string, title: string }>()
const open = defineModel<boolean>('open', { required: true })
const toast = useToast()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.link)
    toast.add({ title: 'Link copied', description: props.link, color: 'success', icon: 'i-lucide-clipboard-check' })
  }
  catch {
    toast.add({ title: 'Could not copy', description: 'Select the link and copy it by hand.', color: 'error' })
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Share link" :description="`Anyone with this link can import ${title} into their own Aiden.`">
    <template #body>
      <div class="flex items-center gap-2">
        <UInput :model-value="link" readonly class="flex-1 font-mono" />
        <UButton icon="i-lucide-copy" label="Copy" color="neutral" variant="outline" @click="copy" />
      </div>
    </template>
  </UModal>
</template>
