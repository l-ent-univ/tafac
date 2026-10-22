// Production server.
//
// Single-tenant (default): serves the university picked by UNIVERSITY from
// dist/ — same behavior as always.
//
// Multi-tenant (MULTI_TENANT=1): loads every university listed in TENANTS
// (default: all non-example universities), builds one app per tenant, and
// routes each request by hostname. A tenant matches when the request host's
// first label equals its id without dashes (univ-rennes → univrennes.lent…)
// or when the host appears in the university's optional `hostnames` export
// (shared.js). Unmatched hosts fall back to the UNIVERSITY default.
import './server/patchNodeWarnings.js'
import express from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shutdownAllAnalytics } from './server/analytics.js'
import { createEntAuthApp } from './server/entAuthApp.js'
import {
  listUniversityIds,
  loadServerConfig,
  loadSharedConfig,
  resolveUniversityId,
} from './universities/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = process.env.PORT || 3000
const MULTI_TENANT = ['1', 'true', 'yes'].includes(String(process.env.MULTI_TENANT ?? '').toLowerCase())

function getPublicOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const protocol = forwardedProto || req.protocol || 'http'
  const host = forwardedHost || req.get('host') || `localhost:${PORT}`

  return `${protocol}://${host}`
}

// The public origin as it may go into the page: http(s) and a plain host
// name (and port), nothing else, since X-Forwarded-Host comes from the
// request; anything odd leaves the page's links relative.
const SAFE_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i
function getSafePublicOrigin(req) {
  const origin = getPublicOrigin(req)
  return SAFE_ORIGIN.test(origin) ? origin : ''
}

function getRequestHost(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const host = forwardedHost || String(req.headers.host || '')

  return host.split(':')[0].toLowerCase()
}

// Full app for one university: auth/proxy backend + SEO routes + built frontend.
function createTenantApp(universityConfig, distDir) {
  const app = express()

  // This is the production entry point: SESSION_SECRET is mandatory here and
  // the session cookie is Secure/__Host- (see server/sessionCookie.js).
  app.use(createEntAuthApp(universityConfig, { session: { production: true } }))

  app.get('/robots.txt', (req, res) => {
    const origin = getPublicOrigin(req)

    res.type('text/plain')
    res.send([
      'User-agent: *',
      'Allow: /',
      'Disallow: /__ent_auth/',
      'Disallow: /__ent_proxy/',
      `Sitemap: ${origin}/sitemap.xml`,
    ].join('\n'))
  })

  app.get('/sitemap.xml', (req, res) => {
    const origin = getPublicOrigin(req)

    res.type('application/xml')
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`)
  })

  // The built page, read once; its __PUBLIC_ORIGIN__ (canonical, link
  // previews, structured data) becomes this request's address, so link
  // previews, which don't run the app, get absolute URLs on every tenant.
  let appShell = null
  function sendAppShell(req, res, next) {
    const origin = getSafePublicOrigin(req)

    try {
      appShell ??= readFileSync(path.join(distDir, 'index.html'), 'utf8')
    } catch (error) {
      next(error)
      return
    }
    res.setHeader('Content-Language', 'fr')
    if (origin) res.setHeader('Link', `<${origin}/>; rel="canonical"`)
    res.type('html').send(appShell.replaceAll('__PUBLIC_ORIGIN__', origin))
  }

  app.get('/', sendAppShell)
  // The page under its file name would come out unfilled: the home page.
  app.get('/index.html', (req, res) => res.redirect(301, '/'))

  // Serve the built static files
  app.use(express.static(distDir))

  // Support for client-side routing (React Router)
  app.get(/^.*$/, sendAppShell)

  return app
}

const rootApp = express()
const defaultUniversityId = resolveUniversityId()

if (!MULTI_TENANT) {
  const universityConfig = await loadServerConfig(defaultUniversityId)
  rootApp.use(createTenantApp(universityConfig, path.join(__dirname, 'dist')))

  rootApp.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT} (university: ${universityConfig.id})`)
  })
} else {
  const tenantIds = process.env.TENANTS
    ? process.env.TENANTS.split(',').map((id) => resolveUniversityId(id.trim()))
    : listUniversityIds().filter((id) => !id.startsWith('example'))

  if (!tenantIds.includes(defaultUniversityId)) {
    tenantIds.unshift(defaultUniversityId)
  }

  const tenantsById = new Map()
  const tenantIdByHost = new Map()
  const tenantIdByLabel = new Map()

  for (const id of tenantIds) {
    const config = await loadServerConfig(id)
    const shared = await loadSharedConfig(id)
    tenantsById.set(id, createTenantApp(config, path.join(__dirname, 'dist', id)))

    // Default subdomain label: the id without dashes (univ-rennes → univrennes).
    tenantIdByLabel.set(id.replace(/-/g, ''), id)
    for (const hostname of shared.hostnames ?? []) {
      tenantIdByHost.set(String(hostname).toLowerCase(), id)
    }
  }

  function resolveTenantId(req) {
    const host = getRequestHost(req)

    return tenantIdByHost.get(host)
      ?? tenantIdByLabel.get(host.split('.')[0])
      ?? defaultUniversityId
  }

  rootApp.use((req, res, next) => {
    tenantsById.get(resolveTenantId(req))(req, res, next)
  })

  rootApp.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT} (multi-tenant: ${tenantIds.join(', ')}; default: ${defaultUniversityId})`)
  })
}

// Flush pending anonymous analytics events (if enabled) before exiting.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    shutdownAllAnalytics().finally(() => process.exit(0))
  })
}
