// Production server.
//
// Single university (default): serves the university picked by UNIVERSITY
// from dist/ — same behavior as always.
//
// Every university (MULTI_UNIVERSITY=1, formerly MULTI_TENANT): one process
// and one backend for all of them (server/universitiesApp.js). A signed-in
// request goes to its session's university; a signed-out one to the
// university chosen on the login page, else the old per-university hostname
// rules, else the UNIVERSITY default. The universities served are the
// UNIVERSITIES list (formerly TENANTS), default: all non-example ones.
// Frontends are built per university with `npm run build:all` (dist/<id>/).
import express from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shutdownAllAnalytics } from './server/analytics.js'
import { createUniversitiesApp } from './server/universitiesApp.js'
import { listServedUniversityIds, resolveUniversityId } from './universities/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = process.env.PORT || 3000
const MULTI_UNIVERSITY = ['1', 'true', 'yes'].includes(String(process.env.MULTI_UNIVERSITY ?? process.env.MULTI_TENANT ?? '').toLowerCase())

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

// SEO routes + built frontend of one university.
function createFrontendApp(distDir) {
  const app = express()

  // The built page, read once; its __PUBLIC_ORIGIN__ (canonical, link
  // previews, structured data) becomes this request's address, so link
  // previews, which don't run the app, get absolute URLs on every address.
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

const defaultUniversityId = resolveUniversityId()
const universityIds = MULTI_UNIVERSITY ? listServedUniversityIds() : [defaultUniversityId]

// This is the production entry point: SESSION_SECRET is mandatory here and
// the session cookie is Secure/__Host- (see server/sessionCookie.js).
const universitiesApp = await createUniversitiesApp({
  universityIds,
  defaultUniversityId,
  multi: MULTI_UNIVERSITY,
  production: true,
})

const rootApp = express()
rootApp.use(universitiesApp)

rootApp.get('/robots.txt', (req, res) => {
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

rootApp.get('/sitemap.xml', (req, res) => {
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

const frontendsById = new Map(universitiesApp.locals.universityIds.map((id) => [
  id,
  createFrontendApp(MULTI_UNIVERSITY ? path.join(__dirname, 'dist', id) : path.join(__dirname, 'dist')),
]))

// The page of the university the request was routed to (universitiesApp).
rootApp.use((req, res, next) => {
  frontendsById.get(res.locals.university?.id ?? defaultUniversityId)(req, res, next)
})

rootApp.listen(PORT, () => {
  const mode = MULTI_UNIVERSITY
    ? `universities: ${universitiesApp.locals.universityIds.join(', ')}; default: ${defaultUniversityId}`
    : `university: ${defaultUniversityId}`
  console.log(`Server is running on http://localhost:${PORT} (${mode})`)
})

// Flush pending anonymous analytics events (if enabled) before exiting.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    shutdownAllAnalytics().finally(() => process.exit(0))
  })
}
