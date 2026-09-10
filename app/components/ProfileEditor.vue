<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Profile } from '#shared/types/api'
import { type ProfileInput, ProfileInputSchema } from '../../server/lib/fellow/schemas'
import { describeApiError } from '../utils/api-error'
import { blankProfile, PROFILE_LIMITS, syncPulseTemperatures, toProfileInput } from '../utils/profile-form'

const props = defineProps<{ profile: Profile | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [title: string] }>()

const { call } = useApi()
const form = useTemplateRef('form')
const state = reactive<ProfileInput>(blankProfile())
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(state, props.profile ? toProfileInput(props.profile) : blankProfile())
  form.value?.clear()
})

// The per-pulse temperature inputs follow the pulse counts.
watch(() => [state.ssPulsesNumber, state.batchPulsesNumber], () => {
  const synced = syncPulseTemperatures(state)
  state.ssPulseTemperatures = synced.ssPulseTemperatures
  state.batchPulseTemperatures = synced.batchPulseTemperatures
})

const isEdit = computed(() => props.profile !== null)

async function onSubmit(event: FormSubmitEvent<ProfileInput>) {
  saving.value = true
  try {
    if (props.profile) {
      await call(`/api/profiles/${props.profile.id}`, { method: 'PATCH', body: event.data })
    }
    else {
      await call('/api/profiles', { method: 'POST', body: event.data })
    }
    emit('saved', event.data.title)
  }
  catch (error) {
    const failure = describeApiError(error)
    if (failure.issues) form.value?.setErrors(failure.issues.map(issue => ({ name: issue.path, message: issue.message })))
  }
  finally {
    saving.value = false
  }
}

const limits = PROFILE_LIMITS
</script>

