/**
 * A demo build has no server, so `apiFetch` is pointed at the sample world in `app/demo/` instead. In a normal
 * build this returns immediately and the demo code is never downloaded.
 */
export default defineNuxtPlugin({
  name: 'demo-api',
  enforce: 'pre',
  async setup() {
    const config = useRuntimeConfig().public
    if (config.demo !== true) return
    const { demoFetch, setDemoVersion } = await import('../demo/api')
    setDemoVersion(String(config.version ?? ''))
    useDemoApi(demoFetch)
  },
})
