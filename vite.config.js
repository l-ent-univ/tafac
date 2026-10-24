import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
import { readAnalyticsConfig } from './server/analytics.js'
import { resolveDataDir } from './server/appIcons.js'
import { createUniversitiesApp } from './server/universitiesApp.js'
import { branding as neutralBranding } from './universities/neutral.js'
import { listServedUniversityIds, loadSharedConfig, resolveMultiUniversity, resolveUniversityId } from './universities/index.js'

// Every university, like tafac.fr, unless UNIVERSITY picks one (and
// MULTI_UNIVERSITY isn't set): see universities/index.js.
const multiUniversity = resolveMultiUniversity()
const universityId = resolveUniversityId()
const branding = multiUniversity ? neutralBranding : (await loadSharedConfig(universityId)).branding

// Dev/preview backend: the same Express app the production server mounts
// (server/universitiesApp.js). Unmatched requests fall through to Vite.
// POSTHOG_*, ANALYTICS_*, SESSION_SECRET* and DATA_DIR may come from the shell
// or from .env / .env.local (shell wins). Without SESSION_SECRET the backend
// uses a random per-process key: sessions then don't survive a dev-server
// restart. Without DATA_DIR, automatic app icons are remembered in ./data.
// No PostHog from the dev server unless POSTHOG_IN_DEV=1: what's tried here,
// often with a real account, stays out of the real numbers.
async function mountEntAuthApp(server) {
  const env = loadEnv(server.config.mode, server.config.envDir || process.cwd(), ['POSTHOG_', 'ANALYTICS_', 'SESSION_SECRET', 'DATA_DIR'])
  const universitiesApp = await createUniversitiesApp({
    universityIds: multiUniversity ? listServedUniversityIds() : [universityId],
    defaultUniversityId: universityId,
    multi: multiUniversity,
    // Plain http://localhost: no Secure flag, no __Host- prefix.
    production: false,
    session: {
      secret: env.SESSION_SECRET,
      previousSecrets: env.SESSION_SECRET_PREVIOUS,
    },
    analytics: env.POSTHOG_IN_DEV === '1' ? readAnalyticsConfig(env) : { projectKey: null },
    appIcons: { dataDir: resolveDataDir(env) },
  })

  server.middlewares.use(universitiesApp)
  server.httpServer?.once('close', () => {
    void universitiesApp.locals.shutdown()
  })
}

const entDevAuthPlugin = {
  name: 'ent-dev-auth',
  configureServer(server) {
    return mountEntAuthApp(server)
  },
  configurePreviewServer(server) {
    return mountEntAuthApp(server)
  },
  // index.html carries %LENT_*% placeholders so titles/SEO follow the
  // configured university in both dev and build. Its __PUBLIC_ORIGIN__ stays
  // in the build, for the server to fill in per request (server.js); the dev
  // server leaves the links relative.
  transformIndexHtml(html, context) {
    const replacements = {
      LENT_APP_NAME: branding.appName,
      LENT_SEO_TITLE: branding.seoTitle,
      LENT_SEO_DESCRIPTION: branding.seoDescription,
      LENT_REPO_URL: branding.about?.repoUrl ?? '',
      LENT_ALTERNATE_NAMES_JSON: JSON.stringify(branding.alternateNames ?? []),
    }

    const filled = html.replace(/%(LENT_[A-Z_]+)%/g, (match, token) => replacements[token] ?? match)
    return context?.server ? filled.replaceAll('__PUBLIC_ORIGIN__', '') : filled
  },
}

// Docker builds have no .git, so CI passes the commit as BUILD_HASH.
const gitHash = (() => {
  if (process.env.BUILD_HASH) return process.env.BUILD_HASH.slice(0, 7)
  try { return execSync('git rev-parse --short HEAD').toString().trim() }
  catch { return 'dev' }
})()


export default defineConfig({
  resolve: {
    alias: {
      // The config of the university the page runs for, filled at boot
      // (src/university.js, src/universityBoot.js).
      '@university': fileURLToPath(new URL('./src/university.js', import.meta.url)),
    },
  },
  define: {
    __BUILD_HASH__: JSON.stringify(gitHash),
  },
  plugins: [
    tailwindcss(),
    react(),
    entDevAuthPlugin,
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.png', 'apple-touch-icon.png'],
      workbox: {
        navigateFallbackDenylist: [/^\/__ent_auth/, /^\/__ent_proxy/],
      },
      manifest: {
        name: branding.appName,
        short_name: branding.appName,
        description: branding.pwaDescription ?? branding.seoDescription,
        lang: 'fr',
        id: '/',
        categories: ['education'],
        theme_color: '#FCFBF8',
        background_color: '#FCFBF8',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  server: {
    allowedHosts: true,
    // /__ent_proxy is handled by the shared entAuthApp middleware above.
  },
})
