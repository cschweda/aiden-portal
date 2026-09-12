/**
 * Chrome prerenders addresses it expects you to open. The API refuses speculative loads, so a prerendered page
 * would carry its refused reads onto the screen when it is shown. Reads made through useFetch are re-run the moment
 * the page becomes visible; useApiFetch defers its own reads until then.
 */
export default defineNuxtPlugin(() => {
  const doc = document as Document & { prerendering?: boolean }
  if (!doc.prerendering) return
  doc.addEventListener('prerenderingchange', () => {
    void refreshNuxtData()
  }, { once: true })
})
