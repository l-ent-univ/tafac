import { execSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
import { fillBrandingPlaceholders, fillPublicOrigin } from './universities/appShell.js'
import { branding as neutralBranding } from './universities/neutral.js'
import { loadSharedConfig, resolveMultiUniversity, resolveUniversityId } from './universities/index.js'

// Every university, like tafac.fr, unless UNIVERSITY picks one (and
// MULTI_UNIVERSITY isn't set): see universities/index.js. The build is the
// same either way; this only decides what the dev and preview servers serve.
const multiUniversity = resolveMultiUniversity()
const universityId = resolveUniversityId()
// The page's SEO text on the dev and preview servers, as the gateway fills it.
const pageBranding = multiUniversity ? neutralBranding : (await loadSharedConfig(universityId)).branding

// Dev/preview backend: the gateway (back/crates/tafac-gateway), the same as
// tafac.fr's, built here with `cargo build` then started, and asked through
// Vite's proxy
// (/__ent_auth, /__ent_proxy: `server.proxy` below). Vite stays the server
// the page is opened at, with its hot reload; the gateway answers the API.
// Its first start builds it (a few minutes); the page's API answers once it
// listens.
//
// SESSION_SECRET*, DATA_DIR, POSTHOG_*, ANALYTICS_* and UNIVERSITY,
// MULTI_UNIVERSITY, UNIVERSITIES may come from the shell or from .env /
// .env.local (shell wins). Without SESSION_SECRET a random key is made for
// this start: sessions then don't survive a restart. Without DATA_DIR,
// automatic app icons are remembered in ./data. No statistics from the dev
// server unless POSTHOG_IN_DEV=1: what's tried here, often with a real
// account, stays out of the real numbers.
//
// TAFAC_DEV_GATEWAY_PORT: where it listens (default 3100). TAFAC_DEV_GATEWAY=off:
// none is started, one already running on that port is asked (its own
// terminal, its own log).
const gatewayPort = Number(process.env.TAFAC_DEV_GATEWAY_PORT) || 3100
const gatewayAddress = `http://127.0.0.1:${gatewayPort}`

function startGateway(server) {
  if (process.env.TAFAC_DEV_GATEWAY === 'off') return
  const root = server.config.root
  const env = loadEnv(server.config.mode, server.config.envDir || root, ['POSTHOG_', 'ANALYTICS_', 'SESSION_SECRET', 'DATA_DIR', 'UNIVERSITY', 'MULTI_UNIVERSITY', 'UNIVERSITIES'])
  let secret = env.SESSION_SECRET
  if (!secret) {
    secret = randomBytes(32).toString('hex')
    server.config.logger.info('[tafac] no SESSION_SECRET: a key for this start only, sessions end with it')
  }
  const statistics = env.POSTHOG_IN_DEV === '1'
  // A restart of Vite (its config changed) starts the gateway again: once the
  // one before has let its port go.
  const previous = globalThis.tafacDevGateway
  const launch = () => {
    globalThis.tafacDevGateway = runGateway(server, root, env, secret, statistics)
  }
  if (previous && !previous.done) {
    previous.once('exit', launch)
    previous.kill()
  } else {
    launch()
  }
}

// Built first, then the binary started itself (not through `cargo run`,
// whose child would outlive it): stopped with Vite, however Vite stops.
function runGateway(server, root, env, secret, statistics) {
  const logger = server.config.logger
  const manifest = path.join(root, 'back', 'Cargo.toml')
  // `done`: nothing of it runs any more (its build or itself ended).
  const handle = { done: false, process: null, stopped: false }
  const stop = () => {
    handle.stopped = true
    build.kill()
    handle.process?.kill()
  }
  handle.kill = stop
  handle.once = (event, listener) => {
    const running = handle.process ?? build
    running.once(event, listener)
  }
  const build = spawn('cargo', ['build', '-q', '-p', 'tafac-gateway', '--manifest-path', manifest], { cwd: root, stdio: 'inherit' })
  build.on('error', (error) => {
    logger.error(`[tafac] the gateway wasn't built (${error.message}): is Rust's cargo installed?`)
  })
  build.on('exit', (code) => {
    if (handle.stopped || code !== 0) handle.done = true
    if (handle.stopped) return
    if (code !== 0) {
      logger.error('[tafac] the gateway wasn\'t built: the page\'s API won\'t answer')
      return
    }
    const child = spawn(path.join(root, 'back', 'target', 'debug', 'tafac-gateway'), [], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
        SESSION_SECRET: secret,
        TAFAC_GATEWAY_DEV: '1',
        TAFAC_GATEWAY_LISTEN: `127.0.0.1:${gatewayPort}`,
        TAFAC_GATEWAY_NODE: '',
        POSTHOG_PROJECT_KEY: statistics ? env.POSTHOG_PROJECT_KEY ?? '' : '',
        DATA_DIR: env.DATA_DIR || path.join(root, 'data'),
      },
    })
    handle.process = child
    child.on('exit', () => {
      handle.done = true
    })
  })
  server.httpServer?.once('close', stop)
  process.once('exit', stop)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      stop()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
  return handle
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
    startGateway(server)
  },
  configurePreviewServer(server) {
    startGateway(server)

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
  // build, for the server to fill as it sends the page (the gateway's
  // own/page.rs; universities/appShell.js here);
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
        // /desktop/: the desktop app's manifest and installers
        // (the gateway's own/desktop_update), never the page.
        navigateFallbackDenylist: [/^\/__ent_auth/, /^\/__ent_proxy/, /^\/desktop\//],
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
    // The page's API: the gateway started above, the request's own Host
    // kept (the university a request without a session is for, the mail's
    // links to the page's own host). The preview server takes the same.
    // The desktop app's manifest and installers are tafac.fr's: the
    // website's « Tafac pour Mac » button.
    proxy: {
      '/__ent_auth': { target: gatewayAddress },
      '/__ent_proxy': { target: gatewayAddress },
      '/desktop/': { target: 'https://tafac.fr', changeOrigin: true },
    },
  },
}))
