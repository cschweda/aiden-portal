// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-security'],
  css: ['~/assets/css/main.css'],
  nitro: { preset: 'node-server' },
  security: {
    // No login and no cross-origin consumers: the Host allowlist and CSRF middleware carry the request-side
    // protection, nuxt-security carries the response headers. Its rate limiter and CORS handler add nothing here.
    rateLimiter: false,
    corsHandler: false,
    headers: {
      contentSecurityPolicy: {
        'frame-ancestors': ['\'none\''],
      },
    },
  },
})