<template>
  <USlideover v-model:open="open" :title="isEdit ? 'Edit profile' : 'New profile'" :description="isEdit ? profile?.title : 'Every value the brewer accepts, in its exact steps.'" :ui="{ content: 'sm:max-w-xl' }">
    <template #body>
      <UForm ref="form" :schema="ProfileInputSchema" :state="state" class="space-y-8" @submit="onSubmit">
        <section class="space-y-4">
          <UFormField label="Name" name="title" hint="Up to 50 characters">
            <UInput v-model="state.title" placeholder="Morning batch" class="w-full" autofocus />
          </UFormField>

          <UFormField label="Coffee to water ratio" name="ratio" :hint="`1:${state.ratio}`">
            <div class="flex items-center gap-4">
              <USlider v-model="state.ratio" :min="limits.ratio.min" :max="limits.ratio.max" :step="limits.ratio.step" class="flex-1" />
              <UInputNumber v-model="state.ratio" :min="limits.ratio.min" :max="limits.ratio.max" :step="limits.ratio.step" class="w-28" />
            </div>
          </UFormField>

          <UFormField label="Brew temperature" name="overallTemperature" :hint="`${state.overallTemperature}°C`">
            <div class="flex items-center gap-4">
              <USlider v-model="state.overallTemperature" :min="limits.overallTemperature.min" :max="limits.overallTemperature.max" :step="limits.overallTemperature.step" class="flex-1" />
              <UInputNumber v-model="state.overallTemperature" :min="limits.overallTemperature.min" :max="limits.overallTemperature.max" :step="limits.overallTemperature.step" class="w-28" />
            </div>
          </UFormField>
        </section>

        <section class="space-y-4 border-t border-default pt-6">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">
              Bloom
            </h3>
            <USwitch v-model="state.bloomEnabled" :label="state.bloomEnabled ? 'On' : 'Off'" />
          </div>
          <div class="grid gap-4 sm:grid-cols-3" :class="{ 'opacity-50': !state.bloomEnabled }">
            <UFormField label="Ratio" name="bloomRatio" :hint="`${state.bloomRatio}:1`">
              <UInputNumber v-model="state.bloomRatio" :min="limits.bloomRatio.min" :max="limits.bloomRatio.max" :step="limits.bloomRatio.step" :disabled="!state.bloomEnabled" class="w-full" />
            </UFormField>
            <UFormField label="Duration" name="bloomDuration" hint="seconds">
              <UInputNumber v-model="state.bloomDuration" :min="limits.bloomDuration.min" :max="limits.bloomDuration.max" :disabled="!state.bloomEnabled" class="w-full" />
            </UFormField>
            <UFormField label="Temperature" name="bloomTemperature" hint="°C">
              <UInputNumber v-model="state.bloomTemperature" :min="limits.bloomTemperature.min" :max="limits.bloomTemperature.max" :step="limits.bloomTemperature.step" :disabled="!state.bloomEnabled" class="w-full" />
            </UFormField>
          </div>
        </section>

        <section class="space-y-4 border-t border-default pt-6">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">
              Single-serve pulses
            </h3>
            <USwitch v-model="state.ssPulsesEnabled" :label="state.ssPulsesEnabled ? 'On' : 'Off'" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2" :class="{ 'opacity-50': !state.ssPulsesEnabled }">
            <UFormField label="Pulses" name="ssPulsesNumber">
              <UInputNumber v-model="state.ssPulsesNumber" :min="limits.pulsesNumber.min" :max="limits.pulsesNumber.max" :disabled="!state.ssPulsesEnabled" class="w-full" />
            </UFormField>
            <UFormField label="Interval" name="ssPulsesInterval" hint="seconds">
              <UInputNumber v-model="state.ssPulsesInterval" :min="limits.pulsesInterval.min" :max="limits.pulsesInterval.max" :disabled="!state.ssPulsesEnabled" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Temperature per pulse" name="ssPulseTemperatures" :error-pattern="/^ssPulseTemperatures/" hint="°C">
            <div class="flex flex-wrap gap-2" :class="{ 'opacity-50': !state.ssPulsesEnabled }">
              <UInputNumber v-for="(_, i) in state.ssPulseTemperatures" :key="i" v-model="state.ssPulseTemperatures[i]" :min="limits.pulseTemperature.min" :max="limits.pulseTemperature.max" :step="limits.pulseTemperature.step" :disabled="!state.ssPulsesEnabled" class="w-28" :aria-label="`Pulse ${i + 1} temperature`" />
            </div>
          </UFormField>
        </section>

        <section class="space-y-4 border-t border-default pt-6">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">
              Batch pulses
            </h3>
            <USwitch v-model="state.batchPulsesEnabled" :label="state.batchPulsesEnabled ? 'On' : 'Off'" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2" :class="{ 'opacity-50': !state.batchPulsesEnabled }">
            <UFormField label="Pulses" name="batchPulsesNumber">
              <UInputNumber v-model="state.batchPulsesNumber" :min="limits.pulsesNumber.min" :max="limits.pulsesNumber.max" :disabled="!state.batchPulsesEnabled" class="w-full" />
            </UFormField>
            <UFormField label="Interval" name="batchPulsesInterval" hint="seconds">
              <UInputNumber v-model="state.batchPulsesInterval" :min="limits.pulsesInterval.min" :max="limits.pulsesInterval.max" :disabled="!state.batchPulsesEnabled" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Temperature per pulse" name="batchPulseTemperatures" :error-pattern="/^batchPulseTemperatures/" hint="°C">
            <div class="flex flex-wrap gap-2" :class="{ 'opacity-50': !state.batchPulsesEnabled }">
              <UInputNumber v-for="(_, i) in state.batchPulseTemperatures" :key="i" v-model="state.batchPulseTemperatures[i]" :min="limits.pulseTemperature.min" :max="limits.pulseTemperature.max" :step="limits.pulseTemperature.step" :disabled="!state.batchPulsesEnabled" class="w-28" :aria-label="`Pulse ${i + 1} temperature`" />
            </div>
          </UFormField>
        </section>

        <div class="flex justify-end gap-2 border-t border-default pt-6">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" :label="isEdit ? 'Save changes' : 'Create profile'" :loading="saving" />
        </div>
      </UForm>
    </template>
  </USlideover>
</template>
