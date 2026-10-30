// One backend for every university: an entAuthApp per university (each with
// its own origins, captured when it's created) and a dispatcher that sends
// each request to the right one. Mounted by server.js and by the Vite dev
// server, like entAuthApp itself: it only answers /__ent_auth and
// /__ent_proxy, everything else falls through.
//
// Which university a request goes to:
//   1. signed in: the session's (`uni` in the cookie, server/sessionCookie.js)
//      and nothing else, so a session only ever reaches its own university's
//      services. A login (POST /__ent_auth/login) is the exception: it starts
//      a new session, for the university chosen on the login page;
//   2. signed out: the choice of the login page, sent as the X-Tafac-University
//      header (and `university` in the login body), checked against the list;
//   3. the old per-university addresses (shared.js `hostnames`, or a first
//      label equal to the id without dashes: univrennes.…), still routed;
//   4. the default university.
// With `multi: false` (a self-hosted instance) every request goes to the one
// university, as before.
//
// GET /__ent_auth/universities tells the page which universities there are
// and which one it's signed in to; /__ent_auth/universities/<id>/logo serves
// their logos.
import { statSync } from 'node:fs'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createEntAuthApp } from './entAuthApp.js'
import {
  createSessionCookieCodec,
  getSessionCookieName,
  getSessionUniversityId,
  isSessionDataExpired,
  readSessionCookies,
  resolveSessionSecrets,
} from './sessionCookie.js'
import {
  loadServerConfig,
  loadSharedConfig,
  loadUniversityDirectoryEntry,
  universityLogoPath,
} from '../universities/index.js'

export const UNIVERSITY_HEADER = 'x-tafac-university'

const API_PREFIXES = ['/__ent_auth', '/__ent_proxy']

