<script setup lang="ts">
import type { DeviceResponse, Profile } from '#shared/types/api'
import { brewPhase } from '../../server/lib/fellow/device'
import { formatAgo, formatDateTime, formatLitresFromMl, formatMillilitres, formatTemperature, formatTime } from '../utils/format'

const props = defineProps<{ data: DeviceResponse, profiles: Profile[], readAt: number | null }>()

type Tone = 'default' | 'success' | 'error' | 'neutral' | 'primary'
interface Reading { label: string, value: string, tone?: Tone, mono?: boolean }
interface Group { title: string, readings: Reading[] }

const toneClass: Record<Tone, string> = {
  default: '',
  success: 'text-success',
  error: 'text-error',
  neutral: 'text-muted',
  primary: 'text-primary',
}

const unreported = (label: string): Reading => ({ label, value: '—', tone: 'neutral' })

/** A reported boolean as one of two words, each with its own tone. */
function flag(label: string, value: boolean | undefined, on: string, off: string, onTone: Tone = 'default', offTone: Tone = 'default'): Reading {
  if (value === undefined) return unreported(label)
  return value ? { label, value: on, tone: onTone } : { label, value: off, tone: offTone }
}

/** A timestamp as local time plus how long ago. */
function when(label: string, value: string | number | undefined): Reading {
  return value === undefined ? unreported(label) : { label, value: `${formatDateTime(value)} (${formatAgo(value)})` }
}

function text(label: string, value: string | number | undefined, mono = false): Reading {
  return value === undefined ? unreported(label) : { label, value: String(value), mono }
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

const groups = computed<Group[]>(() => {
  const d = props.data.device
  const phase = brewPhase(d)
  const instantProfile = props.profiles.find(p => p.id === d.ibSelectedProfileId)
  const averageMl = d.totalBrewingCycles && d.totalWaterVolumeL !== undefined ? d.totalWaterVolumeL / d.totalBrewingCycles : undefined
  return [
    {
      title: 'Right now',
      readings: [
        phase === 'unknown'
          ? unreported('Brew phase')
          : { label: 'Brew phase', value: capitalise(phase), tone: phase === 'idle' ? 'default' : 'primary' },
        flag('Heater', d.heaterOn, 'On', 'Off', 'primary'),
        flag('Pump', d.pumpOn, 'On', 'Off', 'primary'),
        // Only where a brewer reports it. This one never does, and a row that is always a dash is just noise.
        ...(d.brewingWaterTemperatureC === undefined ? [] : [{ label: 'Water temperature', value: formatTemperature(d.brewingWaterTemperatureC) }]),
        text('Last cycle water', d.brewingWaterVolumeMl === undefined ? undefined : formatMillilitres(d.brewingWaterVolumeMl)),
        when('Last cycle started', d.brewStartTime),
        flag('Cleaning', d.cleaning, 'Running', 'No', 'primary'),
        flag('Rinsing', d.rinsing, 'Running', 'No', 'primary'),
        ...(d.brewError === undefined ? [] : [flag('Brew error', d.brewError, 'Yes', 'None', 'error', 'success')]),
      ],
    },
    {
      title: 'Hardware',
      readings: [
        flag('Cloud connection', d.isConnected, 'Connected', 'Offline', 'success', 'error'),
        when('Connected since', d.connectionTimestamp),
        flag('Lid', d.lidClosed, 'Closed', 'Open', 'success', 'error'),
        flag('Water tank', d.missingWater === undefined ? undefined : !d.missingWater, 'Water present', 'Empty', 'success', 'error'),
        flag('Carafe', d.carafePresent, 'In place', 'Out', 'success', 'error'),
        flag('Single-serve basket', d.singleBrewBasketPresent, 'In', 'Out', 'success'),
        flag('Batch basket', d.batchBrewBasketPresent, 'In', 'Out', 'success'),
        text('Firmware', d.firmwareVersion, true),
        flag('Firmware update', d.firmwareUpgradeRequired, 'Required', 'Up to date', 'error', 'success'),
        ...(d.unsynced === undefined
          ? []
          : [{ label: 'Unsynced changes', value: d.unsynced.length === 0 ? 'None' : String(d.unsynced.length), tone: (d.unsynced.length === 0 ? 'success' : 'error') as Tone }]),
      ],
    },
    {
      title: 'Totals',
      readings: [
        text('Brews', d.totalBrewingCycles),
        text('Water brewed', d.totalWaterVolumeL === undefined ? undefined : formatLitresFromMl(d.totalWaterVolumeL)),
        text('Average per brew', averageMl === undefined ? undefined : formatMillilitres(averageMl)),
      ],
    },
    {
      title: 'Brewer settings',
      readings: [
        text('Instant Brew profile', instantProfile?.title ?? d.ibSelectedProfileId),
        text('Instant Brew water', d.ibWaterQuantity === undefined ? undefined : formatMillilitres(d.ibWaterQuantity)),
        text('Elevation', d.elevation === undefined ? undefined : `${d.elevation} m`),
        d.metricUnit === undefined
          ? unreported('Units')
          : { label: 'Units', value: `${d.metricUnit ? 'Metric' : 'Imperial'}${d.preciseUnit ? ', precise' : ''}` },
        d.displayClock === undefined
          ? unreported('Clock')
          : { label: 'Clock', value: d.displayClock ? (d.displayClock24hrMode ? '24-hour' : '12-hour') : 'Hidden' },
        text('Chime volume', d.chimeVolume),
        flag('Advanced mode', d.isAdvanceMode, 'On', 'Off'),
        ...(d.enabledFlags === undefined ? [] : [flag('Remote brewing', d.enabledFlags.includes('remoteBrewing'), 'Enabled', 'Disabled', 'success', 'error')]),
        text('Language', d.languageCode),
        text('Time zone', d.deviceTimezone),
      ],
    },
    {
      title: 'Identity',
      readings: [
        text('Name', d.displayName),
        text('Model', d.sku, true),
        text('Serial', d.serialNumber, true),
        text('Wi-Fi MAC', d.wifiMacAddress, true),
        ...(d.wifiSsid === undefined ? [] : [text('Wi-Fi network', d.wifiSsid)]),
        ...(d.localIpAddress === undefined ? [] : [text('Local IP', d.localIpAddress, true)]),
      ],
    },
  ]
})
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-baseline justify-between gap-4">
      <h3 class="text-base font-semibold">
        Sensors
      </h3>
      <p v-if="readAt" class="tabular text-xs text-muted">
        Read at {{ formatTime(readAt) }}
      </p>
    </div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="group in groups" :key="group.title" class="rounded-lg border border-default">
        <h4 class="border-b border-default px-4 py-2 text-sm font-medium">
          {{ group.title }}
        </h4>
        <dl class="divide-y divide-default">
          <div v-for="reading in group.readings" :key="reading.label" class="flex items-baseline justify-between gap-4 px-4 py-1.5 text-sm">
            <dt class="text-muted">
              {{ reading.label }}
            </dt>
            <dd class="text-right" :class="[toneClass[reading.tone ?? 'default'], reading.mono ? 'font-mono text-xs' : 'tabular']">
              {{ reading.value }}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
