import type { DescaleStatus } from '#shared/types/api'

/** The Mark descaled flow shared by the banner and the card: confirm, POST, toast, tell the caller to re-read. */
export function useDescaleMark(onMarked: () => void) {
  const { call } = useApi()
  const toast = useToast()
  const confirming = ref(false)
  const marking = ref(false)

  async function mark() {
    marking.value = true
    try {
      await call<DescaleStatus>('/api/descale', { method: 'POST' })
      toast.add({ title: 'Marked descaled', description: 'The tally starts again from now.', color: 'success', icon: 'i-lucide-check' })
      confirming.value = false
      onMarked()
    }
    catch {
      // useApi already showed the reason.
    }
    finally {
      marking.value = false
    }
  }

  return { confirming, marking, mark }
}