function isApiPath(pathname) {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function getRequestHost(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const host = forwardedHost || String(req.headers.host || '')

  return host.split(':')[0].toLowerCase()
}

// options:
//   universityIds: ids served together (multi); defaultUniversityId: the
//   fallback, and the only one when multi is false;
//   production: Secure __Host- cookie, mandatory SESSION_SECRET;
//   session: { secret, previousSecrets } (defaults: the environment);
//   listDevOnly: list devOnly universities (default: not in production);
//   analytics, appIcons, trustProxy: passed to every entAuthApp.
export async function createUniversitiesApp({
  universityIds = [],
  defaultUniversityId,
  multi = true,
  production = false,
  session = {},
  listDevOnly = !production,
  analytics,
  appIcons,
  trustProxy,
} = {}) {
  if (!defaultUniversityId) {
    throw new Error('createUniversitiesApp: defaultUniversityId is required.')
  }

  const ids = multi
    ? [...new Set([defaultUniversityId, ...universityIds])]
    : [defaultUniversityId]

  // One key for every university: the dispatcher reads the cookie the
  // university apps write (and a dev server without SESSION_SECRET would
  // otherwise get one random key per university).
  const secrets = resolveSessionSecrets({
    secret: session.secret ?? process.env.SESSION_SECRET,
    previousSecrets: session.previousSecrets ?? process.env.SESSION_SECRET_PREVIOUS,
    production,
  })
  const codec = createSessionCookieCodec({ secret: secrets.current, previousSecrets: secrets.previous })
  const cookieName = getSessionCookieName(production)

  const idByHost = new Map()
  const idByLabel = new Map()
  const idByName = new Map()
  const directory = []
  const apps = new Map()

  function hostUniversityId(req) {
    if (!multi) return null
    const host = getRequestHost(req)
    return idByHost.get(host) ?? idByLabel.get(host.split('.')[0]) ?? null
  }

  // A cookie from before sessions named their university was issued by the
  // university this address served then.
  function legacyUniversityId(req) {
    return hostUniversityId(req) ?? defaultUniversityId
  }

  for (const id of ids) {
    const config = await loadServerConfig(id)
    const shared = await loadSharedConfig(id)
    const entry = await loadUniversityDirectoryEntry(id)

    apps.set(id, createEntAuthApp(config, {
      analytics,
      appIcons,
      trustProxy,
      session: {
        secret: secrets.current,
        previousSecrets: secrets.previous,
        production,
        legacyUniversityId,
      },
    }))

    directory.push(entry)
    idByLabel.set(id.replace(/-/g, ''), id)
    for (const hostname of shared.hostnames ?? []) {
      idByHost.set(String(hostname).toLowerCase(), id)
    }
    for (const name of [id, id.replace(/-/g, ''), entry.slug]) {
      if (!idByName.has(name)) idByName.set(name, id)
    }
  }

  // An id or slug of a served university, else null.
  function findUniversityId(value) {
    if (typeof value !== 'string') return null
    return idByName.get(value.trim().toLowerCase()) ?? null
  }

  function sessionUniversityId(req) {
    const data = readSessionCookies(req.cookies, { codec, cookieName })?.data
    if (!data || typeof data.id !== 'string' || !data.id || isSessionDataExpired(data)) {
      return null
    }
    const id = getSessionUniversityId(data, legacyUniversityId(req))
    return apps.has(id) ? id : null
  }

  function resolveUniversity(req) {
    if (!multi) return { id: defaultUniversityId, source: 'single' }

    const choice = findUniversityId(req.get(UNIVERSITY_HEADER))
    if (req.method === 'POST' && req.path === '/__ent_auth/login') {
      const loginChoice = findUniversityId(req.body?.university) ?? choice
      if (loginChoice) return { id: loginChoice, source: 'choice' }
    }

    const fromSession = sessionUniversityId(req)
    if (fromSession) return { id: fromSession, source: 'session' }
    if (choice) return { id: choice, source: 'choice' }

    const fromHost = hostUniversityId(req)
    if (fromHost) return { id: fromHost, source: 'host' }

    return { id: defaultUniversityId, source: 'default' }
  }

  // The logo's address, versioned by the file's date: browsers keep it a
  // day, and a new logo must show at once.
  function buildLogoUrl(id) {
    const file = universityLogoPath(id)
    if (!file) return null
    let version = ''
    try {
      version = `?v=${Math.round(statSync(file).mtimeMs).toString(36)}`
    } catch {
      // Unreadable now: the plain address.
    }
    return `/__ent_auth/universities/${id}/logo${version}`
  }

  function publicEntry(entry) {
    return {
      id: entry.id,
      name: entry.name,
      shortName: entry.shortName,
      slug: entry.slug,
      logoUrl: buildLogoUrl(entry.id),
      logoShape: entry.logoShape ?? 'wide',
      listed: listDevOnly || !entry.devOnly,
    }
  }

  const router = express()
  router.disable('x-powered-by')
  const parseLoginBody = express.json()

  router.use(cookieParser())

  router.get('/__ent_auth/universities', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      mode: multi ? 'multi' : 'single',
      defaultUniversity: defaultUniversityId,
      session: sessionUniversityId(req),
      host: hostUniversityId(req),
      universities: directory.map(publicEntry),
    })
  })

  router.get('/__ent_auth/universities/:id/logo', (req, res) => {
    const id = apps.has(req.params.id) ? req.params.id : null
    const file = id ? universityLogoPath(id) : null
    if (!file) return res.status(404).end()
    // The path is ours (the checkout may sit under a dot folder).
    res.sendFile(file, { maxAge: '1d', dotfiles: 'allow' })
  })

  router.use((req, res, next) => {
    // The login body may hold the choice: parsed here (the university app
    // then sees it already parsed).
    if (multi && req.method === 'POST' && req.path === '/__ent_auth/login') {
      return parseLoginBody(req, res, next)
    }
    next()
  })

  router.use((req, res, next) => {
    const university = resolveUniversity(req)
    res.locals.university = university
    if (!isApiPath(req.path)) return next()
    apps.get(university.id)(req, res, next)
  })

  router.locals.universityIds = ids
  router.locals.resolveUniversity = resolveUniversity
  router.locals.findUniversityId = findUniversityId
  router.locals.shutdown = () => Promise.all([...apps.values()].map((app) => app.locals.analytics.shutdown()))

  return router
}
