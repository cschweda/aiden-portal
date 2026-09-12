import type { ApiFailure } from '../utils/api-error'
import { describeApiError } from '../utils/api-error'

type LoadStatus = 'idle' | 'pending' | 'success' | 'error'

/**
 * A page's data from one API route, read on the client only: the server never forwards a page navigation's
 * headers into requests to itself, and the data survives navigation through `useState`. A failed initial load
 * sets `failure` (the page shows an alert); a failed `reload` shows a toast through `useApi`, keeps the last
 * good data, and marks it `stale`.
 */
export function useApiFetch<T>(path: string, options: { key: string, defaultValue?: () => T }) {
  const { call } = useApi()
  const data = useState<T | null>(`api:${options.key}`, () => options.defaultValue?.() ?? null)
  const status = ref<LoadStatus>('idle')
  const failure = ref<ApiFailure | null>(null)

  const hasData = computed(() => {
    const value = data.value
    if (value === null || value === undefined) return false
    return !(Array.isArray(value) && value.length === 0)
  })

  async function load(fetcher: () => Promise<T>): Promise<void> {
    status.value = 'pending'
    try {
      data.value = await fetcher()
      failure.value = null
      status.value = 'success'
    }
    catch (caught) {
      failure.value = describeApiError(caught)
      status.value = 'error'
    }
  }

  /** User-initiated: goes through useApi, so the server's reason shows as a toast. */
  function reload({ fresh = false }: { fresh?: boolean } = {}): Promise<void> {
    return load(() => call<T>(path, { query: fresh ? { fresh: 1 } : {} }))
  }

  if (import.meta.client) {
    onMounted(() => {
      const start = () => void load(() => apiFetch<T>(path))
      // A prerendered page is not being looked at yet, and the API refuses speculative loads; read when it is shown.
      const doc = document as Document & { prerendering?: boolean }
      if (doc.prerendering) doc.addEventListener('prerenderingchange', start, { once: true })
      else start()
    })
  }

  return {
    data,
    failure,
    hasData,
    /** True when a failure is shown next to data that predates it. */
    stale: computed(() => failure.value !== null && hasData.value),
    loading: computed(() => status.value === 'pending'),
    reload,
  }
}
