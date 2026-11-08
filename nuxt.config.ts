import { readFileSync } from 'node:fs'
import aiden from './aiden.config'

// `pnpm build:demo` sets this. A demo build has no server at all: it is a static single-page app whose /api calls
// are answered in the browser from sample data (app/demo/), so it can be hosted anywhere and shows nobody's brewer.
const demo = process.env.AIDEN_DEMO === '1' || process.env.AIDEN_DEMO === 'true'
// The public demo's address. Only a demo build is ever shared as a link, so only it carries the social card, whose
// image URL must be absolute; the real app lives on loopback and a tailnet, where nothing unfurls it.
const DEMO_URL = 'https://aiden-portal.netlify.app'
const DESCRIPTION = 'A dashboard for a Fellow Aiden coffee brewer: a live trace of every brew, profiles and schedules, a brew log and a descale tally. It runs on your own machine and is reachable only over Tailscale.'
const socialMeta = demo
  ? [
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'aiden-portal · a dashboard for the Fellow Aiden' },
      { property: 'og:description', content: `${DESCRIPTION} This demo runs on invented data.` },
      { property: 'og:url', content: `${DEMO_URL}/` },
      { property: 'og:image', content: `${DEMO_URL}/og-image.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'aiden-portal in amber on a dark background, beside a brewer status card reading Brewing with a live brew trace' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ]
  : []
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // nuxt-security carries response headers, which a static host serves itself; see netlify.toml.
  modules: ['@nuxt/ui', '@nuxt/eslint', ...(demo ? [] : ['nuxt-security'])],
  css: ['~/assets/css/main.css'],
  ssr: !demo,
  // A demo build carries no server: no API routes, no request pipeline, no Fellow client, nothing that could want
  // credentials. The pages answer themselves from app/demo/ in the browser.
  ignore: demo ? ['server/api/**', 'server/middleware/**', 'server/plugins/**'] : [],
  // With no server there is nothing to serve icons, so a demo build carries them in the client bundle.
  icon: demo ? { clientBundle: { scan: true, sizeLimitKb: 512 } } : {},
  nitro: { preset: demo ? 'static' : 'node-server' },
  // The dev server listens where aiden.config.ts says; the production server is pinned to the same value
  // by server/plugins/00.startup.ts. HOST/PORT in .env still override both.
  devServer: {
    host: process.env.NITRO_HOST || process.env.HOST || aiden.server.host,
    port: Number(process.env.NITRO_PORT || process.env.PORT || aiden.server.port),
  },
  runtimeConfig: {
    public: {
      app: { name: aiden.app.name, ui: aiden.ui },
      demo,
      version,
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: aiden.app.name,
      // A coffee cup in the app's amber on its dark stone: SVG for current browsers, PNG for the rest, the 180 px
      // one for a phone's home screen. The files live in public/.
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
      meta: [
        { name: 'theme-color', content: '#1c1917' },
        { name: 'description', content: DESCRIPTION },
        ...socialMeta,
      ],
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
        // The app is plain http on loopback. With this directive on, a browser rewrites every asset URL to https
        // and the page arrives unstyled; Chrome exempts only localhost, so aiden.local and aiden.localhost broke.
        // Tailscale terminates TLS in front of the app, which does not change that: the Mac's own addresses stay
        // http, so this stays off for as long as any of them is in use.
        'upgrade-insecure-requests': false,
      },
      xFrameOptions: 'DENY',
    },
  },
})
