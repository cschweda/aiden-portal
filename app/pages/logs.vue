<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { LogRecordView, LogsResponse } from '#shared/types/api'
import { formatTime } from '../utils/format'

const UButton = resolveComponent('UButton')

useHead({ title: 'Logs' })

const level = ref('all')
const requestId = ref('')
const lines = ref(200)

const levelItems = [
  { label: 'All levels', value: 'all' },
  { label: 'Trace and up', value: 'trace' },
  { label: 'Debug and up', value: 'debug' },
  { label: 'Info and up', value: 'info' },
  { label: 'Warnings and up', value: 'warn' },
  { label: 'Errors only', value: 'error' },
]
const lineItems = [100, 200, 500, 1000].map(n => ({ label: `${n} lines`, value: n }))

const query = computed(() => ({ lines: lines.value, level: level.value === 'all' ? undefined : level.value, requestId: requestId.value.trim() || undefined }))
const { data, refresh, status } = useFetch<LogsResponse>('/api/logs', { query })

const levelColor: Record<string, 'neutral' | 'primary' | 'warning' | 'error'> = {
  trace: 'neutral',
  debug: 'neutral',
  info: 'primary',
  warn: 'warning',
  error: 'error',
  fatal: 'error',
}

const columns: TableColumn<LogRecordView>[] = [
  {
    id: 'expand',
    header: '',
    meta: { class: { th: 'w-10', td: 'w-10' } },
    cell: ({ row }) => h(UButton, {
      'color': 'neutral',
      'variant': 'ghost',
      'size': 'xs',
      'icon': 'i-lucide-chevron-down',
      'square': true,
      'aria-label': row.getIsExpanded() ? 'Hide details' : 'Show details',
      'class': ['transition-transform', row.getIsExpanded() ? 'rotate-180' : ''],
      'onClick': () => row.toggleExpanded(),
    }),
  },
  { accessorKey: 'time', header: 'Time', meta: { class: { td: 'font-mono text-xs whitespace-nowrap', th: 'w-24' } } },
  { accessorKey: 'levelName', header: 'Level', meta: { class: { th: 'w-20' } } },
  { accessorKey: 'msg', header: 'Message' },
  { accessorKey: 'requestId', header: 'Request', meta: { class: { td: 'font-mono text-xs', th: 'w-28' } } },
]

const expanded = ref<Record<string, boolean>>({})
</script>

<template>
  <UDashboardPanel id="logs">
    <template #header>
      <UDashboardNavbar title="Logs">
        <template #right>
          <StatusBadges />
          <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" aria-label="Refresh" :loading="status === 'pending'" @click="refresh()" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-6xl space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <USelect v-model="level" :items="levelItems" value-key="value" class="w-44" />
          <USelect v-model="lines" :items="lineItems" value-key="value" class="w-32" />
          <UInput v-model="requestId" placeholder="Filter by request id" class="w-64 font-mono" :ui="{ trailing: 'pe-1' }">
            <template v-if="requestId" #trailing>
              <UButton icon="i-lucide-x" color="neutral" variant="link" size="xs" aria-label="Clear" @click="requestId = ''" />
            </template>
          </UInput>
          <span v-if="data" class="ml-auto text-sm text-muted">{{ data.records.length }} shown</span>
        </div>

        <UAlert
          v-if="data && !data.available"
          color="neutral"
          variant="subtle"
          icon="i-lucide-terminal"
          title="Logs go to the terminal in development"
          :description="`The production build writes ${data.file}; run it to see records here.`"
        />

        <UTable
          v-else
          v-model:expanded="expanded"
          :data="data?.records ?? []"
          :columns="columns"
          :loading="status === 'pending'"
          :get-row-id="row => `${row.time}-${row.msg}-${row.requestId ?? ''}`"
        >
          <template #time-cell="{ row }">
            {{ formatTime(row.original.time) }}
          </template>
          <template #levelName-cell="{ row }">
            <UBadge :color="levelColor[row.original.levelName] ?? 'neutral'" variant="subtle" size="sm" :label="row.original.levelName" />
          </template>
          <template #requestId-cell="{ row }">
            <button v-if="row.original.requestId" type="button" class="hover:underline" :title="`Show only request ${row.original.requestId}`" @click="requestId = row.original.requestId!">
              {{ row.original.requestId.slice(0, 8) }}
            </button>
          </template>
          <template #expanded="{ row }">
            <pre class="overflow-x-auto p-3 font-mono text-xs text-muted">{{ JSON.stringify(row.original.rest, null, 2) }}</pre>
          </template>
          <template #empty>
            <div class="py-10 text-center text-sm text-muted">
              Nothing matches these filters.
            </div>
          </template>
        </UTable>
      </div>
    </template>
  </UDashboardPanel>
</template>
