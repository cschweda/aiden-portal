<script setup lang="ts">
import type { Profile } from '#shared/types/api'
import { blankSchedule, secondsToTime, timeToSeconds } from '../utils/schedule-form'

const props = defineProps<{ profiles: Profile[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const { call } = useApi()

const time = ref('07:00')
const days = ref<boolean[]>([])
const amountOfWater = ref(950)
const profileId = ref<string | undefined>(undefined)
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  const blank = blankSchedule(props.profiles[0]?.id ?? 'p1')
  time.value = secondsToTime(blank.secondFromStartOfTheDay)
  days.value = [...blank.days]
  amountOfWater.value = blank.amountOfWater
  profileId.value = props.profiles[0]?.id
})

const profileItems = computed(() => props.profiles.map(p => ({ label: p.title, value: p.id })))
const canSave = computed(() => Boolean(profileId.value) && days.value.some(Boolean) && /^\d{1,2}:\d{2}$/.test(time.value))

async function submit() {
  if (!canSave.value || !profileId.value) return
  saving.value = true
  try {
    await call('/api/schedules', {
      method: 'POST',
      body: {
        days: days.value,
        secondFromStartOfTheDay: timeToSeconds(time.value),
        enabled: true,
        amountOfWater: amountOfWater.value,
        profileId: profileId.value,
      },
    })
    emit('saved')
    open.value = false
  }
  catch {
    // Toast already shown.
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <USlideover v-model:open="open" title="New schedule" description="The brewer starts on its own at this time on the chosen days.">
    <template #body>
      <form class="space-y-6" @submit.prevent="submit">
        <UFormField label="Time" hint="brewer local time">
          <UInput v-model="time" type="time" class="w-40 tabular" />
        </UFormField>

        <UFormField label="Days">
          <DayChips v-model="days" />
        </UFormField>

        <UFormField label="Water" hint="150 to 1500 ml">
          <UInputNumber v-model="amountOfWater" :min="150" :max="1500" :step="10" class="w-40" />
        </UFormField>

        <UFormField label="Profile">
          <USelectMenu v-model="profileId" :items="profileItems" value-key="value" placeholder="Choose a profile" class="w-full" />
        </UFormField>

        <div class="flex justify-end gap-2 border-t border-default pt-6">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" label="Create schedule" :loading="saving" :disabled="!canSave" />
        </div>
      </form>
    </template>
  </USlideover>
</template>
