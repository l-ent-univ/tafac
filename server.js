// Production server: the backend of every university it serves
// (server/universitiesApp.js) and the frontend, one build for all (dist/).
//
// Single university (default): serves the university picked by UNIVERSITY,
// same behavior as always.
//
// Every university (MULTI_UNIVERSITY=1, formerly MULTI_TENANT): one process
// for all of them. A signed-in request goes to its session's university; a
// signed-out one to the university chosen on the login page, else the old
// per-university hostname rules, else the UNIVERSITY default. The
// universities served are the UNIVERSITIES list (formerly TENANTS), default:
// all non-example ones. The page starts neutral and asks which one.
import express from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shutdownAllAnalytics } from './server/analytics.js'
import { fillBrandingPlaceholders, fillPublicOrigin } from './server/appShell.js'
import { createUniversitiesApp } from './server/universitiesApp.js'
import { branding as neutralBranding } from './universities/neutral.js'
import { listServedUniversityIds, loadSharedConfig, resolveUniversityId } from './universities/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, 'dist')

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

const defaultUniversityId = resolveUniversityId()
const universityIds = MULTI_UNIVERSITY ? listServedUniversityIds() : [defaultUniversityId]
// SEO text of the page: Tafac's when every university is served, the
// university's own when it's the only one.
const pageBranding = MULTI_UNIVERSITY ? neutralBranding : (await loadSharedConfig(defaultUniversityId)).branding

// This is the production entry point: SESSION_SECRET is mandatory here and
// the session cookie is Secure/__Host- (see server/sessionCookie.js).
const universitiesApp = await createUniversitiesApp({
  universityIds,
  defaultUniversityId,
  multi: MULTI_UNIVERSITY,
  production: true,
})

const app = express()
app.use(universitiesApp)

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

// The built page, read and filled with the SEO text once; its
// __PUBLIC_ORIGIN__ (canonical, link previews, structured data) becomes this
// request's address, so link previews, which don't run the app, get absolute
// URLs on every address.
let appShell = null
function sendAppShell(req, res, next) {
  const origin = getSafePublicOrigin(req)

  try {
    appShell ??= fillBrandingPlaceholders(readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8'), pageBranding)
  } catch (error) {
    next(error)
    return
  }
  res.setHeader('Content-Language', 'fr')
  if (origin) res.setHeader('Link', `<${origin}/>; rel="canonical"`)
  res.type('html').send(fillPublicOrigin(appShell, origin))
}

app.get('/', sendAppShell)
// The page under its file name would come out unfilled: the home page.
app.get('/index.html', (req, res) => res.redirect(301, '/'))

// Serve the built static files
app.use(express.static(DIST_DIR))

// Client-side entry points (/<slug> of a university, the picker) and any
// other address: the page.
app.get(/^.*$/, sendAppShell)

app.listen(PORT, () => {
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
