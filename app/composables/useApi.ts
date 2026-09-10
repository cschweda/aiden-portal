import type { NitroFetchOptions } from 'nitropack'
import { describeApiError } from '../utils/api-error'

/** `$fetch` that turns the server's error envelope into a toast and rethrows, so callers can stop their flow. */
export function useApi() {
  const toast = useToast()

  async function call<T>(path: string, options: NitroFetchOptions<string> = {}): Promise<T> {
    try {
      return await $fetch<T>(path, options)
    }
    catch (error) {
      const failure = describeApiError(error)
      toast.add({ title: failure.message, description: failure.code, color: 'error', icon: 'i-lucide-triangle-alert' })
      throw error
    }
  }

  return { call }
}
