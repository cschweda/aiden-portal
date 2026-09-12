import aiden from './aiden.config'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-security'],
  css: ['~/assets/css/main.css'],
  nitro: { preset: 'node-server' },
  // The dev server listens where aiden.config.ts says; the production server is pinned to the same value
  // by server/plugins/startup.ts. HOST/PORT in .env still override both.
  devServer: {
    host: process.env.NITRO_HOST || process.env.HOST || aiden.server.host,
    port: Number(process.env.NITRO_PORT || process.env.PORT || aiden.server.port),
  },
  runtimeConfig: {
    public: {
      app: { name: aiden.app.name, ui: aiden.ui },
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: aiden.app.name,
    },
  },
  colorMode: {
    preference: aiden.ui.colorMode,
    fallback: 'dark',
  },
  security: {
    // No login and no cross-origin consumers: the Host allowlist and same-site middleware carry the request-side
    // protection, nuxt-security carries the response headers. Its rate limiter and CORS handler add nothing here,
    // and its XSS validator second-guesses Zod on a JSON API and answers with a differently shaped 400, so it is off
    // as well. CSP stays on.
    rateLimiter: false,
    corsHandler: false,
    xssValidator: false,
    headers: {
      contentSecurityPolicy: {
        'frame-ancestors': ['\'none\''],
        // Phase 1 is plain http on loopback. With this directive on, a browser rewrites every asset URL to https and
        // the page arrives unstyled; Chrome exempts only localhost, so aiden.local and aiden.localhost broke. Turn it
        // back on in Phase 2, once TLS is real (docs/PHASE-2.md).
        'upgrade-insecure-requests': false,
      },
      xFrameOptions: 'DENY',
    },
  },
})
