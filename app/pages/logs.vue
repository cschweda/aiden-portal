<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { LogRecordView, LogsResponse } from '#shared/types/api'
import { formatTime } from '../utils/format'

const UButton = resolveComponent('UButton')

useHead({ title: 'Logs' })

const level = ref('all')
const requestIdInput = ref('')
const requestId = ref('')
const lines = ref(200)

// Typing an id should not re-read the log file on every keystroke.
let debounce: ReturnType<typeof setTimeout> | undefined
watch(requestIdInput, (value) => {
  clearTimeout(debounce)
  debounce = setTimeout(() => (requestId.value = value.trim()), 300)
})
onBeforeUnmount(() => clearTimeout(debounce))

const levelItems = [
  { label: 'All levels', value: 'all' },
  { label: 'Debug and up', value: 'debug' },
  { label: 'Info and up', value: 'info' },
  { label: 'Warnings and up', value: 'warn' },
  { label: 'Errors only', value: 'error' },
]
const lineItems = [100, 200, 500, 1000].map(n => ({ label: `${n} lines`, value: n }))

const query = computed(() => ({ lines: lines.value, level: level.value === 'all' ? undefined : level.value, requestId: requestId.value || undefined }))
const { data, refresh, status } = useFetch<LogsResponse>('/api/logs', { key: 'logs', query, server: false })

// How much gets written, as opposed to how much is shown: changed at runtime, until the service restarts.
const { call } = useApi()
const toast = useToast()
const detailItems = [
  { label: 'Quiet (warnings and errors)', value: 'warn' },
  { label: 'Normal (info)', value: 'info' },
  { label: 'Detailed (debug)', value: 'debug' },
  { label: 'Everything (trace)', value: 'trace' },
]
const detail = ref<string | null>(null)
watch(() => data.value?.level, (value) => {
  if (value) detail.value = detailItems.some(item => item.value === value) ? value : null
}, { immediate: true })
async function setDetail(value: string) {
  if (!value || value === data.value?.level) return
  try {
    await call('/api/logs/level', { method: 'PATCH', body: { level: value } })
    toast.add({ title: `Log detail: ${detailItems.find(item => item.value === value)?.label ?? value}`, description: 'Until the service restarts; the default lives in aiden.config.ts.', color: 'success', icon: 'i-lucide-check' })
    await refresh()
  }
  catch {
    detail.value = data.value?.level ?? null
  }
}

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
          <UInput v-model="requestIdInput" placeholder="Filter by request id" class="w-64 font-mono" :ui="{ trailing: 'pe-1' }">
            <template v-if="requestIdInput" #trailing>
              <UButton icon="i-lucide-x" color="neutral" variant="link" size="xs" aria-label="Clear" @click="requestIdInput = ''" />
            </template>
          </UInput>
          <span v-if="data" class="ml-auto text-sm text-muted">{{ data.records.length }} shown</span>
          <span class="text-sm text-muted">Detail</span>
          <USelect :model-value="detail ?? undefined" :items="detailItems" value-key="value" placeholder="Log detail" class="w-56" @update:model-value="setDetail" />
        </div>

        <UAlert
          v-if="data && !data.available"
          color="neutral"
          variant="subtle"
          icon="i-lucide-terminal"
          :title="data.production ? 'No log file yet' : 'Logs go to the terminal in development'"
          :description="data.production ? `Nothing has been written to ${data.file} yet.` : `The production build writes ${data.file}; run it to see records here.`"
        />

        <UTable
          v-else
          v-model:expanded="expanded"
          :data="data?.records ?? []"
          :columns="columns"
          :loading="status === 'pending'"
          :get-row-id="(_row, index) => String(index)"
        >
          <template #time-cell="{ row }">
            {{ formatTime(row.original.time) }}
          </template>
          <template #levelName-cell="{ row }">
            <UBadge :color="levelColor[row.original.levelName] ?? 'neutral'" variant="subtle" size="sm" :label="row.original.levelName" />
          </template>
          <template #requestId-cell="{ row }">
            <button v-if="row.original.requestId" type="button" class="hover:underline" :title="`Show only request ${row.original.requestId}`" @click="requestIdInput = row.original.requestId!">
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
