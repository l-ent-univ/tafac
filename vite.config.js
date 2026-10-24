import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
import { readAnalyticsConfig } from './server/analytics.js'
import { resolveDataDir } from './server/appIcons.js'
import { fillBrandingPlaceholders, fillPublicOrigin } from './server/appShell.js'
import { createUniversitiesApp } from './server/universitiesApp.js'
import { branding as neutralBranding } from './universities/neutral.js'
import { listServedUniversityIds, loadSharedConfig, resolveMultiUniversity, resolveUniversityId } from './universities/index.js'

// Every university, like tafac.fr, unless UNIVERSITY picks one (and
// MULTI_UNIVERSITY isn't set): see universities/index.js. The build is the
// same either way; this only decides what the dev and preview servers serve.
const multiUniversity = resolveMultiUniversity()
const universityId = resolveUniversityId()
// The page's SEO text on the dev and preview servers, as server.js fills it.
const pageBranding = multiUniversity ? neutralBranding : (await loadSharedConfig(universityId)).branding

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

// Dev only: the /copy page (src/components/LandingCopyEditor.jsx) reads and
// writes the landing page's strings (src/landingCopy.json). A write is taken
// only as JSON (so another site can't post it without a preflight) and only
// in the file's own shape, strings in place of strings: no key added or
// dropped.
const LANDING_COPY_PATH = fileURLToPath(new URL('./src/landingCopy.json', import.meta.url))
const LANDING_COPY_MAX_BYTES = 512 * 1024

function hasSameShape(next, current) {
  if (typeof current === 'string') return typeof next === 'string'
  if (Array.isArray(current)) {
    return Array.isArray(next) && next.length === current.length && current.every((item, index) => hasSameShape(next[index], item))
  }
  if (!current || typeof current !== 'object' || !next || typeof next !== 'object' || Array.isArray(next)) return false
  const keys = Object.keys(current)
  return keys.length === Object.keys(next).length && keys.every((key) => Object.hasOwn(next, key) && hasSameShape(next[key], current[key]))
}

const landingCopyDevPlugin = {
  name: 'landing-copy-dev',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__dev/landing-copy', async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(body)
      }

      try {
        const current = await readFile(LANDING_COPY_PATH, 'utf8')
        if (req.method === 'GET') return send(200, current)
        if (req.method !== 'POST' || !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
          return send(405, '{"error":"POST application/json only"}')
        }

        let raw = ''
        for await (const chunk of req) {
          raw += chunk
          if (raw.length > LANDING_COPY_MAX_BYTES) return send(413, '{"error":"too large"}')
        }
        const next = JSON.parse(raw)
        if (!hasSameShape(next, JSON.parse(current))) return send(400, '{"error":"shape changed"}')

        await writeFile(LANDING_COPY_PATH, `${JSON.stringify(next, null, 2)}\n`)
        return send(200, '{"ok":true}')
      } catch {
        return send(500, '{"error":"failed"}')
      }
    })
  },
}

const entDevAuthPlugin = {
  name: 'ent-dev-auth',
  configureServer(server) {
    return mountEntAuthApp(server)
  },
  async configurePreviewServer(server) {
    await mountEntAuthApp(server)

    // The built page with its placeholders filled, as server.js sends it.
    const distDir = path.resolve(server.config.root, server.config.build.outDir)
    server.middlewares.use((req, res, next) => {
      const pathname = String(req.url ?? '').split('?')[0]
      const isPage = (req.method === 'GET' || req.method === 'HEAD')
        && !path.extname(pathname)
        && String(req.headers.accept ?? '').includes('text/html')
      if (!isPage) return next()

      const html = readFileSync(path.join(distDir, 'index.html'), 'utf8')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(fillPublicOrigin(fillBrandingPlaceholders(html, pageBranding), ''))
    })
  },
  // index.html's %LENT_*% placeholders and __PUBLIC_ORIGIN__ stay in the
  // build, for the server to fill as it sends the page (server/appShell.js);
  // the dev server fills them here and leaves the links relative.
  transformIndexHtml(html, context) {
    return context?.server ? fillPublicOrigin(fillBrandingPlaceholders(html, pageBranding), '') : html
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
    landingCopyDevPlugin,
    entDevAuthPlugin,
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.png', 'apple-touch-icon.png'],
      workbox: {
        navigateFallbackDenylist: [/^\/__ent_auth/, /^\/__ent_proxy/],
      },
      // One build for every university: the installed app is Tafac's.
      manifest: {
        name: neutralBranding.appName,
        short_name: neutralBranding.appName,
        description: neutralBranding.pwaDescription,
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
