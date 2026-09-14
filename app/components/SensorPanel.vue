<script setup lang="ts">
import type { DeviceResponse, HistoryResponse, Profile } from '#shared/types/api'
import { brewPhase } from '../../server/lib/fellow/device'
import { formatAgo, formatDateTime, formatDuration, formatElevation, formatHourMinute, formatLitresFromMl, formatMillilitres, formatTemperature, formatTime } from '../utils/format'

const props = defineProps<{
  data: DeviceResponse
  profiles: Profile[]
  readAt: number | null
  coffee?: HistoryResponse['coffee'] | null
  descale?: HistoryResponse['descale'] | null
  stats?: HistoryResponse['stats'] | null
  /** When the brewer last reported a change to anything it senses. */
  sensorsChangedAt?: number | null
}>()
const emit = defineEmits<{ marked: [] }>()

// The coffee clock is the one reading that changes without a new fetch, so it keeps its own.
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 20_000)
})
onBeforeUnmount(() => clearInterval(clock))

/**
 * The brewer stops reporting sensor changes while it sits idle, so readings fetched a second ago can describe the
 * machine as it was hours earlier. Past this long without a change, the panel says so rather than letting a reader
 * take "carafe in place" for a fact.
 */
const QUIET_AFTER_MS = 20 * 60_000
const quiet = computed(() => {
  const at = props.sensorsChangedAt
  if (!at || now.value - at < QUIET_AFTER_MS) return null
  return at
})

/** How long the coffee has been in the carafe, once there is coffee to time. */
const sitting = computed(() => {
  const since = props.coffee?.sittingSince
  if (!since) return null
  const minutes = (now.value - since) / 60_000
  return { minutes, fresh: minutes <= (props.coffee?.freshMinutes ?? 30) }
})

type Tone = 'default' | 'success' | 'error' | 'neutral' | 'primary'
/** A `heading` reading is a label across the row, marking off the readings under it. */
interface Reading { label: string, value: string, tone?: Tone, mono?: boolean, heading?: boolean }
interface Group { title: string, readings: Reading[] }

/**
 * The profiles brewed most, under the brewer's lifetime totals. These count the brews this app has logged rather
 * than the brewer's own counter, which knows nothing about profiles, so the heading says what the count is out of.
 */
const topProfiles = computed<Reading[]>(() => {
  const top = props.stats?.topProfiles ?? []
  if (top.length === 0) return []
  const logged = props.stats?.logged.brews ?? 0
  return [
    { label: `Most used, of ${logged} logged here`, value: '', heading: true },
    ...top.map(p => ({ label: p.title ?? p.profileId ?? 'Unknown profile', value: String(p.brews) })),
  ]
})

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
        // Only while a carafe of coffee is actually standing there.
        ...(sitting.value ? [{ label: 'Coffee sitting', value: sitting.value.minutes < 1 ? 'just brewed' : formatDuration(Math.round(sitting.value.minutes) * 60), tone: (sitting.value.fresh ? 'default' : 'warning') as Tone }] : []),
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
        // From the app's own log rather than the brewer, which counts cycles but times nothing.
        { label: 'Average brew time', value: formatDuration(props.stats?.averageDurationS), tone: (props.stats?.averageDurationS ? 'default' : 'neutral') as Tone },
        ...topProfiles.value,
      ],
    },
    {
      title: 'Brewer settings',
      readings: [
        text('Instant Brew profile', instantProfile?.title ?? d.ibSelectedProfileId),
        text('Instant Brew water', d.ibWaterQuantity === undefined ? undefined : formatMillilitres(d.ibWaterQuantity)),
        text('Elevation', d.elevation === undefined ? undefined : formatElevation(d.elevation)),
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

    <p v-if="quiet" class="text-xs text-muted">
      The brewer last reported a change at {{ formatHourMinute(quiet) }}, {{ formatAgo(quiet, now) }}. It stops
      reporting while it sits idle, so the readings below describe the machine as it was then. The carafe is the one
      that catches people out.
    </p>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <template v-for="group in groups" :key="group.title">
        <div class="rounded-lg border border-default">
          <h4 class="border-b border-default px-4 py-2 text-sm font-medium">
            {{ group.title }}
          </h4>
          <dl class="divide-y divide-default">
            <template v-for="(reading, i) in group.readings" :key="`${group.title}-${i}`">
              <p v-if="reading.heading" class="px-4 pb-1 pt-2.5 text-xs text-muted">
                {{ reading.label }}
              </p>
              <div v-else class="flex items-baseline justify-between gap-4 px-4 py-1.5 text-sm">
                <dt class="text-muted">
                  {{ reading.label }}
                </dt>
                <dd class="text-right" :class="[toneClass[reading.tone ?? 'default'], reading.mono ? 'font-mono text-xs' : 'tabular']">
                  {{ reading.value }}
                </dd>
              </div>
            </template>
          </dl>
        </div>
        <!-- Maintenance belongs with the totals it is counted from. -->
        <DescaleCard v-if="descale && group.title === 'Totals'" :descale="descale" @marked="emit('marked')" />
      </template>
    </div>
  </section>
</template>
