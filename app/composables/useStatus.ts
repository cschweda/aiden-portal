import type { StatusResponse } from '#shared/types/api'

/** `/api/status`, shared by the layout badges and every page through one fetch key. */
export function useStatus() {
  const { data, refresh, status } = useFetch<StatusResponse>('/api/status', { key: 'app-status' })
  return { status: data, refresh, loading: computed(() => status.value === 'pending') }
}
