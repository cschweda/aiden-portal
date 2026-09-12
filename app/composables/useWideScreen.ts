/**
 * True once the viewport is at least `minWidth` (Tailwind's `sm` by default). Starts false, so the first paint on a
 * phone is the narrow layout rather than a wide one that has to reflow. For components whose layout cannot be
 * expressed in CSS alone, such as a Nuxt UI alert that keeps its actions beside the text when horizontal.
 */
export function useWideScreen(minWidth = 640) {
  const wide = ref(false)
  if (import.meta.client) {
    let media: MediaQueryList | undefined
    const sync = () => (wide.value = media?.matches ?? false)
    onMounted(() => {
      media = window.matchMedia(`(min-width: ${minWidth}px)`)
      sync()
      media.addEventListener('change', sync)
    })
    onBeforeUnmount(() => media?.removeEventListener('change', sync))
  }
  return wide
}
