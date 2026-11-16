import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

// Dev only: the branch checked out right now, next to "dev" in the footer
// (src/useDevBranch.js). Read on each request, so a branch switch shows on
// the next reload, no restart.
function serveGitBranch(server) {
  server.middlewares.use('/__dev/git-branch', (req, res) => {
    let branch = null
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: server.config.root }).toString().trim()
    } catch {
      // Not a git checkout
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ branch }))
  })
}

const entDevAuthPlugin = {
  name: 'ent-dev-auth',
  configureServer(server) {
    serveGitBranch(server)
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

// Collab Sans under the file names the versions up to v0.28.0 ask for. Those
// files spaced every letter apart on Windows (src/index.css). A browser still
// on one of those versions keeps its stylesheet (the service worker's) but
// fetches the fonts from the network: with these names it gets the repaired
// files at its next load, without waiting for its update. To remove once
// those versions are gone.
const LEGACY_FONT_FILES = {
  'CollabSans-Regular': 'CollabSans-Regular-BkQ7TDA4.woff2',
  'CollabSans-Medium': 'CollabSans-Medium-AWjG0nOx.woff2',
  'CollabSans-SemiBold': 'CollabSans-SemiBold-VZRXB7Ao.woff2',
  'CollabSans-Bold': 'CollabSans-Bold-C3h1YA4i.woff2',
  'CollabSans-ExtraBold': 'CollabSans-ExtraBold-DMR3O4st.woff2',
  'CollabSans-Italic': 'CollabSans-Italic-DB-42wBv.woff2',
}

const legacyFontFilesPlugin = {
  name: 'tafac-legacy-font-files',
  apply: 'build',
  generateBundle(_options, bundle) {
    const copies = []
    for (const file of Object.values(bundle)) {
      const match = file.type === 'asset' && /^assets\/(CollabSans-[A-Za-z]+)-[\w-]+\.woff2$/.exec(file.fileName)
      const legacy = match && LEGACY_FONT_FILES[match[1]]
      if (legacy && file.fileName !== `assets/${legacy}`) copies.push({ fileName: `assets/${legacy}`, source: file.source })
    }
    // A font renamed or dropped would leave its old name unanswered, silently.
    if (copies.length !== Object.keys(LEGACY_FONT_FILES).length) {
      this.error(`Legacy font files: ${copies.length} of ${Object.keys(LEGACY_FONT_FILES).length} found in the build`)
    }
    for (const copy of copies) this.emitFile({ type: 'asset', ...copy })
  },
}

// `isSsrBuild`: the landing page's build-time render (scripts/prerender-landing.mjs),
// which needs no service worker.
export default defineConfig(({ isSsrBuild }) => ({
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
    isSsrBuild ? null : legacyFontFilesPlugin,
    isSsrBuild ? null : VitePWA({
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
  ].filter(Boolean),
  server: {
    // localhost and IP addresses, plus the tunnel (dev.tafac.fr): another host
    // name is another site reaching this server through a DNS it controls.
    allowedHosts: ['.tafac.fr'],
    // /__ent_proxy is handled by the shared entAuthApp middleware above.
  },
}))
