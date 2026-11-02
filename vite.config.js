import { execSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
import { readAnalyticsConfig } from './server/analytics.js'
import { createEntAuthApp } from './server/entAuthApp.js'
import { clientConfigPath, listUniversityIds, loadServerConfig, loadSharedConfig, resolveUniversityId } from './universities/index.js'

const universityId = resolveUniversityId()
const universityServerConfig = await loadServerConfig(universityId)
const { branding } = await loadSharedConfig(universityId)

// Dev/preview backend: the same Express app the production server mounts
// (server/entAuthApp.js). Unmatched requests fall through to Vite.
// POSTHOG_* and SESSION_SECRET* may come from the shell or from .env /
// .env.local (shell wins). Without SESSION_SECRET the backend uses a random
// per-process key: sessions then don't survive a dev-server restart.
function mountEntAuthApp(server) {
  const env = loadEnv(server.config.mode, server.config.envDir || process.cwd(), ['POSTHOG_', 'SESSION_SECRET'])
  const entAuthApp = createEntAuthApp(universityServerConfig, {
    analytics: readAnalyticsConfig(env),
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
  // configured university in both dev and build.
  transformIndexHtml(html) {
    const replacements = {
      LENT_APP_NAME: branding.appName,
      LENT_SEO_TITLE: branding.seoTitle,
      LENT_SEO_DESCRIPTION: branding.seoDescription,
      LENT_REPO_URL: branding.about?.repoUrl ?? '',
    }

    return html.replace(/%(LENT_[A-Z_]+)%/g, (match, token) => replacements[token] ?? match)
  },
}

const gitHash = (() => {
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
      // Replaces the installed service worker with one that unregisters
      // itself and reloads open pages, so the PWA stops serving the old
      // cached app and runs the redirect to Tafac.
      selfDestroying: true,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        navigateFallbackDenylist: [/^\/__ent_auth/, /^\/__ent_proxy/],
      },
      manifest: {
        name: branding.appName,
        short_name: branding.appName,
        description: branding.pwaDescription ?? branding.seoDescription,
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
