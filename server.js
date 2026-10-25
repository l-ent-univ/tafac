// Production server: the backend of every university it serves
// (server/universitiesApp.js) and the frontend, one build for all (dist/).
//
// Every university (tafac.fr): MULTI_UNIVERSITY=1 (formerly MULTI_TENANT),
// or no UNIVERSITY set. One process for all of them. A signed-in request
// goes to its session's university; a signed-out one to the university
// chosen on the login page, else the old per-university hostname rules, else
// the default one (UNIVERSITY, else univ-rennes). The universities served are
// the UNIVERSITIES list (formerly TENANTS), default: all non-example ones.
// The page starts neutral and asks which one.
//
// One university (a self-hosted instance): UNIVERSITY=<id> without
// MULTI_UNIVERSITY (or MULTI_UNIVERSITY=0). That university only, no picker,
// its own SEO text: same behavior as before.
import express from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shutdownAllAnalytics } from './server/analytics.js'
import { fillBrandingPlaceholders, fillPagePath, fillPublicOrigin } from './server/appShell.js'
import { createUniversitiesApp } from './server/universitiesApp.js'
import { branding as neutralBranding } from './universities/neutral.js'
import {
  listServedUniversityIds,
  loadSharedConfig,
  loadUniversityDirectoryEntry,
  resolveMultiUniversity,
  resolveUniversityId,
} from './universities/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, 'dist')

const PORT = process.env.PORT || 3000
const MULTI_UNIVERSITY = resolveMultiUniversity()

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

// Every university served (tafac.fr): each one's /<slug> is its own landing
// page while signed out, with its SEO text, so it comes up when students
// search for their university. Not the dev-only ones (the demo). By slug;
// its id (with or without dashes) leads there too.
const universityPages = new Map()
if (MULTI_UNIVERSITY) {
  for (const id of universityIds) {
    const entry = await loadUniversityDirectoryEntry(id)
    if (entry.devOnly) continue
    const page = { id, path: `/${entry.slug}`, branding: (await loadSharedConfig(id)).branding }
    for (const name of [entry.slug, id, id.replace(/-/g, '')]) universityPages.set(name, page)
  }
}
const listedUniversityPages = [...new Set(universityPages.values())]

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
${listedUniversityPages.map((page) => `  <url>
    <loc>${origin}${page.path}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`).join('')}</urlset>`)
})

// The landing pages as static HTML, with their FAQ's structured data,
// rendered at build time (scripts/prerender-landing.mjs): `home`, the
// neutral one tafac.fr shows at /, and `universities`, each university's own
// (/<slug>) by id. Absent (a build without it, or one university only): the
// pages go without.
function readPrerenderedLanding() {
  if (!MULTI_UNIVERSITY) return null
  try {
    return JSON.parse(readFileSync(path.join(DIST_DIR, '.prerender', 'landing.json'), 'utf8'))
  } catch {
    return null
  }
}

// The built page with the landing already in it, for search engines and
// link previews (they don't run the app); the app renders over it.
function withPrerenderedLanding(shell, landing) {
  const structuredData = landing.structuredData
    .map((data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`)
    .join('')
  return shell
    .replace('<div id="root"></div>', () => `<div id="root">${landing.html}</div>`)
    .replace('</head>', () => `${structuredData}</head>`)
}

// A session cookie (current or legacy name): a signed-in student, who gets
// the app, not the landing.
const SESSION_COOKIE_PATTERN = /(?:^|;\s*)(?:__Host-)?(?:lent_session|ent_front_session)=/

// The page's own addresses (src/universityRuntime.js, App.jsx): the home
// page, the login page, the picker and a university's /<slug>. Any other
// gets the page too, but as a 404, so search engines don't index it.
const CLIENT_PATHS = new Set(['/', '/login', '/universites'])
function isClientPath(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/'
  if (CLIENT_PATHS.has(clean)) return true
  const name = clean.slice(1)
  return !name.includes('/') && Boolean(universitiesApp.locals.findUniversityId(name))
}

// The built page, read and filled with the SEO text once; its
// __PUBLIC_ORIGIN__ (canonical, link previews, structured data) becomes this
// request's address, so link previews, which don't run the app, get absolute
// URLs on every address. Signed out, the home page and each university's
// page come with their landing in them.
let shells = null
function readShells() {
  const template = readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8')
  const landing = readPrerenderedLanding()
  const app = fillBrandingPlaceholders(template, pageBranding)
  const universities = new Map()
  for (const page of listedUniversityPages) {
    const shell = fillPagePath(fillBrandingPlaceholders(template, page.branding), page.path)
    const prerendered = landing?.universities?.[page.id]
    universities.set(page.id, prerendered ? withPrerenderedLanding(shell, prerendered) : shell)
  }
  return { app, home: landing?.home ? withPrerenderedLanding(app, landing.home) : app, universities }
}

function sendAppShell(req, res, next) {
  const origin = getSafePublicOrigin(req)

  try {
    shells ??= readShells()
  } catch (error) {
    next(error)
    return
  }

  let pathname = req.path
  try {
    pathname = decodeURIComponent(req.path)
  } catch {
    // Malformed: matches no client path.
  }
  // A university's page under another spelling (its id, a capital, a
  // trailing slash): to its own address, the one search engines keep.
  const universityPage = universityPages.get(pathname.replace(/\/+$/, '').slice(1).toLowerCase())
  if (universityPage && pathname !== universityPage.path) {
    const query = req.originalUrl.slice(req.path.length)
    res.redirect(301, `${universityPage.path}${query}`)
    return
  }

  const isHome = pathname === '/'
  const isSignedOut = !SESSION_COOKIE_PATTERN.test(req.headers.cookie ?? '')
  const shownPage = isSignedOut ? universityPage : null
  let shell = shells.app
  if (isSignedOut && isHome) shell = shells.home
  else if (shownPage) shell = shells.universities.get(shownPage.id)

  res.status(isClientPath(pathname) ? 200 : 404)
  res.setHeader('Content-Language', 'fr')
  // Signed out or in, one address with two pages.
  if (isHome || universityPage) res.setHeader('Vary', 'Cookie')
  if (origin) res.setHeader('Link', `<${origin}${shownPage?.path ?? '/'}>; rel="canonical"`)
  res.type('html').send(fillPublicOrigin(shell, origin))
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
