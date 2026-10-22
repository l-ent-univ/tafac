import './server/patchNodeWarnings.js'
import { execSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
import { readAnalyticsConfig } from './server/analytics.js'
import { resolveDataDir } from './server/appIcons.js'
import { createEntAuthApp } from './server/entAuthApp.js'
import { clientConfigPath, listUniversityIds, loadServerConfig, loadSharedConfig, resolveUniversityId } from './universities/index.js'

if (!process.env.UNIVERSITY || process.env.UNIVERSITY === 'univ-exemple') {
  process.env.UNIVERSITY = 'univ-rennes'
}
const universityId = resolveUniversityId(process.env.UNIVERSITY)
const universityServerConfig = await loadServerConfig(universityId)
const { branding } = await loadSharedConfig(universityId)

// Dev/preview backend: the same Express app the production server mounts
// (server/entAuthApp.js). Unmatched requests fall through to Vite.
// POSTHOG_*, ANALYTICS_*, SESSION_SECRET* and DATA_DIR may come from the shell
// or from .env / .env.local (shell wins). Without SESSION_SECRET the backend
// uses a random per-process key: sessions then don't survive a dev-server
// restart. Without DATA_DIR, automatic app icons are remembered in ./data.
// No PostHog from the dev server unless POSTHOG_IN_DEV=1: what's tried here,
// often with a real account, stays out of the real numbers.
function mountEntAuthApp(server) {
  const env = loadEnv(server.config.mode, server.config.envDir || process.cwd(), ['POSTHOG_', 'ANALYTICS_', 'SESSION_SECRET', 'DATA_DIR'])
  const entAuthApp = createEntAuthApp(universityServerConfig, {
    analytics: env.POSTHOG_IN_DEV === '1' ? readAnalyticsConfig(env) : { projectKey: null },
    appIcons: { dataDir: resolveDataDir(env) },
    session: {
      secret: env.SESSION_SECRET,
      previousSecrets: env.SESSION_SECRET_PREVIOUS,
      // Plain http://localhost: no Secure flag, no __Host- prefix.
      production: false,
    },
  })

  server.middlewares.use(entAuthApp)
  server.httpServer?.once('close', () => {
    void entAuthApp.locals.analytics.shutdown()
  })
}

const entDevAuthPlugin = {
  name: 'ent-dev-auth',
  configureServer(server) {
    // Dev-only tenant switcher: the bundle is baked per university, so
    // /univexemple (or /univ-exemple) restarts the dev server on that
    // university and lands on its login page — the dev counterpart of the
    // production per-subdomain routing (server.js).
    server.middlewares.use((req, res, next) => {
      const label = String(req.url ?? '').split('?')[0].replace(/^\/+|\/+$/g, '')
      const targetId = listUniversityIds().find((id) => id === label || id.replace(/-/g, '') === label)

      if (!targetId) return next()

      if (targetId === universityId) {
        res.writeHead(302, { Location: '/' })
        res.end()
        return
      }

      process.env.UNIVERSITY = targetId
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta http-equiv="refresh" content="1;url=/"><p>Bascule vers ${targetId}…</p>`)
      server.restart()
    })

    mountEntAuthApp(server)
  },
  configurePreviewServer(server) {
    mountEntAuthApp(server)
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
      '@university': clientConfigPath(universityId),
    },
  },
  define: {
    __BUILD_HASH__: JSON.stringify(gitHash),
    __UNIVERSITY_ID__: JSON.stringify(universityId),
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
        // Bus reminders: push and notification clicks (public/transit-sw.js).
        importScripts: ['transit-sw.js'],
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

