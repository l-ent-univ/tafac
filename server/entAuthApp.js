// ============================================================================
// Shared ENT auth backend: session handling, CAS login, service launch,
// ADE/planning/grades endpoints and the ENT reverse proxy.
//
// Used by BOTH the production server (server.js) and the Vite dev server
// (vite.config.js), so it must stay a pure API app: no static file serving,
// no catch-all route — unmatched requests fall through to the host server.
// All university-specific values come from the config object
// (universities/<id>/server.js) passed to createEntAuthApp().
// ============================================================================
import './patchNodeWarnings.js'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { randomUUID } from 'node:crypto'
import {
  createAdeApiClient,
  getAdeSelectionLabels,
  getAdeSelectionResourceIds,
} from '../adeApi.js'
import { createAdeUpcomingResolver } from '../adeUpcomingResolver.js'
import { createAnalytics, readAnalyticsConfig } from './analytics.js'
import {
  createAppIconStore,
  resolveAppIconTheme,
  resolveDataDir,
  sanitizeAppIconRequest,
  toIconifyName,
} from './appIcons.js'
import { ANALYTICS_MAX_BODY_BYTES } from './analyticsSchema.js'
import {
  LEGACY_SESSION_COOKIE_NAME,
  MAX_PERSISTED_COOKIE_VALUE_LENGTH,
  buildSessionCookieOptions,
  createSessionCookieCodec,
  fitSessionPayload,
  getSessionCookieName,
  isSessionDataExpired,
  resolveSessionSecrets,
  unpackJarCookies,
} from './sessionCookie.js'
import { createPlanningPortalApiClient } from '../planningPortalApi.js'
import { SchoolCertificateUnavailableError, buildDemoCertificatePdf, openCertificateDownload } from './schoolCertificate.js'
import { createPlanningRpcClient } from '../planningRpc.js'
import { createCrousFeed } from './crousFeed.js'
import { createTransitFeed } from './transitFeed.js'
import { findDepartures, planJourneys, stopsNear } from './transitPlanner.js'
import { createTransitPushStore, readReminders, readSubscription } from './transitPush.js'
import { createLinkPreviewer } from './linkPreview.js'
import {
  DEMO_ACCOUNT,
  DEMO_GRADES_DEPARTMENT_MESSAGE,
  DEMO_SESSION_MODE,
  DEMO_ROOMS,
  DEMO_TEACHERS,
  applyDemoLayoutMutation,
  buildDemoAdeTreePayload,
  buildDemoAlertsPayload,
  buildDemoCalendarPayload,
  buildDemoRoomEvents,
  buildDemoEvaluationDistribution,
  buildDemoGradesPayload,
  buildDemoLayoutData,
  buildDemoLayoutDocData,
  buildDemoMailPayload,
  buildDemoMailMessagePayload,
  buildDemoMarketplaceEntries,
  buildDemoMoodleDeadlinesPayload,
  buildDemoMoodleCoursesPayload,
  buildDemoMoodleCourseContentsPayload,
  getDemoAssignmentDetails,
  submitDemoAssignment,
  removeDemoAssignmentFile,
  buildDemoPlanningPayload,
  buildDemoPortletFragment,
  buildDemoSemesterGradesPayload,
  buildDemoPortletMetadata,
  buildDemoTimetablePayload,
  buildDemoUpcomingPayload,
  createInitialDemoState,
  isDemoCredentials,
  normalizeDemoState,
  searchDemoAdeTree,
} from '../src/demoAccount.js'
import { findReleveEvaluation, normalizeDistributionAnswer } from '../src/evaluationDistribution.js'

const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal'

function resolveTrustProxy(value) {
  const setting = String(value ?? '').trim()
  if (!setting) return DEFAULT_TRUST_PROXY
  if (setting === 'true') return true
  if (setting === 'false') return false
  if (/^\d+$/.test(setting)) return Number(setting)
  return setting
}

// options.analytics: { projectKey, host } — defaults to POSTHOG_PROJECT_KEY /
// POSTHOG_HOST from the environment (analytics are off without a key).
// options.session: { secret, previousSecrets, production } — defaults to
// SESSION_SECRET / SESSION_SECRET_PREVIOUS and NODE_ENV === 'production'.
// server.js (the production entry point) always passes production: true, the
// Vite mount always passes false; tests inject a secret here.
// options.appIcons: { dataDir } — defaults to DATA_DIR, else ./data (see
// server/appIcons.js).
// options.trustProxy — Express 'trust proxy' value, defaults to TRUST_PROXY,
// else local and private peers.
export function createEntAuthApp(universityConfig, options = {}) {
const app = express()
// Behind a reverse proxy (Caddy in deploy/), req.ip is the proxy's address
// for every student, which turns the per-IP login limit into one limit for
// the whole site. X-Forwarded-For is trusted from local and private peers
// only (loopback, Docker network); TRUST_PROXY overrides it (Express syntax).
app.set('trust proxy', resolveTrustProxy(options.trustProxy ?? process.env.TRUST_PROXY))

// Automatic tile icons, remembered per university, drawn in the university's
// icon style and colour mode (server/appIcons.js, config → appIcons).
const APP_ICON_THEME = resolveAppIconTheme(universityConfig.appIcons)
const appIconStore = createAppIconStore({
  universityId: universityConfig.id,
  dataDir: options.appIcons?.dataDir ?? resolveDataDir(),
})
// Demo services, by the id the client sends (fname): their titles come from
// here, not from the request.
const DEMO_APP_ICON_SERVICES = new Map(
  buildDemoLayoutDocData().map((application) => [application.fname, {
    title: application.title,
    description: application.description ?? '',
    category: '',
  }]),
)

const analytics = createAnalytics({
  ...(options.analytics ?? readAnalyticsConfig()),
  universityId: universityConfig.id ?? null,
})
// Lets the host server flush pending events when it shuts down.
app.locals.analytics = analytics

const GRADES_UNAVAILABLE_MESSAGE = [
  universityConfig.grades?.unavailableTitle ?? 'Notes indisponibles',
  universityConfig.grades?.unavailableDetail,
].filter(Boolean).join('. ')

const FEATURES = universityConfig.features ?? {}

const ENT_ORIGIN = universityConfig.origins.ent
const CAS_ORIGIN = universityConfig.origins.cas
const ADE_ORIGIN = universityConfig.origins.ade ?? null
const MOODLE_ORIGIN = universityConfig.origins.moodle ?? null
const PLANNING_ORIGIN = universityConfig.origins.planning ?? null
const GRADES_ORIGIN = universityConfig.grades?.origin ?? null
// Certificat de scolarité (features.schoolCertificate, server/schoolCertificate.js).
const SCHOOL_CERTIFICATE_ORIGIN = FEATURES.schoolCertificate ? (universityConfig.schoolCertificate?.origin ?? null) : null
const SCHOOL_CERTIFICATE_MENU_CAPTION = universityConfig.schoolCertificate?.menuCaption ?? 'Inscriptions'
// Mail (see universities/<id>/server.js → mail, docs/ADDING_A_UNIVERSITY.md).
const MAIL_PROVIDER = universityConfig.mail?.provider ?? null
const MAIL_ORIGIN = universityConfig.mail?.origin ?? null
const MAIL_WEBMAIL_URL = universityConfig.mail?.webmailUrl ?? MAIL_ORIGIN
const MAIL_MAX_MESSAGES = Math.min(Math.max(Number(universityConfig.mail?.maxMessages) || 5, 1), 20)
// Domains the webmail sign-in chain may visit (webmail, SAML SP, IdP, CAS).
// Anything else — or any non-HTTPS URL — aborts the chain.
function buildSignInDomains(extraDomains, urls) {
  return [
    ...(extraDomains ?? []),
    ...urls
      .map((url) => { try { return new URL(url).hostname } catch { return null } })
      .filter(Boolean),
  ].map((domain) => String(domain).toLowerCase())
}
const MAIL_SIGN_IN_DOMAINS = buildSignInDomains(
  universityConfig.mail?.signInDomains,
  [MAIL_ORIGIN, MAIL_WEBMAIL_URL, universityConfig.origins?.cas],
)
// Same rule for the Moodle sign-in chain (Moodle, WAYF, SAML IdP, CAS) used by
// the "Échéances Moodle" widget.
const MOODLE_SIGN_IN_DOMAINS = buildSignInDomains(
  universityConfig.moodle?.signInDomains,
  [universityConfig.origins?.moodle, universityConfig.origins?.cas],
)

const ENT_HOST = new URL(ENT_ORIGIN).hostname
const CAS_HOST = new URL(CAS_ORIGIN).hostname
const MOODLE_HOST = MOODLE_ORIGIN ? new URL(MOODLE_ORIGIN).hostname : null
const PLANNING_HOST = PLANNING_ORIGIN ? new URL(PLANNING_ORIGIN).hostname : null
const USE_PLANNING_PORTAL_REST = universityConfig.planning?.api === 'portal-rest'

const PORTAL_ENTRY_URL = `${ENT_ORIGIN}${universityConfig.auth.portalEntryPath}`
const MOODLE_SHIBBOLETH_LOGIN_URL = MOODLE_ORIGIN
  ? `${MOODLE_ORIGIN}${universityConfig.moodle?.shibbolethLoginPath ?? '/auth/shibboleth/index.php'}`
  : null

// Moodle's Shibboleth entry point supports WAYFless deep links: ?target=<local
// URL> becomes $SESSION->wantsurl, the SP keeps it as RelayState through the
// SSO chain, and Moodle redirects there after login — so a launch to an
// activity page lands on that page instead of the dashboard.
function buildMoodleShibbolethLoginUrl(targetUrl = null) {
  if (!MOODLE_SHIBBOLETH_LOGIN_URL || !targetUrl) {
    return MOODLE_SHIBBOLETH_LOGIN_URL
  }

  try {
    const target = new URL(targetUrl)
    if (target.origin !== MOODLE_ORIGIN || target.pathname === '/' || target.pathname.startsWith('/auth/')) {
      return MOODLE_SHIBBOLETH_LOGIN_URL
    }

    const loginUrl = new URL(MOODLE_SHIBBOLETH_LOGIN_URL)
    loginUrl.searchParams.set('target', target.toString())
    return loginUrl.toString()
  } catch {
    return MOODLE_SHIBBOLETH_LOGIN_URL
  }
}
const WAYF_ENTITY_ID = universityConfig.moodle?.wayfEntityId ?? null
const DEFAULT_REFERER = PORTAL_ENTRY_URL
const HTML_ACCEPT_HEADER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
// Apereo CAS logout endpoint: ends the single sign-on session (the TGT behind
// the TGC cookie) on the university side.
const CAS_LOGOUT_URL = `${CAS_ORIGIN}${universityConfig.auth.casLogoutPath ?? '/logout'}`
const CAS_LOGOUT_TIMEOUT_MS = 4000

function isCasHost(hostname) {
  return Boolean(hostname) && hostname === CAS_HOST
}

// Session cookie: an encrypted copy of the upstream cookie jar (CAS TGC
// included), see server/sessionCookie.js. In production the secret must come
// from the environment and the cookie carries the __Host- prefix.
const IS_PRODUCTION = options.session?.production ?? process.env.NODE_ENV === 'production'
const sessionSecrets = resolveSessionSecrets({
  secret: options.session?.secret ?? process.env.SESSION_SECRET,
  previousSecrets: options.session?.previousSecrets ?? process.env.SESSION_SECRET_PREVIOUS,
  production: IS_PRODUCTION,
})
const sessionCodec = createSessionCookieCodec({
  secret: sessionSecrets.current,
  previousSecrets: sessionSecrets.previous,
})
const SESSION_COOKIE_NAME = getSessionCookieName(IS_PRODUCTION)
const SESSION_COOKIE_OPTIONS = buildSessionCookieOptions(IS_PRODUCTION)
// In-memory sessions (full jar, caches) are dropped after this much idle time;
// the cookie rebuilds them on the next request. The cookie itself follows the
// rolling/absolute lifetimes in server/sessionCookie.js.
const RUNTIME_SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000
const GRADES_CACHE_TTL_MS = 10 * 60 * 1000
const MAIL_CACHE_TTL_MS = 2 * 60 * 1000
const MOODLE_DEADLINES_CACHE_TTL_MS = 5 * 60 * 1000
const MOODLE_COURSES_CACHE_TTL_MS = 5 * 60 * 1000
const MOODLE_CONTENTS_CACHE_TTL_MS = 5 * 60 * 1000
// Signed-in Moodle contexts are reused for this long (and dropped earlier if
// Moodle rejects them), so a widget refresh doesn't replay the SAML chain.
const MOODLE_CONTEXT_TTL_MS = 60 * 60 * 1000
// Failed logins within the window before a short block. Enough room for a
// forgotten password, while still keeping brute force (and the university's
// own CAS lockout) away; the per-IP count is higher because students on
// campus Wi-Fi share an address.
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const LOGIN_RATE_LIMIT_BLOCK_MS = 5 * 60 * 1000
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_IP = 30
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_USERNAME = 8
const runtimeSessions = new Map()
const runtimeGradesCache = new Map()
// sessionId → Map(semesterId → { cachedAt, data }): relevés of the other
// semesters, opened from the "Mes notes" page.
const runtimeGradesSemesterCache = new Map()
// sessionId → Map(`semesterId:evaluationId` → { cachedAt, data }): promo
// grade histograms (counts only, no individual grade).
const runtimeGradesDistributionCache = new Map()
// sessionId → { cachedAt, data }: short-lived inbox snapshot.
const runtimeMailCache = new Map()
// sessionId → { createdAt, jar, origin, csrfToken }: webmail login context.
// Kept runtime-only (never persisted in the session cookie) so the IdP/SP/
// webmail cookies don't bloat the 4 KB session cookie.
const runtimeMailContexts = new Map()
// sessionId → { cachedAt, data }: short-lived Moodle deadlines snapshot.
const runtimeMoodleDeadlinesCache = new Map()
// sessionId → { cachedAt, data }: Moodle enrolled courses.
const runtimeMoodleCoursesCache = new Map()
// `${sessionId}:${courseId}` → { cachedAt, data }: Moodle course contents.
const runtimeMoodleContentsCache = new Map()
// sessionId → { createdAt, jar, sesskey }: signed-in Moodle context, runtime-only
// for the same reason as runtimeMailContexts.
const runtimeMoodleContexts = new Map()
const loginRateLimitByIp = new Map()
const loginRateLimitByUsername = new Map()

// Utility functions
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Cookie Jar for session handling
class CookieJar {
  constructor() {
    this.store = new Map()
  }

  setFromResponse(response, url) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []

    for (const rawCookie of setCookies) {
      this.setCookie(rawCookie, url)
    }
  }

  setCookie(rawCookie, url) {
    const urlObject = new URL(url)
    const [nameValue, ...attributePairs] = rawCookie.split(';').map((part) => part.trim())
    const separatorIndex = nameValue.indexOf('=')

    if (separatorIndex === -1) {
      return
    }

    const name = nameValue.slice(0, separatorIndex)
    const value = nameValue.slice(separatorIndex + 1)
    let domain = urlObject.hostname
    let hostOnly = true
    let path = '/'
    let secure = false
    let expiresAt = null

    for (const attributePair of attributePairs) {
      const [rawKey, ...rawRest] = attributePair.split('=')
      const key = rawKey.toLowerCase()
      const attributeValue = rawRest.join('=')

      if (key === 'domain' && attributeValue) {
        domain = attributeValue.replace(/^\./, '').toLowerCase()
        hostOnly = false
      } else if (key === 'path' && attributeValue) {
        path = attributeValue
      } else if (key === 'secure') {
        secure = true
      } else if (key === 'max-age') {
        const parsedValue = Number(attributeValue)
        if (Number.isFinite(parsedValue)) {
          expiresAt = Date.now() + parsedValue * 1000
        }
      } else if (key === 'expires') {
        const parsedDate = Date.parse(attributeValue)
        if (!Number.isNaN(parsedDate)) {
          expiresAt = parsedDate
        }
      }
    }

    const cookieKey = `${domain}|${path}|${name}`

    if (expiresAt !== null && expiresAt <= Date.now()) {
      this.store.delete(cookieKey)
      return
    }

    this.store.set(cookieKey, {
      name,
      value,
      domain,
      path,
      hostOnly,
      secure,
      expiresAt,
    })
  }

  setFromProxySetCookie(rawSetCookies, url) {
    const setCookies = Array.isArray(rawSetCookies)
      ? rawSetCookies
      : rawSetCookies
        ? [rawSetCookies]
        : []

    for (const rawCookie of setCookies) {
      this.setCookie(rawCookie, url)
    }
  }

  getCookieHeader(url) {
    const urlObject = new URL(url)
    const matchingCookies = []

    for (const cookie of this.store.values()) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) {
        continue
      }

      if (cookie.secure && urlObject.protocol !== 'https:') {
        continue
      }

      const domainMatches = cookie.hostOnly
        ? cookie.domain === urlObject.hostname
        : urlObject.hostname === cookie.domain || urlObject.hostname.endsWith(`.${cookie.domain}`)

      if (!domainMatches) {
        continue
      }

      if (!urlObject.pathname.startsWith(cookie.path)) {
        continue
      }

      matchingCookies.push(`${cookie.name}=${cookie.value}`)
    }

    return matchingCookies.join('; ')
  }

  getCookieNamesForHost(hostname) {
    return Array.from(this.store.values())
      .filter((cookie) => {
        if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) {
          return false
        }

        return cookie.hostOnly
          ? cookie.domain === hostname
          : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`)
      })
      .map((cookie) => cookie.name)
      .sort((left, right) => left.localeCompare(right))
  }

  hasCookie(hostname, cookieName) {
    return this.getCookieNamesForHost(hostname).includes(String(cookieName))
  }

  getCookieValue(hostname, cookieName) {
    const cookie = Array.from(this.store.values()).find((entry) => (
      entry.name === String(cookieName)
      && (entry.expiresAt === null || entry.expiresAt > Date.now())
      && (entry.hostOnly
        ? entry.domain === hostname
        : hostname === entry.domain || hostname.endsWith(`.${entry.domain}`))
    ))
    return cookie?.value ?? null
  }

  deleteCookiesForHost(hostname) {
    for (const [key, cookie] of this.store.entries()) {
      const matches = cookie.hostOnly
        ? cookie.domain === hostname
        : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`)

      if (matches) {
        this.store.delete(key)
      }
    }
  }

  serialize() {
    return Array.from(this.store.entries())
  }

  static fromSerialized(entries) {
    const jar = new CookieJar()
    for (const [key, cookie] of entries ?? []) {
      jar.store.set(key, cookie)
    }
    return jar
  }
}

function resolveUrl(location, currentUrl) {
  return new URL(location, currentUrl).toString()
}

// ---------------------------------------------------------------------------
// Stateless cookie-based sessions (survive server restarts)
// ---------------------------------------------------------------------------
// The cookie carries an encrypted copy of the upstream jar. The CAS TGC is the
// one cookie that matters: with it, every service (ENT, ScoDoc, planning, ADE,
// Moodle, webmail) can be signed in again without the password. Everything
// else is a convenience that saves a round trip, ranked here most useful
// first; the budget logic in setSessionCookie() drops from the end.
function cookieMatchesHost(cookie, hostname) {
  if (!hostname) {
    return false
  }

  return cookie.hostOnly
    ? cookie.domain === hostname
    : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`)
}

const PERSISTED_HOST_PRIORITY = [ENT_HOST, GRADES_ORIGIN ? new URL(GRADES_ORIGIN).hostname : null, PLANNING_HOST]
  .filter(Boolean)

function getPersistedCookiePriority(cookie) {
  // Other CAS cookies (webflow session, locale…) are handed out again on every
  // CAS visit: last.
  if (cookieMatchesHost(cookie, CAS_HOST)) {
    return PERSISTED_HOST_PRIORITY.length + 1
  }

  const index = PERSISTED_HOST_PRIORITY.findIndex((hostname) => cookieMatchesHost(cookie, hostname))
  return index === -1 ? PERSISTED_HOST_PRIORITY.length : index
}

function selectPersistableCookies(session) {
  if (!(session?.jar instanceof CookieJar)) {
    return { required: [], optional: [] }
  }

  const now = Date.now()
  const required = []
  const optional = []

  for (const [, cookie] of session.jar.serialize()) {
    if (!cookie || typeof cookie.value !== 'string') {
      continue
    }

    if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
      continue
    }

    if (cookie.name === 'TGC' && cookieMatchesHost(cookie, CAS_HOST)) {
      required.push(cookie)
      continue
    }

    if (cookie.value.length > MAX_PERSISTED_COOKIE_VALUE_LENGTH) {
      continue
    }

    optional.push(cookie)
  }

  // Stable sort: cookies of one host keep their jar order.
  optional.sort((left, right) => getPersistedCookiePriority(left) - getPersistedCookiePriority(right))

  return { required, optional }
}

function isDemoSession(session) {
  return session?.mode === DEMO_SESSION_MODE
}

function createDemoSession(overrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    mode: DEMO_SESSION_MODE,
    user: overrides.user ?? DEMO_ACCOUNT.preferred_username,
    jar: overrides.jar instanceof CookieJar ? overrides.jar : new CookieJar(),
    demoState: normalizeDemoState(overrides.demoState ?? createInitialDemoState()),
    createdAt: overrides.createdAt ?? Date.now(),
    lastSeenAt: Date.now(),
    sessionSource: overrides.sessionSource ?? null,
    legacyCookie: Boolean(overrides.legacyCookie),
  }
}

function buildDemoRequestPayload(requestPath, session) {
  const normalizedPath = String(requestPath ?? '').trim()

  if (!normalizedPath.startsWith('/')) {
    return {
      ok: false,
      status: 400,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'Invalid demo request path.' }),
    }
  }

  const requestUrl = new URL(normalizedPath, 'https://demo.l-ent.local')

  if (requestUrl.pathname === '/api/v4-3/dlm/layout.json') {
    return {
      ok: true,
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildDemoLayoutData(session.demoState)),
    }
  }

  if (requestUrl.pathname === '/api/layoutDoc') {
    return {
      ok: true,
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildDemoLayoutDocData()),
    }
  }

  if (requestUrl.pathname === '/api/marketplace/entries.json') {
    return {
      ok: true,
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildDemoMarketplaceEntries()),
    }
  }

  const portletFragmentMatch = requestUrl.pathname.match(/^\/api\/v4-3\/portlet\/([^/]+)\.html$/)
  if (portletFragmentMatch) {
    const fragment = buildDemoPortletFragment(decodeURIComponent(portletFragmentMatch[1]))
    return fragment == null
      ? {
          ok: false,
          status: 404,
          contentType: 'text/plain; charset=utf-8',
          body: 'Demo portlet not found.',
        }
      : {
          ok: true,
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: fragment,
        }
  }

  const portletMetadataMatch = requestUrl.pathname.match(/^\/api\/portlet\/([^/]+)\.json$/)
  if (portletMetadataMatch) {
    const metadata = buildDemoPortletMetadata(decodeURIComponent(portletMetadataMatch[1]))
    return metadata == null
      ? {
          ok: false,
          status: 404,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ error: 'Demo portlet metadata not found.' }),
        }
      : {
          ok: true,
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(metadata),
        }
  }

  if (requestUrl.pathname === '/api/layout') {
    const mutation = applyDemoLayoutMutation(normalizedPath, session.demoState)

    if (mutation.handled) {
      session.demoState = mutation.demoState
      return {
        ok: true,
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(mutation.payload ?? { ok: true }),
      }
    }
  }

  return {
    ok: false,
    status: 404,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ error: `Demo path not implemented: ${normalizedPath}` }),
  }
}

function dropRuntimeSession(sessionId) {
  runtimeSessions.delete(sessionId)
  runtimeGradesCache.delete(sessionId)
  runtimeGradesSemesterCache.delete(sessionId)
  runtimeGradesDistributionCache.delete(sessionId)
  runtimeMailCache.delete(sessionId)
  runtimeMailContexts.delete(sessionId)
  runtimeMoodleDeadlinesCache.delete(sessionId)
  runtimeMoodleContexts.delete(sessionId)
}

// Sliding idle timeout (last request seen), plus the absolute cap shared with
// the cookie. Dropping an entry never signs the user out: the cookie restores
// the session on the next request.
function pruneRuntimeSessions() {
  const now = Date.now()

  for (const [sessionId, session] of runtimeSessions.entries()) {
    const lastSeenAt = session?.lastSeenAt ?? session?.createdAt ?? 0
    if (now - lastSeenAt > RUNTIME_SESSION_IDLE_TTL_MS || isSessionDataExpired(session, now)) {
      dropRuntimeSession(sessionId)
    }
  }
}

function pruneRuntimeGradesCache() {
  const now = Date.now()

  for (const [sessionId, entry] of runtimeGradesCache.entries()) {
    if (!entry?.cachedAt || now - entry.cachedAt > GRADES_CACHE_TTL_MS) {
      runtimeGradesCache.delete(sessionId)
    }
  }
}

function getCachedGradesEntry(sessionId) {
  if (!sessionId) {
    return null
  }

  pruneRuntimeGradesCache()
  return runtimeGradesCache.get(sessionId) ?? null
}

function getCachedGrades(sessionId) {
  return getCachedGradesEntry(sessionId)?.data ?? null
}

function setCachedGrades(sessionId, grades, unavailable = false) {
  if (!sessionId) {
    return
  }

  pruneRuntimeGradesCache()
  runtimeGradesCache.set(sessionId, {
    cachedAt: Date.now(),
    data: grades,
    unavailable,
  })
}

function clearCachedGrades(sessionId) {
  if (!sessionId) {
    return
  }

  runtimeGradesCache.delete(sessionId)
  runtimeGradesSemesterCache.delete(sessionId)
  runtimeGradesDistributionCache.delete(sessionId)
}

function getCachedSemesterGrades(sessionId, semesterId) {
  const entry = runtimeGradesSemesterCache.get(sessionId)?.get(semesterId)
  if (!entry || Date.now() - entry.cachedAt > GRADES_CACHE_TTL_MS) {
    return null
  }

  return entry.data
}

function setCachedSemesterGrades(sessionId, semesterId, data) {
  if (!sessionId) {
    return
  }

  const now = Date.now()
  const semesters = runtimeGradesSemesterCache.get(sessionId) ?? new Map()
  for (const [id, entry] of semesters.entries()) {
    if (now - entry.cachedAt > GRADES_CACHE_TTL_MS) {
      semesters.delete(id)
    }
  }

  semesters.set(semesterId, { cachedAt: now, data })
  runtimeGradesSemesterCache.set(sessionId, semesters)
}

function getCachedDistribution(sessionId, key) {
  const entry = runtimeGradesDistributionCache.get(sessionId)?.get(key)
  return entry && Date.now() - entry.cachedAt <= GRADES_CACHE_TTL_MS ? entry.data : null
}

function setCachedDistribution(sessionId, key, data) {
  if (!sessionId) {
    return
  }

  const now = Date.now()
  const distributions = runtimeGradesDistributionCache.get(sessionId) ?? new Map()
  for (const [id, entry] of distributions.entries()) {
    if (now - entry.cachedAt > GRADES_CACHE_TTL_MS) {
      distributions.delete(id)
    }
  }

  distributions.set(key, { cachedAt: now, data })
  runtimeGradesDistributionCache.set(sessionId, distributions)
}

function getCachedMail(sessionId) {
  if (!sessionId) {
    return null
  }

  const entry = runtimeMailCache.get(sessionId)
  if (!entry || Date.now() - entry.cachedAt > MAIL_CACHE_TTL_MS) {
    runtimeMailCache.delete(sessionId)
    return null
  }

  return entry.data
}

function setCachedMail(sessionId, mail) {
  if (!sessionId) {
    return
  }

  runtimeMailCache.set(sessionId, { cachedAt: Date.now(), data: mail })
}

function clearMailCaches(sessionId) {
  if (!sessionId) {
    return
  }

  runtimeMailCache.delete(sessionId)
  runtimeMailContexts.delete(sessionId)
}

function getCachedMoodleDeadlines(sessionId) {
  if (!sessionId) {
    return null
  }

  const entry = runtimeMoodleDeadlinesCache.get(sessionId)
  if (!entry || Date.now() - entry.cachedAt > MOODLE_DEADLINES_CACHE_TTL_MS) {
    runtimeMoodleDeadlinesCache.delete(sessionId)
    return null
  }

  return entry.data
}

function setCachedMoodleDeadlines(sessionId, deadlines) {
  if (!sessionId) {
    return
  }

  runtimeMoodleDeadlinesCache.set(sessionId, { cachedAt: Date.now(), data: deadlines })
}

function getCachedMoodleCourses(sessionId) {
  if (!sessionId) return null
  const entry = runtimeMoodleCoursesCache.get(sessionId)
  if (!entry || Date.now() - entry.cachedAt > MOODLE_COURSES_CACHE_TTL_MS) {
    runtimeMoodleCoursesCache.delete(sessionId)
    return null
  }
  return entry.data
}

function setCachedMoodleCourses(sessionId, courses) {
  if (!sessionId) return
  runtimeMoodleCoursesCache.set(sessionId, { cachedAt: Date.now(), data: courses })
}

function getCachedMoodleContents(sessionId, courseId) {
  if (!sessionId) return null
  const key = `${sessionId}:${courseId}`
  const entry = runtimeMoodleContentsCache.get(key)
  if (!entry || Date.now() - entry.cachedAt > MOODLE_CONTENTS_CACHE_TTL_MS) {
    runtimeMoodleContentsCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedMoodleContents(sessionId, courseId, contents) {
  if (!sessionId) return
  const key = `${sessionId}:${courseId}`
  runtimeMoodleContentsCache.set(key, { cachedAt: Date.now(), data: contents })
}

function clearMoodleCaches(sessionId) {
  if (!sessionId) {
    return
  }

  runtimeMoodleDeadlinesCache.delete(sessionId)
  runtimeMoodleCoursesCache.delete(sessionId)
  for (const key of runtimeMoodleContentsCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      runtimeMoodleContentsCache.delete(key)
    }
  }
  runtimeMoodleContexts.delete(sessionId)
}

function setSessionCookie(res, session) {
  pruneRuntimeSessions()
  session.lastSeenAt = Date.now()
  runtimeSessions.set(session.id, session)

  const { payload, dropped } = fitSessionPayload({
    data: {
      id: session.id,
      user: session.user,
      mode: session.mode ?? null,
      demoState: isDemoSession(session) ? normalizeDemoState(session.demoState) : null,
      createdAt: session.createdAt,
    },
    ...selectPersistableCookies(session),
    codec: sessionCodec,
  })

  // Counts only — never cookie names or values.
  if (dropped > 0 && session.droppedCookieCount !== dropped) {
    session.droppedCookieCount = dropped
    console.warn(`Session cookie budget: ${dropped} upstream cookie(s) kept in memory only.`)
  }

  res.cookie(SESSION_COOKIE_NAME, sessionCodec.encode(payload), SESSION_COOKIE_OPTIONS)

  // Migration: the request authenticated with the old signed cookie, which the
  // encrypted one now replaces.
  if (session.legacyCookie) {
    session.legacyCookie = false
    res.clearCookie(LEGACY_SESSION_COOKIE_NAME, { path: '/' })
  }
}

function clearSessionCookies(res) {
  res.clearCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS)
  res.clearCookie(LEGACY_SESSION_COOKIE_NAME, { path: '/' })
}

function isRedirectStatus(statusCode) {
  return [301, 302, 303, 307, 308].includes(statusCode)
}

async function fetchWithJar(url, jar, options = {}) {
  const headers = new Headers(options.headers ?? {})
  const cookieHeader = jar.getCookieHeader(url)

  if (cookieHeader && !headers.has('cookie')) {
    headers.set('cookie', cookieHeader)
  }

  const response = await fetch(url, {
    ...options,
    headers,
    redirect: options.redirect ?? 'manual',
  })

  jar.setFromResponse(response, url)
  return response
}

async function followRedirectChain(startUrl, jar, options = {}) {
  const chain = []
  let currentUrl = startUrl
  let currentMethod = options.method ?? 'GET'
  let currentBody = options.body
  let currentHeaders = { ...(options.headers ?? {}) }
  let response = null

  for (let attempt = 0; attempt < 15; attempt += 1) {
    response = await fetchWithJar(currentUrl, jar, {
      ...options,
      method: currentMethod,
      body: currentBody,
      headers: currentHeaders,
      redirect: 'manual',
    })

    const location = response.headers.get('location')
    chain.push({
      status: response.status,
      url: currentUrl,
      location,
    })

    if (!isRedirectStatus(response.status) || !location) {
      return {
        chain,
        response,
        finalUrl: currentUrl,
      }
    }

    currentUrl = resolveUrl(location, currentUrl)

    if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
      currentMethod = 'GET'
      currentBody = undefined
      const loweredHeaders = Object.fromEntries(
        Object.entries(currentHeaders).filter(([name]) => name.toLowerCase() !== 'content-type'),
      )
      currentHeaders = loweredHeaders
    }
  }

  throw new Error('Too many redirects while talking to CAS/ENT.')
}

function extractHiddenInputValue(html, inputName) {
  const escapedInputName = escapeRegExp(inputName)
  const patterns = [
    new RegExp(`<input[^>]*name=["']${escapedInputName}["'][^>]*value=["']([^"']*)["']`, 'i'),
    new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${escapedInputName}["']`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) {
      return match[1]
    }
  }

  return ''
}

function extractFormAction(html, pageUrl) {
  const match = html.match(/<form[^>]+action=["']([^"']+)["']/i)
  const action = match ? decodeHtmlEntities(match[1]) : pageUrl
  return resolveUrl(action, pageUrl)
}

function stripHtmlTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCasError(html) {
  const candidates = [
    /<div[^>]*class=["'][^"']*(?:alert|errors?|messages?)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]*class=["'][^"']*(?:alert|errors?|messages?)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
  ]

  for (const candidate of candidates) {
    const match = html.match(candidate)
    if (match) {
      const message = stripHtmlTags(match[1])
      if (message) {
        return message
      }
    }
  }

  return ''
}

async function fetchEntLayout(jar) {
  const response = await fetchWithJar(`${ENT_ORIGIN}/api/v4-3/dlm/layout.json`, jar, {
    headers: {
      Accept: 'application/json',
      Referer: DEFAULT_REFERER,
    },
  })

  const text = await response.text()
  let data = null

  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    text,
  }
}

async function performEntLogin({ username, password }) {
  const jar = new CookieJar()
  const acceptHeader = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

  const loginPageResult = await followRedirectChain(PORTAL_ENTRY_URL, jar, {
    headers: {
      Accept: acceptHeader,
    },
  })

  const loginPageHtml = await loginPageResult.response.text()
  const execution = extractHiddenInputValue(loginPageHtml, 'execution')

  if (!execution) {
    throw new Error('Could not extract the CAS login form.')
  }

  const actionUrl = extractFormAction(loginPageHtml, loginPageResult.finalUrl)
  const eventId = extractHiddenInputValue(loginPageHtml, '_eventId') || 'submit'
  const geolocation = extractHiddenInputValue(loginPageHtml, 'geolocation')
  const formBody = new URLSearchParams({
    username,
    password,
    execution,
    _eventId: eventId,
    geolocation,
  }).toString()

  const submitResponse = await fetchWithJar(actionUrl, jar, {
    method: 'POST',
    headers: {
      Accept: acceptHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: CAS_ORIGIN,
      Referer: loginPageResult.finalUrl,
    },
    body: formBody,
    redirect: 'manual',
  })

  if (!isRedirectStatus(submitResponse.status)) {
    const html = await submitResponse.text()
    const message = extractCasError(html)
    throw new Error(message || 'CAS login failed. Check your username and password.')
  }

  const location = submitResponse.headers.get('location')
  if (!location) {
    throw new Error('CAS login did not return a redirect target.')
  }

  const portalRedirectResult = await followRedirectChain(resolveUrl(location, actionUrl), jar, {
    headers: {
      Accept: acceptHeader,
    },
  })

  const layout = await fetchEntLayout(jar)

  if (!layout.ok || !layout.data || String(layout.data.authenticated) !== 'true') {
    throw new Error('CAS login completed, but the portal session was not established.')
  }

  return {
    jar,
    layout: layout.data,
    redirectChain: [...loginPageResult.chain, ...portalRedirectResult.chain],
  }
}

function isAuthenticatedLayout(layout) {
  return Boolean(layout?.ok && layout.data && String(layout.data.authenticated) === 'true')
}

// Silent re-login: when the portal session lapsed (idle timeout, server
// restart) but the jar still holds the CAS TGC, replay the login-time entry
// (portal → CAS → portal with a service ticket) without any credentials. The
// stale portal cookies are dropped first so the entry behaves exactly as at
// login. Resolves to the authenticated layout, or null when the CAS no longer
// honors the TGC (TGT expired, or killed by a logout).
async function reestablishEntSession(session) {
  if (!session.jar.hasCookie(CAS_HOST, 'TGC')) {
    return null
  }

  session.jar.deleteCookiesForHost(ENT_HOST)
  const entry = await followRedirectChain(PORTAL_ENTRY_URL, session.jar, {
    headers: { Accept: HTML_ACCEPT_HEADER },
  })
  const html = await entry.response.text()

  // Landed on the CAS login form: the CAS wants credentials again.
  if (isCasHost(getHostnameFromUrl(entry.finalUrl)) && extractHiddenInputValue(html, 'execution')) {
    return null
  }

  const layout = await fetchEntLayout(session.jar)
  return isAuthenticatedLayout(layout) ? layout : null
}

// One re-login at a time per session: parallel requests from the same browser
// share the in-flight attempt instead of racing on the jar.
const entSessionRecoveryInflight = new Map()

function reestablishEntSessionOnce(session) {
  const inflight = entSessionRecoveryInflight.get(session.id)
  if (inflight) {
    return inflight
  }

  const promise = reestablishEntSession(session)
    .catch(() => null)
    .finally(() => entSessionRecoveryInflight.delete(session.id))
  entSessionRecoveryInflight.set(session.id, promise)
  return promise
}

// Best-effort CAS logout with the session jar, so the TGT behind the TGC we
// carried is dead on the university side (a copy of the cookie becomes
// useless). Failures are ignored: the local session is cleared regardless.
async function terminateCasSession(jar) {
  if (!jar?.hasCookie(CAS_HOST, 'TGC')) {
    return
  }

  try {
    const response = await fetchWithJar(CAS_LOGOUT_URL, jar, {
      headers: { Accept: HTML_ACCEPT_HEADER },
      redirect: 'manual',
      signal: AbortSignal.timeout(CAS_LOGOUT_TIMEOUT_MS),
    })
    await response.arrayBuffer().catch(() => null)
  } catch {
    // Timeout or network error: nothing more to do.
  }
}

// One ScoDoc sign-in at a time per cookie jar: concurrent doAuth runs (grades
// widget + profile photo on dashboard load) overwrite each other's PHP session,
// and the loser's data.php call answers { redirect } instead of grades.
const gradesAuthInflight = new WeakMap()

function ensureGradesSession(jar) {
  if (!GRADES_ORIGIN) {
    return Promise.reject(new Error('Grade service is not configured for this university.'))
  }

  const inflight = gradesAuthInflight.get(jar)
  if (inflight) {
    return inflight
  }

  const doAuthUrl = `${GRADES_ORIGIN}/services/doAuth.php?href=${encodeURIComponent(`${GRADES_ORIGIN}/`)}`
  const promise = followRedirectChain(doAuthUrl, jar, {
    headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
  })
    .then((result) => result.response.text())
    .then(() => undefined)
    .finally(() => gradesAuthInflight.delete(jar))

  gradesAuthInflight.set(jar, promise)
  return promise
}

const GRADES_FIRST_CONNECTION_QUERY = encodeURIComponent('dataPremièreConnexion')

// data.php answers { redirect: … } (HTTP 200) when the ScoDoc session isn't
// signed in; only payloads with a relevé or semester list are real grades.
function isValidGradesPayload(payload) {
  return Boolean(payload)
    && typeof payload === 'object'
    && !payload.redirect
    && (Boolean(payload['relevé']) || Array.isArray(payload.semestres))
}

// `query` is data.php's raw `q` value, already URL-encoded.
async function requestGradesData(jar, query = GRADES_FIRST_CONNECTION_QUERY) {
  const dataUrl = `${GRADES_ORIGIN}/services/data.php?q=${query}`
  const dataResponse = await fetchWithJar(dataUrl, jar, {
    headers: {
      Accept: 'application/json, */*',
      Referer: `${GRADES_ORIGIN}/`,
    },
    redirect: 'follow',
  })
  const dataText = await dataResponse.text()

  try {
    return { ok: dataResponse.ok, status: dataResponse.status, payload: JSON.parse(dataText) }
  } catch {
    throw new Error(`ScoDoc returned an invalid response (${dataResponse.status}).`)
  }
}

// Signs in to ScoDoc and reads the grades, retrying once with a fresh sign-in
// when ScoDoc says the session isn't authenticated.
async function fetchGradesData(jar, query = GRADES_FIRST_CONNECTION_QUERY, isValid = isValidGradesPayload) {
  let lastStatus = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await ensureGradesSession(jar)
    const { ok, status, payload } = await requestGradesData(jar, query)
    lastStatus = status

    if (ok && isValid(payload)) {
      return payload
    }

    if (!payload?.redirect) {
      break
    }
  }

  throw new Error(`ScoDoc grades request failed (${lastStatus}).`)
}

// Concurrent /grades requests for the same session share one upstream fetch.
const gradesFetchInflight = new Map()

function fetchGradesDataOnce(session) {
  const inflight = gradesFetchInflight.get(session.id)
  if (inflight) {
    return inflight
  }

  const promise = fetchGradesData(session.jar).finally(() => gradesFetchInflight.delete(session.id))
  gradesFetchInflight.set(session.id, promise)
  return promise
}

function isGradesStudentPicture(picture) {
  return picture.ok && /^image\//i.test(picture.contentType) && picture.size > 0
}

async function requestGradesStudentPicture(jar) {
  const pictureResponse = await fetchWithJar(`${GRADES_ORIGIN}/services/data.php?q=getStudentPic`, jar, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: `${GRADES_ORIGIN}/`,
    },
    redirect: 'follow',
  })
  const contentType = pictureResponse.headers.get('content-type') ?? 'application/octet-stream'
  const buffer = Buffer.from(await pictureResponse.arrayBuffer())

  return {
    ok: pictureResponse.ok,
    status: pictureResponse.status,
    contentType,
    size: buffer.length,
    buffer,
  }
}

async function fetchGradesStudentPicture(jar) {
  await ensureGradesSession(jar)
  let picture = await requestGradesStudentPicture(jar)

  if (isGradesStudentPicture(picture)) {
    return picture
  }

  await ensureGradesSession(jar)
  picture = await requestGradesStudentPicture(jar)
  return picture
}

function buildEntProxyTargetUrl(requestUrl) {
  const rewrittenPath = (requestUrl || '/').replace(/^\/__ent_proxy/, '') || '/'
  return new URL(rewrittenPath, ENT_ORIGIN).toString()
}

function getSessionLaunchCapabilities(session) {
  if (isDemoSession(session)) {
    return {
      canUseServerLaunch: false,
      degraded: false,
      degradedReason: null,
    }
  }

  const canUseServerLaunch = Boolean(session?.jar?.hasCookie(CAS_HOST, 'TGC'))

  return {
    canUseServerLaunch,
    degraded: !canUseServerLaunch,
    degradedReason: canUseServerLaunch ? null : 'missing-cas-tgc',
  }
}

// The encrypted cookie wins; the legacy signed cookie is only consulted when
// no readable encrypted one is present (first request after the switch).
function readSessionCookie(req) {
  const current = sessionCodec.decode(req.cookies?.[SESSION_COOKIE_NAME])
  if (current) {
    return { ...current, legacyCookie: false }
  }

  const legacy = sessionCodec.decode(req.cookies?.[LEGACY_SESSION_COOKIE_NAME])
  return legacy ? { ...legacy, legacyCookie: true } : null
}

function getSessionFromRequest(req) {
  pruneRuntimeSessions()

  const decoded = readSessionCookie(req)
  const data = decoded?.data
  if (!data || typeof data.id !== 'string' || !data.id || isSessionDataExpired(data)) {
    return null
  }

  const runtimeSession = runtimeSessions.get(data.id)
  if (runtimeSession) {
    runtimeSession.sessionSource = 'runtime'
    runtimeSession.lastSeenAt = Date.now()
    runtimeSession.legacyCookie = decoded.legacyCookie
    return runtimeSession
  }

  const session = data.mode === DEMO_SESSION_MODE
    ? createDemoSession({
        id: data.id,
        user: data.user,
        demoState: data.demoState,
        createdAt: data.createdAt,
        sessionSource: 'cookie',
        legacyCookie: decoded.legacyCookie,
      })
    : {
        id: data.id,
        user: data.user,
        jar: CookieJar.fromSerialized(unpackJarCookies(data.jar)),
        createdAt: data.createdAt,
        lastSeenAt: Date.now(),
        sessionSource: 'cookie',
        legacyCookie: decoded.legacyCookie,
      }

  // Registered right away so concurrent requests restored from the same cookie
  // share one jar (and the per-jar/per-id sign-in locks actually apply).
  runtimeSessions.set(session.id, session)
  return session
}

function getHostnameFromUrl(value) {
  try {
    return new URL(value).hostname
  } catch {
    return ''
  }
}

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
}

function isMoodleLaunchTarget(targetUrl) {
  return Boolean(MOODLE_HOST) && FEATURES.moodle !== false
    && getHostnameFromUrl(targetUrl) === MOODLE_HOST
}

function isMoodleShibbolethPostTarget(targetUrl) {
  return isMoodleLaunchTarget(targetUrl)
    && /\/Shibboleth\.sso\//i.test(new URL(targetUrl).pathname)
}

// Moodle's own sign-in page: the session is gone (its /login/ path, or its
// login form).
function isMoodleLoginPage(html, pageUrl) {
  try {
    if (/\/login\/index\.php/i.test(new URL(pageUrl).pathname)) return true
  } catch {
    // Not a URL: judge by the page alone.
  }
  return /<form[^>]+id=["']login["']/i.test(String(html ?? ''))
}

function buildMoodleWayfRequest(pageUrl) {
  const actionUrl = extractFormAction(pageUrl.html, pageUrl.url)
  return {
    actionUrl,
    headers: {
      Accept: pageUrl.acceptHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: new URL(actionUrl).origin,
      Referer: pageUrl.url,
    },
    body: new URLSearchParams({
      user_idp: WAYF_ENTITY_ID,
      Select: 'Sélection',
    }).toString(),
  }
}

// The CAS login form showed up in a server-side SSO chain: the TGT behind our
// TGC is gone and we never keep credentials, so the chain stops here.
function isCasLoginForm(html, pageUrl) {
  return isCasHost(getHostnameFromUrl(pageUrl)) && Boolean(extractHiddenInputValue(html, 'execution'))
}

function parseFormFields(formBody) {
  return Object.fromEntries(new URLSearchParams(formBody))
}

async function prepareMoodleLaunchRelay(session, targetUrl = null) {
  const acceptHeader = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  const launchCapabilities = getSessionLaunchCapabilities(session)
  const chain = []
  let currentUrl = buildMoodleShibbolethLoginUrl(targetUrl)
  let currentMethod = 'GET'
  let currentBody = undefined
  let currentHeaders = { Accept: acceptHeader }

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const response = await fetchWithJar(currentUrl, session.jar, {
      method: currentMethod,
      body: currentBody,
      headers: currentHeaders,
      redirect: 'manual',
    })

    const location = response.headers.get('location')
    chain.push({
      status: response.status,
      url: currentUrl,
      location,
    })

    if (isRedirectStatus(response.status) && location) {
      currentUrl = resolveUrl(location, currentUrl)

      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET'
        currentBody = undefined
        currentHeaders = { Accept: acceptHeader }
      }

      continue
    }

    const html = await response.text()
    const htmlRedirect = extractHtmlRedirect(html, currentUrl)
    if (htmlRedirect) {
      currentUrl = htmlRedirect
      currentMethod = 'GET'
      currentBody = undefined
      currentHeaders = { Accept: acceptHeader }
      continue
    }

    const autoSubmitForm = extractAutoSubmitForm(html, currentUrl)
    if (autoSubmitForm) {
      if (isMoodleShibbolethPostTarget(autoSubmitForm.action)) {
        return {
          finalUrl: autoSubmitForm.action,
          actionUrl: autoSubmitForm.action,
          fields: parseFormFields(autoSubmitForm.body),
          chain,
          useServerLaunch: true,
          reason: 'server-saml-relay',
          ...launchCapabilities,
        }
      }

      currentUrl = autoSubmitForm.action
      currentMethod = 'POST'
      currentBody = autoSubmitForm.body
      currentHeaders = {
        Accept: acceptHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: new URL(autoSubmitForm.action).origin,
        Referer: currentUrl,
      }
      continue
    }

    if (/name=["']user_idp["']/i.test(html)) {
      const wayfRequest = buildMoodleWayfRequest({
        html,
        url: currentUrl,
        acceptHeader,
      })
      currentUrl = wayfRequest.actionUrl
      currentMethod = 'POST'
      currentBody = wayfRequest.body
      currentHeaders = wayfRequest.headers
      continue
    }

    if (isCasLoginForm(html, currentUrl)) {
      throw new Error('CAS session expired; sign in again to open Moodle.')
    }

    throw new Error('Unable to prepare the Moodle SSO handoff.')
  }

  throw new Error('Too many steps while preparing Moodle launch.')
}

function buildAutoSubmitPage({ title, heading, body, actionUrl, fields }) {
  const hiddenFields = Object.entries(fields).map(([name, value]) => (
    `<input type="hidden" name="${escapeHtmlAttribute(name)}" value="${escapeHtmlAttribute(value)}" />`
  )).join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>${escapeHtmlAttribute(title)}</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #f7f8fb; color: #18212f; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    section { width: min(420px, 100%); background: #fff; border-radius: 18px; padding: 28px; box-shadow: 0 18px 50px rgba(24, 33, 47, 0.12); }
    h1 { margin: 0 0 12px; font-size: 1.15rem; }
    p { margin: 0; line-height: 1.55; color: #48566a; }
    button { margin-top: 18px; border: 0; border-radius: 999px; padding: 12px 18px; background: #0d6efd; color: #fff; font: inherit; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>${escapeHtmlAttribute(heading)}</h1>
      <p>${escapeHtmlAttribute(body)}</p>
      <form id="handoff" method="post" action="${escapeHtmlAttribute(actionUrl)}">
        ${hiddenFields}
        <noscript><button type="submit">Continuer</button></noscript>
      </form>
    </section>
  </main>
  <script>
    window.addEventListener('load', function () {
      const form = document.getElementById('handoff')
      if (form) form.submit()
    })
  </script>
</body>
</html>`
}

async function previewServerLaunch(targetUrl, session) {
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return {
      finalUrl: String(targetUrl ?? ''),
      chain: [],
      useServerLaunch: false,
      reason: 'invalid-target-url',
    }
  }

  if (!session) {
    return {
      finalUrl: targetUrl,
      chain: [],
      useServerLaunch: false,
      reason: 'missing-session',
    }
  }

  const launchCapabilities = getSessionLaunchCapabilities(session)
  if (isMoodleLaunchTarget(targetUrl)) {
    if (launchCapabilities.canUseServerLaunch) {
      return {
        finalUrl: targetUrl,
        chain: [],
        useServerLaunch: true,
        reason: 'server-saml-relay',
        ...launchCapabilities,
      }
    }

    return {
      finalUrl: targetUrl,
      chain: [],
      useServerLaunch: false,
      reason: 'missing-launch-credentials',
      ...launchCapabilities,
    }
  }

  if (!launchCapabilities.canUseServerLaunch) {
    return {
      finalUrl: targetUrl,
      chain: [],
      useServerLaunch: false,
      reason: isDemoSession(session) ? 'demo-session' : 'missing-cas-tgc',
      ...launchCapabilities,
    }
  }

  const chain = []
  let currentUrl = targetUrl
  const targetHost = getHostnameFromUrl(targetUrl)

  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await fetchWithJar(currentUrl, session.jar, {
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      const location = response.headers.get('location')
      chain.push({ status: response.status, url: currentUrl, location })

      const currentHost = getHostnameFromUrl(currentUrl)
      if (isRedirectStatus(response.status) && location) {
        const nextUrl = resolveUrl(location, currentUrl)
        const nextHost = getHostnameFromUrl(nextUrl)

        if (!isCasHost(currentHost) && isCasHost(nextHost)) {
          return {
            finalUrl: nextUrl,
            chain,
            useServerLaunch: true,
            reason: 'cas-login',
            ...launchCapabilities,
          }
        }

        if (isCasHost(currentHost) && !isCasHost(nextHost)) {
          if (nextHost === targetHost) {
            return {
              finalUrl: nextUrl,
              chain,
              useServerLaunch: true,
              reason: 'cas-ticket',
              ...launchCapabilities,
            }
          }

          return {
            finalUrl: targetUrl,
            chain,
            useServerLaunch: false,
            saml: true,
            reason: 'saml-browser-handoff',
            ...launchCapabilities,
          }
        }

        currentUrl = nextUrl
        continue
      }

      const html = await response.text()
      const htmlRedirect = extractHtmlRedirect(html, currentUrl)
      if (htmlRedirect) {
        const nextHost = getHostnameFromUrl(htmlRedirect)

        if (!isCasHost(currentHost) && isCasHost(nextHost)) {
          return {
            finalUrl: htmlRedirect,
            chain,
            useServerLaunch: true,
            reason: 'cas-html-redirect',
            ...launchCapabilities,
          }
        }

        currentUrl = htmlRedirect
        continue
      }

      const autoSubmitForm = extractAutoSubmitForm(html, currentUrl)
      if (autoSubmitForm) {
        const actionHost = getHostnameFromUrl(autoSubmitForm.action)

        if (isCasHost(actionHost)) {
          return {
            finalUrl: autoSubmitForm.action,
            chain,
            useServerLaunch: true,
            reason: 'cas-form',
            ...launchCapabilities,
          }
        }

        return {
          finalUrl: currentUrl,
          chain,
          useServerLaunch: false,
          reason: 'browser-form-handoff',
          ...launchCapabilities,
        }
      }

      return {
        finalUrl: currentUrl,
        chain,
        useServerLaunch: false,
        reason: 'direct-browser-launch',
        ...launchCapabilities,
      }
    }

    return {
      finalUrl: currentUrl,
      chain,
      useServerLaunch: false,
      reason: 'too-many-redirects',
      error: 'too-many-redirects',
      ...launchCapabilities,
    }
  } catch (error) {
    return {
      finalUrl: targetUrl,
      chain,
      useServerLaunch: false,
      reason: 'preview-error',
      error: error instanceof Error ? error.message : String(error),
      ...launchCapabilities,
    }
  }
}

function getPlanningCacheScope(session) {
  if (!session?.id) {
    return null
  }

  return `session:${session.id}`
}

function getPortalWeekRange(dateValue) {
  const match = String(dateValue ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const anchor = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date()
  const mondayOffset = (anchor.getDay() + 6) % 7
  const start = new Date(anchor)
  start.setDate(start.getDate() - mondayOffset)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)

  const format = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  const startLabel = format(start)
  const endLabel = format(end)

  return {
    start: startLabel,
    end: endLabel,
    label: `Semaine du ${startLabel} au ${endLabel}`,
    current: getPortalWeekRange.todayStart === startLabel,
    dayLabels: Array.from({ length: 5 }, (_, index) => {
      const day = new Date(start)
      day.setDate(day.getDate() + index)
      return format(day)
    }),
  }
}

{
  const today = new Date()
  const mondayOffset = (today.getDay() + 6) % 7
  today.setDate(today.getDate() - mondayOffset)
  getPortalWeekRange.todayStart = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
}

function clearSensitiveSessionCaches(session) {
  const sessionId = session?.id ?? null
  const cacheScope = getPlanningCacheScope(session)

  clearCachedGrades(sessionId)
  clearMailCaches(sessionId)
  clearMoodleCaches(sessionId)
  schoolCertificateStatusCache.delete(sessionId)
  clearAdeCaches(cacheScope)
  clearPlanningCaches(cacheScope)
  clearPortalCaches(cacheScope)
}

function normalizeLoginIdentifier(username) {
  return String(username ?? '').trim().toLowerCase()
}

function getLoginRequesterIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown')
}

function pruneLoginRateLimitStore(store) {
  const now = Date.now()

  for (const [key, entry] of store.entries()) {
    if (!entry) {
      store.delete(key)
      continue
    }

    if (entry.blockedUntil && entry.blockedUntil > now) {
      continue
    }

    if (!entry.firstFailureAt || now - entry.firstFailureAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
      store.delete(key)
    }
  }
}

function getRateLimitStatus(store, key) {
  if (!key) {
    return null
  }

  pruneLoginRateLimitStore(store)
  const entry = store.get(key)

  if (!entry?.blockedUntil) {
    return null
  }

  const retryAfterMs = entry.blockedUntil - Date.now()
  if (retryAfterMs <= 0) {
    store.delete(key)
    return null
  }

  return {
    retryAfterMs,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  }
}

function recordRateLimitFailure(store, key, maxAttempts) {
  if (!key) {
    return null
  }

  pruneLoginRateLimitStore(store)

  const now = Date.now()
  const currentEntry = store.get(key)
  const resetWindow = !currentEntry?.firstFailureAt || now - currentEntry.firstFailureAt > LOGIN_RATE_LIMIT_WINDOW_MS
  const nextEntry = resetWindow
    ? { count: 1, firstFailureAt: now, blockedUntil: 0 }
    : {
        count: Number(currentEntry.count ?? 0) + 1,
        firstFailureAt: currentEntry.firstFailureAt,
        blockedUntil: currentEntry.blockedUntil ?? 0,
      }

  if (nextEntry.count >= maxAttempts) {
    nextEntry.blockedUntil = now + LOGIN_RATE_LIMIT_BLOCK_MS
  }

  store.set(key, nextEntry)
  return getRateLimitStatus(store, key)
}

function clearRateLimitEntry(store, key) {
  if (!key) {
    return
  }

  store.delete(key)
}

function getActiveLoginRateLimit(req, username) {
  // Off in development; in production a local address is the reverse proxy,
  // so it is limited like any other.
  if (!IS_PRODUCTION) {
    return null
  }

  const ipKey = getLoginRequesterIp(req)
  const usernameKey = normalizeLoginIdentifier(username)
  const statuses = [
    getRateLimitStatus(loginRateLimitByIp, ipKey),
    getRateLimitStatus(loginRateLimitByUsername, usernameKey),
  ].filter(Boolean)

  if (statuses.length === 0) {
    return null
  }

  return statuses.reduce((currentMax, status) => (
    !currentMax || status.retryAfterMs > currentMax.retryAfterMs ? status : currentMax
  ), null)
}

function recordLoginFailure(req, username) {
  // Off in development; in production a local address is the reverse proxy,
  // so it is limited like any other.
  if (!IS_PRODUCTION) {
    return null
  }

  const ipKey = getLoginRequesterIp(req)
  const usernameKey = normalizeLoginIdentifier(username)
  const statuses = [
    recordRateLimitFailure(loginRateLimitByIp, ipKey, LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_IP),
    recordRateLimitFailure(loginRateLimitByUsername, usernameKey, LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_USERNAME),
  ].filter(Boolean)

  if (statuses.length === 0) {
    return null
  }

  return statuses.reduce((currentMax, status) => (
    !currentMax || status.retryAfterMs > currentMax.retryAfterMs ? status : currentMax
  ), null)
}

function clearLoginRateLimit(req, username) {
  clearRateLimitEntry(loginRateLimitByIp, getLoginRequesterIp(req))
  clearRateLimitEntry(loginRateLimitByUsername, normalizeLoginIdentifier(username))
}

// ============================================================================
// ICAL PARSER
// ============================================================================

function _parseIcalEvents(icalText) {
  const events = []
  const blocks = icalText.split('BEGIN:VEVENT')

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0]
    const event = {}

    const lines = block.replace(/\r\n /g, '').replace(/\r\n\t/g, '').split(/\r?\n/)

    for (const line of lines) {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex === -1) continue

      const rawKey = line.slice(0, separatorIndex)
      const value = line.slice(separatorIndex + 1)
      const key = rawKey.split(';')[0].trim()

      switch (key) {
        case 'DTSTART':
          event.start = parseIcalDate(value)
          break
        case 'DTEND':
          event.end = parseIcalDate(value)
          break
        case 'SUMMARY':
          event.summary = unescapeIcal(value)
          break
        case 'LOCATION':
          event.location = unescapeIcal(value)
          break
        case 'DESCRIPTION':
          event.description = unescapeIcal(value)
          break
        case 'UID':
          event.uid = value.trim()
          break
        case 'CATEGORIES':
          event.categories = value.trim()
          break
      }
    }

    if (event.start) {
      events.push(event)
    }
  }

  return events.sort((a, b) => (a.start || '').localeCompare(b.start || ''))
}

function parseIcalDate(value) {
  const clean = value.trim().replace('Z', '')
  if (clean.length >= 15) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T${clean.slice(9, 11)}:${clean.slice(11, 13)}:${clean.slice(13, 15)}Z`
  }
  if (clean.length >= 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
  }
  return value.trim()
}

function extractHtmlRedirect(html, pageUrl) {
  // <meta http-equiv="refresh" content="0; url=...">
  const meta = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^\s"'>]+)/i)
    || html.match(/<meta[^>]+content=["'][^;]*;\s*url=([^\s"'>]+)[^>]*http-equiv=["']?refresh["']?/i)
  if (meta) {
    return resolveUrl(meta[1].replace(/["']/g, ''), pageUrl)
  }

  // window.location = '...', window.location.href = '...', location.href = '...'
  const js = html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i)
    || html.match(/location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i)
  if (js) {
    return resolveUrl(js[1], pageUrl)
  }

  return null
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractAutoSubmitForm(html, pageUrl) {
  if (!/\.submit\s*\(\s*\)/i.test(html)) return null

  const formMatch = html.match(/<form[^>]*\baction=["']([^"']+)["'][^>]*>/i)
  if (!formMatch) return null

  const action = resolveUrl(decodeHtmlEntities(formMatch[1]), pageUrl)
  const fields = new URLSearchParams()
  const inputRegex = /<input[^>]*\btype=["']hidden["'][^>]*\/?>/gi
  let inputMatch
  while ((inputMatch = inputRegex.exec(html)) !== null) {
    const tag = inputMatch[0]
    const name = tag.match(/\bname=["']([^"']+)["']/)
    const value = tag.match(/\bvalue=["']([^"']*?)["']/)
    if (name) {
      fields.set(decodeHtmlEntities(name[1]), value ? decodeHtmlEntities(value[1]) : '')
    }
  }

  return { action, body: fields.toString() }
}

function unescapeIcal(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

const {
  clearPlanningCaches,
  fetchPlanningCalendarMetadataFromRpc,
  fetchPlanningTimetableFromRpc,
  fetchPlanningTreeFromRpc,
} = createPlanningRpcClient({
  casOrigin: CAS_ORIGIN,
  fetchWithJar,
  followRedirectChain,
  planningOrigin: PLANNING_ORIGIN ?? undefined,
  gwtClientId: universityConfig.planning?.gwtClientId,
})

const portalClient = USE_PLANNING_PORTAL_REST
  ? createPlanningPortalApiClient({
      casOrigin: CAS_ORIGIN,
      planningOrigin: PLANNING_ORIGIN,
      fetchWithJar,
      followRedirectChain,
    })
  : null

const {
  clearPortalCaches = () => {},
  fetchPortalCalendar = null,
  fetchPortalEvents = null,
  fetchPortalStatus = null,
  fetchPortalTree = null,
  listPortalClassrooms = null,
  listPortalInstructors = null,
  searchPortalTree = null,
} = portalClient ?? {}

const {
  authenticateToAde,
  clearAdeCaches,
  fetchAdeApi,
  fetchAdeUpcomingFromApi,
} = createAdeApiClient({
  adeOrigin: ADE_ORIGIN ?? undefined,
  casOrigin: CAS_ORIGIN,
  followRedirectChain,
  passwordKey: universityConfig.ade?.passwordKey,
  passwordIv: universityConfig.ade?.passwordIv,
  appHeaders: universityConfig.ade?.appHeaders,
  etab: universityConfig.ade?.etab,
})

const {
  resolveAdeUpcoming,
} = createAdeUpcomingResolver({
  fetchAdeUpcomingFromApi,
  fetchPlanningTreeFromRpc,
  fetchPlanningTimetableFromRpc,
  campusSource: ADE_ORIGIN ? new URL(ADE_ORIGIN).hostname : 'campus-api',
  planningSource: PLANNING_HOST ?? 'planning',
})

// ============================================================================
// EXPRESS MIDDLEWARE AND ROUTES
// ============================================================================

// Scoped to our own prefixes: this app is also mounted as middleware inside
// the Vite dev server, where it must not touch other requests.
app.use(['/__ent_auth', '/__ent_proxy'], cookieParser())

// Anonymous audience measurement (see server/analytics.js, docs/ANALYTICS.md).
// Registered before express.json() so it gets its own small body limit and
// also accepts navigator.sendBeacon's text/plain bodies. Always answers 204
// (even when analytics are off or the batch is invalid) and never touches
// the session cookie.
const parseAnalyticsBody = express.text({ type: () => true, limit: ANALYTICS_MAX_BODY_BYTES })
app.post('/__ent_auth/analytics', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')

  if (!analytics.enabled) {
    req.resume()
    return res.status(204).end()
  }

  // Same-origin only (the browser sets Sec-Fetch-Site on fetch/sendBeacon).
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin') {
    req.resume()
    return res.status(204).end()
  }

  parseAnalyticsBody(req, res, (error) => {
    if (error) {
      return res.status(error.status === 413 ? 413 : 204).end()
    }

    try {
      const session = getSessionFromRequest(req)
      analytics.ingest(req.body, session ? { id: session.id, demo: isDemoSession(session), user: session.user } : null)
    } catch {
      // Analytics must never break the app.
    }

    res.status(204).end()
  })
})

app.use('/__ent_auth', express.json({ limit: '50mb' })) // Automatically parse incoming JSON requests for auth endpoints
app.use('/__ent_auth', express.urlencoded({ extended: true, limit: '50mb' }))
app.use('/__ent_auth', (err, req, res, next) => {
  if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400)) {
    return res.status(400).json({ error: 'Corps JSON invalide' })
  }
  next(err)
})

app.use((req, res, next) => {
  if (req.path.startsWith('/__ent_auth') || req.path.startsWith('/__ent_proxy')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  }

  next()
})

// Feature gate: universities without a given service get a clean "disabled"
// response instead of a failed upstream call (see universities/<id>/shared.js).
const FEATURE_GATED_PREFIXES = [
  ['/__ent_auth/ade', 'ade'],
  ['/__ent_auth/planning', 'planning'],
  ['/__ent_auth/grades', 'grades'],
  ['/__ent_auth/mail', 'mail'],
  ['/__ent_auth/moodle', 'moodleDeadlines'],
]

app.use((req, res, next) => {
  for (const [prefix, feature] of FEATURE_GATED_PREFIXES) {
    if ((req.path === prefix || req.path.startsWith(`${prefix}/`)) && !FEATURES[feature]) {
      return res.status(404).json({ ok: false, disabled: true, feature })
    }
  }

  next()
})

// 1. Auth Status Endpoint
app.get('/__ent_auth/session', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({
        authenticated: false,
        user: null,
        sessionMode: null,
        sessionSource: null,
        degraded: false,
        degradedReason: null,
        canUseServerLaunch: false,
        analyticsEnabled: analytics.enabled,
      })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        user: session.user,
        sessionMode: DEMO_SESSION_MODE,
        sessionSource: session.sessionSource ?? null,
        ...getSessionLaunchCapabilities(session),
        analyticsEnabled: analytics.enabled,
      })
    }

    let layout = await fetchEntLayout(session.jar)

    // Portal session lapsed: sign in again silently with the CAS TGC.
    if (!isAuthenticatedLayout(layout)) {
      layout = await reestablishEntSessionOnce(session)
    }

    if (!layout) {
      dropRuntimeSession(session.id)
      clearSensitiveSessionCaches(session)
      clearSessionCookies(res)
      return res.status(200).json({
        authenticated: false,
        user: null,
        sessionMode: null,
        sessionSource: null,
        degraded: false,
        degradedReason: null,
        canUseServerLaunch: false,
        analyticsEnabled: analytics.enabled,
      })
    }

    session.user = layout.data.user
    setSessionCookie(res, session)
    const launchCapabilities = getSessionLaunchCapabilities(session)

    res.status(200).json({
      authenticated: true,
      user: layout.data.user,
      sessionMode: session.mode ?? null,
      sessionSource: session.sessionSource ?? null,
      cookieNames: session.jar.getCookieNamesForHost(ENT_HOST),
      casCookieNames: session.jar.getCookieNamesForHost(CAS_HOST),
      ...launchCapabilities,
      analyticsEnabled: analytics.enabled,
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 2. Login Endpoint
app.post('/__ent_auth/login', async (req, res) => {
  try {
    const username = String(req.body.username ?? '').trim()
    const password = String(req.body.password ?? '')

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required.',
      })
    }

    const activeRateLimit = getActiveLoginRateLimit(req, username)
    if (activeRateLimit) {
      res.setHeader('Retry-After', String(activeRateLimit.retryAfterSeconds))
      return res.status(429).json({
        error: 'Too many login attempts. Please try again later.',
      })
    }

    if (FEATURES.demo !== false && isDemoCredentials(username, password)) {
      const session = createDemoSession()
      clearLoginRateLimit(req, username)
      setSessionCookie(res, session)

      return res.status(200).json({
        authenticated: true,
        user: session.user,
        sessionMode: DEMO_SESSION_MODE,
      })
    }

    const result = await performEntLogin({ username, password })
    clearLoginRateLimit(req, username)
    // The password lives only in this request: the session keeps the CAS TGC,
    // which signs in to every service (ENT, ADE, Moodle, webmail…) on its own.
    const session = {
      id: randomUUID(),
      user: result.layout.user,
      jar: result.jar,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }

    // Prime the ADE session cache while the credentials are still in hand
    // (later refreshes go through the CAS with the TGC).
    try {
      await authenticateToAde(result.jar, { username, password }, {
        cacheScope: getPlanningCacheScope(session),
      })
    } catch (adeError) {
      console.warn('ADE session bootstrap failed during login:', adeError)
    }

    setSessionCookie(res, session)

    res.status(200).json({
      authenticated: true,
      user: result.layout.user,
      sessionMode: session.mode ?? null,
    })
  } catch (error) {
    console.error('ENT login error:', error)
    const rateLimit = recordLoginFailure(req, req.body?.username)
    if (rateLimit) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds))
      return res.status(429).json({
        error: 'Too many login attempts. Please try again later.',
      })
    }

    res.status(401).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 3. Account Info Endpoint
app.get('/__ent_auth/account', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({
        authenticated: false,
        account: null,
        sessionMode: null,
      })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        account: DEMO_ACCOUNT,
        sessionMode: DEMO_SESSION_MODE,
      })
    }

    const response = await fetchWithJar(`${ENT_ORIGIN}/api/v5-1/userinfo`, session.jar, {
      headers: {
        Accept: 'application/jwt, application/json, */*',
        Referer: DEFAULT_REFERER,
      },
      redirect: 'follow',
    })

    const text = await response.text()

    // The endpoint returns a JWT — decode the payload
    const parts = text.split('.')
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
        setSessionCookie(res, session)
        return res.status(200).json({
          authenticated: true,
          account: payload,
          sessionMode: session.mode ?? null,
        })
      } catch {
        // Fall through to raw text response
      }
    }

    // If not a JWT, try to parse as JSON
    let data = text
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // keep as text
    }

    setSessionCookie(res, session)
    res.status(200).json({
      authenticated: true,
      account: data,
      sessionMode: session.mode ?? null,
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 4. Planning Endpoint
app.get('/__ent_auth/planning', async (req, res) => {
  try {
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, events: null })
    }

    const targetDate = String(req.query.date ?? new Date().toISOString().slice(0, 10))
    const requestedResourceId = String(req.query.resourceId ?? '')

    if (isDemoSession(session)) {
      const timetable = buildDemoPlanningPayload({
        date: targetDate,
        resourceId: requestedResourceId,
      })

      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        events: timetable.events,
        weekLabel: timetable.weekLabel,
        dayLabels: timetable.dayLabels,
        resolvedWeek: timetable.resolvedWeek,
        outOfRange: timetable.outOfRange,
        debug: {
          source: 'demo',
        },
      })
    }

    if (USE_PLANNING_PORTAL_REST) {
      const week = getPortalWeekRange(targetDate)
      const portalResult = await fetchPortalEvents(session.jar, {
        date: week.start,
        lookaheadDays: 7,
        resourceIds: requestedResourceId ? [requestedResourceId] : [],
        cacheScope: getPlanningCacheScope(session),
      })

      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        events: portalResult.events,
        weekLabel: week.label,
        dayLabels: week.dayLabels,
        resolvedWeek: week,
        outOfRange: false,
        debug: {
          source: PLANNING_HOST,
          api: 'portal-rest',
          projectId: portalResult.projectId,
          resourceIds: portalResult.resourceIds,
          cache: portalResult.cache,
        },
      })
    }

    const timetable = await fetchPlanningTimetableFromRpc(session.jar, targetDate, requestedResourceId, {
      cacheScope: getPlanningCacheScope(session),
    })

    setSessionCookie(res, session)
    res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      events: timetable.events,
      weekLabel: timetable.weekLabel,
      dayLabels: timetable.dayLabels,
      resolvedWeek: timetable.resolvedWeek,
      outOfRange: timetable.outOfRange,
      debug: {
        finalUrl: timetable.finalUrl,
        planningIdentifier: timetable.planningIdentifier,
        resourceId: timetable.resourceId,
        currentResourceId: timetable.currentResourceId,
        displayConfigurationId: timetable.displayConfigurationId,
        weekIndex: timetable.weekIndex,
        calendarWeekIndex: timetable.calendarWeekIndex,
        requestedDateMatched: timetable.requestedDateMatched,
        outOfRange: timetable.outOfRange,
        cache: timetable.cache,
        planningCookies: session.jar.getCookieNamesForHost(PLANNING_HOST),
      },
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 5. CAS Launch Endpoint — resolves CAS SSO for external app links
app.get('/__ent_auth/launch-preview', async (req, res) => {
  const targetUrl = req.query.url

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({
      finalUrl: String(targetUrl ?? ''),
      chain: [],
      useServerLaunch: false,
      reason: 'invalid-target-url',
    })
  }

  const session = getSessionFromRequest(req)
  const preview = await previewServerLaunch(targetUrl, session)
  return res.status(200).json(preview)
})

app.get('/__ent_auth/launch', async (req, res) => {
  const targetUrl = req.query.url
  const debug = req.query.debug === '1'

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.redirect('/')
  }

  const session = getSessionFromRequest(req)
  if (!session) {
    return res.redirect(targetUrl)
  }

  if (isMoodleLaunchTarget(targetUrl)) {
    try {
      const relay = await prepareMoodleLaunchRelay(session, targetUrl)

      if (debug) {
        return res.json({
          finalUrl: relay.finalUrl,
          chain: relay.chain,
          useServerLaunch: true,
          reason: relay.reason,
          canUseServerLaunch: relay.canUseServerLaunch,
          degraded: relay.degraded,
          degradedReason: relay.degradedReason,
        })
      }

      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.status(200).send(buildAutoSubmitPage({
        title: 'Connexion Moodle',
        heading: 'Connexion a Moodle en cours',
        body: 'Ouverture de votre session universitaire pour Moodle...',
        actionUrl: relay.actionUrl,
        fields: relay.fields,
      }))
      return
    } catch (error) {
      // No server-side relay possible (TGT expired, unexpected page): the
      // browser completes the Moodle sign-in itself.
      if (debug) {
        return res.json({
          finalUrl: targetUrl,
          chain: [],
          useServerLaunch: false,
          reason: 'moodle-launch-error',
          error: error instanceof Error ? error.message : String(error),
        })
      }

      return res.redirect(targetUrl)
    }
  }

  const launchCapabilities = getSessionLaunchCapabilities(session)
  if (!launchCapabilities.canUseServerLaunch) {
    if (debug) {
      return res.json({
        finalUrl: targetUrl,
        chain: [],
        ...launchCapabilities,
      })
    }

    return res.redirect(targetUrl)
  }

  const chain = []
  const targetHost = new URL(targetUrl).hostname

  try {
    let currentUrl = targetUrl

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await fetchWithJar(currentUrl, session.jar, {
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      const location = response.headers.get('location')
      chain.push({ status: response.status, url: currentUrl, location })

      if (!isRedirectStatus(response.status)) {
        const html = await response.text()
        const htmlRedirect = extractHtmlRedirect(html, currentUrl)
        if (htmlRedirect) {
          currentUrl = htmlRedirect
          continue
        }
        if (debug) return res.json({ finalUrl: currentUrl, chain })
        return res.redirect(currentUrl)
      }

      if (!location) {
        if (debug) return res.json({ finalUrl: currentUrl, chain })
        return res.redirect(currentUrl)
      }

      const nextUrl = resolveUrl(location, currentUrl)
      const currentHost = new URL(currentUrl).hostname
      const nextHost = new URL(nextUrl).hostname

      if (isCasHost(currentHost) && !isCasHost(nextHost)) {
        if (nextHost === targetHost) {
          // Simple CAS flow: CAS redirects directly to the target → exit with ticket
          if (debug) return res.json({ finalUrl: nextUrl, chain })
          return res.redirect(nextUrl)
        }
        // SAML/Shibboleth flow detected (CAS → intermediate IdP, not target).
        // Server-side auth can't work here because SAML session cookies
        // are bound to the SP domain and can't be transferred to the browser.
        // Redirect the browser directly — it will complete the full auth flow itself.
        if (debug) return res.json({ finalUrl: targetUrl, chain, saml: true })
        return res.redirect(targetUrl)
      }

      currentUrl = nextUrl
    }

    if (debug) return res.json({ finalUrl: targetUrl, chain, error: 'too many redirects' })
    res.redirect(targetUrl)
  } catch (err) {
    if (debug) return res.json({ error: String(err), chain })
    res.redirect(targetUrl)
  }
})

// 6. Grades Endpoint (ScoDoc / Notes9)
app.get('/__ent_auth/grades', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, grades: null })
    }

    if (isDemoSession(session)) {
      const gradesData = buildDemoGradesPayload()
      setCachedGrades(session.id, gradesData)
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        grades: gradesData,
      })
    }

    const cachedEntry = getCachedGradesEntry(session.id)
    if (cachedEntry) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        grades: cachedEntry.data,
        unavailable: cachedEntry.unavailable ?? false,
      })
    }

    const gradesData = await fetchGradesDataOnce(session)

    setCachedGrades(session.id, gradesData)
    setSessionCookie(res, session)
    res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      grades: gradesData,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const session = getSessionFromRequest(req)
    if (session) {
      setCachedGrades(session.id, null, true)
      setSessionCookie(res, session)
    }
    res.status(200).json({
      authenticated: Boolean(session),
      sessionMode: session?.mode ?? null,
      grades: null,
      unavailable: true,
      error: errorMessage,
    })
  }
})

// ScoDoc formsemestre ids are plain integers.
function parseGradesSemesterId(value) {
  const id = String(value ?? '').trim()
  return /^\d{1,10}$/.test(id) ? id : null
}

function isGradesReportPayload(payload) {
  return Boolean(payload) && typeof payload === 'object' && !payload.redirect && Boolean(payload['relevé'])
}

async function getFirstConnectionGrades(session) {
  const cached = getCachedGrades(session.id)
  if (cached) {
    return cached
  }

  const gradesData = await fetchGradesDataOnce(session)
  setCachedGrades(session.id, gradesData)
  return gradesData
}

// 6b. Relevé of one semester ("Mes notes" page semester picker). Same answer
// shape as /grades: { relevé, absences, totauxAbsences? }.
app.get('/__ent_auth/grades/semester/:semesterId', async (req, res) => {
  let session = null
  try {
    res.setHeader('Cache-Control', 'no-store')
    session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, grades: null })
    }

    const semesterId = parseGradesSemesterId(req.params.semesterId)
    if (!semesterId) {
      return res.status(400).json({ error: 'Invalid semester id.' })
    }

    if (isDemoSession(session)) {
      const gradesData = buildDemoSemesterGradesPayload(semesterId)
      setSessionCookie(res, session)
      return gradesData
        ? res.status(200).json({ authenticated: true, sessionMode: DEMO_SESSION_MODE, grades: gradesData })
        : res.status(404).json({ error: 'Unknown semester.' })
    }

    let gradesData = getCachedSemesterGrades(session.id, semesterId)
    if (!gradesData) {
      gradesData = await fetchGradesData(
        session.jar,
        `${encodeURIComponent('relevéEtudiant')}&semestre=${semesterId}`,
        isGradesReportPayload,
      )
      setCachedSemesterGrades(session.id, semesterId, gradesData)
    }

    setSessionCookie(res, session)
    res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      grades: gradesData,
    })
  } catch (error) {
    res.status(200).json({
      authenticated: true,
      sessionMode: session?.mode ?? null,
      grades: null,
      unavailable: true,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 6c. Department notice shown above the relevé (HTML authored in ScoDoc's
// passerelle; the client renders it as plain text).
app.get('/__ent_auth/grades/department-message', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, message: null })
    }

    const department = String(req.query.dep ?? '').trim()
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(department)) {
      return res.status(400).json({ error: 'Invalid department.' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({ authenticated: true, message: DEMO_GRADES_DEPARTMENT_MESSAGE })
    }

    const payload = await fetchGradesData(
      session.jar,
      `getReportPageMessage&dep=${encodeURIComponent(department)}`,
      (data) => Boolean(data) && typeof data === 'object' && !data.redirect,
    )

    setSessionCookie(res, session)
    res.status(200).json({
      authenticated: true,
      message: typeof payload.message === 'string' && payload.message.trim() ? payload.message : null,
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

function isPdfBuffer(buffer) {
  return buffer.length > 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF'
}

// 6d. Official-looking PDF relevé, generated by the passerelle. The student id
// always comes from the signed-in ScoDoc session, never from the request.
app.get('/__ent_auth/grades/report.pdf', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(401).json({ error: 'Not signed in.' })
    }

    const semesterId = parseGradesSemesterId(req.query.semestre)
    if (!semesterId) {
      return res.status(400).json({ error: 'Invalid semester id.' })
    }

    if (isDemoSession(session)) {
      return res.status(404).json({ error: 'Pas de PDF en mode démo.' })
    }

    const firstConnection = await getFirstConnectionGrades(session)
    const studentId = String(firstConnection?.auth?.session ?? '').trim()
    if (!/^[A-Za-z0-9._@-]{1,64}$/.test(studentId)) {
      throw new Error('ScoDoc student id unavailable.')
    }

    const reportType = req.query.type === 'DUT' ? 'DUT' : 'BUT'
    const pdfUrl = `${GRADES_ORIGIN}/services/bulletin_PDF.php?type=${reportType}&sem_id=${semesterId}&etudiant=${encodeURIComponent(studentId)}`
    let pdf = null

    // The ScoDoc session from the grades fetch is usually still alive; sign in
    // again only when it isn't.
    for (let attempt = 0; attempt < 2 && !pdf; attempt += 1) {
      if (attempt > 0) {
        await ensureGradesSession(session.jar)
      }

      const response = await fetchWithJar(pdfUrl, session.jar, {
        method: 'POST',
        headers: {
          Accept: 'application/pdf, */*',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${GRADES_ORIGIN}/`,
        },
        body: '',
        redirect: 'follow',
      })
      const buffer = Buffer.from(await response.arrayBuffer())

      if (response.ok && isPdfBuffer(buffer)) {
        pdf = buffer
      }
    }

    if (!pdf) {
      return res.status(502).json({ error: 'ScoDoc did not return a PDF.' })
    }

    setSessionCookie(res, session)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="releve-${semesterId}.pdf"`)
    res.status(200).send(pdf)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// The relevé of `semesterId` ('current': the newest one, from the
// first-connection answer), from the caches when possible.
async function getSemesterReleve(session, semesterId) {
  if (semesterId === 'current') {
    return (await getFirstConnectionGrades(session))?.['relevé'] ?? null
  }

  const firstConnection = getCachedGrades(session.id)?.['relevé']
  if (firstConnection && String(firstConnection.formsemestre_id) === semesterId) {
    return firstConnection
  }

  let gradesData = getCachedSemesterGrades(session.id, semesterId)
  if (!gradesData) {
    gradesData = await fetchGradesData(
      session.jar,
      `${encodeURIComponent('relevéEtudiant')}&semestre=${semesterId}`,
      isGradesReportPayload,
    )
    setCachedSemesterGrades(session.id, semesterId, gradesData)
  }
  return gradesData['relevé'] ?? null
}

// 6e. Promo histogram of one evaluation, what the passerelle shows when a
// grade is clicked (data.php?q=listeNotes&eval=…, normalized by
// src/evaluationDistribution.js). Answers { status: 'ok', counts[21], total, bins }
// or { status: 'unavailable', reason: 'disabled' | 'too-few' | 'hidden' }.
// listeNotes takes any evaluation id of the ScoDoc instance: only those of
// the student's own relevé are relayed.
app.get('/__ent_auth/grades/evaluation-distribution', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, status: 'unavailable', reason: 'signed-out' })
    }

    const semesterId = req.query.semestre === 'current' ? 'current' : parseGradesSemesterId(req.query.semestre)
    const evaluationId = parseGradesSemesterId(req.query.eval)
    if (!semesterId || !evaluationId) {
      return res.status(400).json({ error: 'Invalid semester or evaluation id.' })
    }

    if (isDemoSession(session)) {
      const distribution = buildDemoEvaluationDistribution(semesterId, evaluationId)
      setSessionCookie(res, session)
      return distribution
        ? res.status(200).json({ authenticated: true, ...distribution })
        : res.status(404).json({ error: 'Unknown evaluation.' })
    }

    const cacheKey = `${semesterId}:${evaluationId}`
    let distribution = getCachedDistribution(session.id, cacheKey)

    if (!distribution) {
      const releve = await getSemesterReleve(session, semesterId)
      if (!findReleveEvaluation(releve, evaluationId)) {
        return res.status(404).json({ error: 'Unknown evaluation.' })
      }

      if (getCachedGrades(session.id)?.config?.histogramme === false) {
        // The passerelle's own switch, sent with the first-connection answer.
        distribution = { status: 'unavailable', reason: 'disabled' }
      } else if (!('publie' in releve) || releve.publie === false) {
        // Unpublished relevé, or a department that hides its grades (the
        // passerelle then strips the relevé down to its modules).
        distribution = { status: 'unavailable', reason: 'hidden' }
      } else {
        distribution = normalizeDistributionAnswer(await fetchGradesData(
          session.jar,
          `listeNotes&eval=${evaluationId}`,
          (data) => Array.isArray(data) || typeof data?.erreur === 'string',
        ))
        if (!distribution) {
          throw new Error('ScoDoc returned an invalid grade distribution.')
        }
      }

      setCachedDistribution(session.id, cacheKey, distribution)
    }

    setSessionCookie(res, session)
    res.status(200).json({ authenticated: true, ...distribution })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// ---------------------------------------------------------------------------
// Mail ("Mails récents" widget)
// ---------------------------------------------------------------------------
// Université de Rennes' "Messagerie" is RENATER Partage, a hosted Zimbra:
// partage.univ-rennes.fr → sp.partage.renater.fr (Shibboleth SP) →
// ident-shib.univ-rennes1.fr (Shibboleth IdP) → sso-cas.univ-rennes.fr (CAS).
// The provider-specific code lives in the zimbra* helpers below; everything
// is normalized to the contract documented in src/entApi.js#getRecentMail.
//
// Verified with a real Rennes account (Oct 2026): the IdP → SP → Zimbra
// hand-off completes server-side with only the CAS TGC (no consent page) and
// ends on partage.univ-rennes1.fr/service/preauth with a ZM_AUTH_TOKEN cookie;
// that final redirect is plain http://, hence getHttpsOrigin(). SOAP
// SearchRequest/GetFolderRequest work without a CSRF token.
// Still unverified: the per-message deep link (?view=msg&id=…) surviving the
// SAML login when opened in the browser.

class MailAuthError extends Error {}

const MAIL_ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

function buildMailLaunchHref(targetUrl) {
  return targetUrl ? `/__ent_auth/launch?url=${encodeURIComponent(targetUrl)}` : null
}

// /__ent_auth/mail/open hands the server-side Zimbra session to the browser,
// so the webmail opens already signed in.
function getMailWebmailHref() {
  return MAIL_WEBMAIL_URL ? '/__ent_auth/mail/open' : null
}


function hasZimbraAuthCookie(jar, url) {
  const hostname = getHostnameFromUrl(url)
  return Boolean(hostname) && jar.hasCookie(hostname, 'ZM_AUTH_TOKEN')
}

function extractZimbraCsrfToken(html) {
  const match = String(html ?? '').match(/csrfToken\s*[=:]\s*["']([^"']{8,})["']/i)
  return match ? match[1] : null
}

// Partage's final redirect points at http://; API calls must go over HTTPS
// (plain HTTP just 302s back to https and drops the request).
function getHttpsOrigin(url) {
  const parsed = new URL(url)
  parsed.protocol = 'https:'
  return parsed.origin
}

// Server-side SSO chains only follow HTTPS URLs on an allowlist of domains,
// so a hostile redirect can't make us send the session cookies elsewhere.
function assertSignInUrl(url, allowedDomains, label) {
  let parsed = null
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${label} sign-in hit an invalid URL.`)
  }

  const hostname = parsed.hostname.toLowerCase()
  const allowed = parsed.protocol === 'https:'
    && allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))

  if (!allowed) {
    throw new Error(`${label} sign-in left the allowed domains (${hostname}).`)
  }
}

function assertMailSignInUrl(url) {
  assertSignInUrl(url, MAIL_SIGN_IN_DOMAINS, 'Webmail')
}

// A service that answers 403 while signing in (e.g. Moodle closed to
// requests from outside the university's network): the student can still
// open it themselves. `serviceHref`: its direct address, not the launch
// relay, which would hit the same 403.
class ServiceForbiddenError extends Error {
  constructor(label, serviceHref) {
    super(`${label} refuse l’accès depuis Tafac pour le moment (erreur 403). Ouvre-le directement.`)
    this.serviceHref = serviceHref
  }
}

// The mail and Moodle endpoints' errors: 503 with the direct link for a
// ServiceForbiddenError, 500 otherwise.
function sendServiceError(res, error) {
  if (error instanceof ServiceForbiddenError) {
    return res.status(503).json({ error: error.message, forbidden: true, serviceHref: error.serviceHref })
  }
  return res.status(500).json({
    error: error instanceof Error ? error.message : String(error),
  })
}

// Walks webmail → SP → IdP → CAS → IdP → SP (SAML POST) → webmail with a
// copy of the session jar, so the CAS TGC can silently authenticate us.
async function establishZimbraContext(session) {
  if (!MAIL_WEBMAIL_URL) {
    throw new Error('Mail provider not configured')
  }

  if (!getSessionLaunchCapabilities(session).canUseServerLaunch) {
    throw new Error('CAS session unavailable for mail; please sign in again.')
  }

  const jar = CookieJar.fromSerialized(session.jar.serialize())
  let currentUrl = MAIL_WEBMAIL_URL
  let currentMethod = 'GET'
  let currentBody
  let currentHeaders = { Accept: MAIL_ACCEPT_HTML }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    assertMailSignInUrl(currentUrl)
    const response = await fetchWithJar(currentUrl, jar, {
      method: currentMethod,
      body: currentBody,
      headers: currentHeaders,
      redirect: 'manual',
    })
    const location = response.headers.get('location')

    if (isRedirectStatus(response.status) && location) {
      await response.arrayBuffer().catch(() => null)
      const nextUrl = resolveUrl(location, currentUrl)

      // Landed on the webmail with an auth cookie: no need to load the app.
      if (hasZimbraAuthCookie(jar, nextUrl) && !isCasHost(getHostnameFromUrl(nextUrl))) {
        return { jar, origin: getHttpsOrigin(nextUrl), csrfToken: null, createdAt: Date.now() }
      }

      currentUrl = nextUrl
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET'
        currentBody = undefined
        currentHeaders = { Accept: MAIL_ACCEPT_HTML }
      }
      continue
    }

    const html = await response.text()

    if (hasZimbraAuthCookie(jar, currentUrl)) {
      return {
        jar,
        origin: getHttpsOrigin(currentUrl),
        csrfToken: extractZimbraCsrfToken(html),
        createdAt: Date.now(),
      }
    }

    if (isCasHost(getHostnameFromUrl(currentUrl)) && extractHiddenInputValue(html, 'execution')) {
      throw new Error('CAS session expired; please sign in again to load mail.')
    }

    const autoSubmitForm = extractAutoSubmitForm(html, currentUrl)
    if (autoSubmitForm) {
      const referer = currentUrl
      currentUrl = autoSubmitForm.action
      currentMethod = 'POST'
      currentBody = autoSubmitForm.body
      currentHeaders = {
        Accept: MAIL_ACCEPT_HTML,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: new URL(referer).origin,
        Referer: referer,
      }
      continue
    }

    const htmlRedirect = extractHtmlRedirect(html, currentUrl)
    if (htmlRedirect) {
      currentUrl = htmlRedirect
      currentMethod = 'GET'
      currentBody = undefined
      currentHeaders = { Accept: MAIL_ACCEPT_HTML }
      continue
    }

    if (response.status === 403) {
      throw new ServiceForbiddenError('La messagerie', MAIL_WEBMAIL_URL)
    }
    throw new Error(`Webmail sign-in stopped on an unexpected page (${response.status} at ${getHostnameFromUrl(currentUrl)}).`)
  }

  throw new Error('Too many redirects while signing in to the webmail.')
}

async function zimbraSoapRequest(context, requestName, requestBody) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    Referer: `${context.origin}/`,
  }
  const soapContext = { _jsns: 'urn:zimbra' }

  if (context.csrfToken) {
    headers['X-Zimbra-Csrf-Token'] = context.csrfToken
    soapContext.csrfToken = context.csrfToken
  }

  const response = await fetchWithJar(`${context.origin}/service/soap/${requestName}`, context.jar, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      Header: { context: soapContext },
      Body: { [requestName]: { _jsns: 'urn:zimbraMail', ...requestBody } },
    }),
  })
  const payload = await response.json().catch(() => null)
  const fault = payload?.Body?.Fault

  if (fault || !response.ok || !payload?.Body) {
    const code = fault?.Detail?.Error?.Code ?? `HTTP ${response.status}`
    const error = /AUTH_(REQUIRED|EXPIRED)/.test(code) || response.status === 401
      ? new MailAuthError(`Zimbra ${requestName} rejected the session (${code}).`)
      : new Error(`Zimbra ${requestName} failed (${code}).`)
    throw error
  }

  return payload.Body[requestName.replace(/Request$/, 'Response')] ?? {}
}

async function zimbraRestInbox(context) {
  const url = `${context.origin}/service/home/~/inbox?fmt=json&limit=${MAIL_MAX_MESSAGES}`
  const response = await fetchWithJar(url, context.jar, {
    headers: { Accept: 'application/json', Referer: `${context.origin}/` },
  })

  if (response.status === 401 || response.status === 403 || isRedirectStatus(response.status)) {
    throw new MailAuthError(`Zimbra REST rejected the session (HTTP ${response.status}).`)
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error(`Zimbra REST inbox request failed (HTTP ${response.status}).`)
  }

  return Array.isArray(payload.m) ? payload.m : []
}

function normalizeZimbraMessage(message) {
  const addresses = Array.isArray(message?.e) ? message.e : []
  const sender = addresses.find((address) => address?.t === 'f') ?? null
  const email = typeof sender?.a === 'string' && sender.a ? sender.a : null
  const timestamp = Number(message?.d)
  const id = String(message?.id ?? '')

  return {
    id,
    from: {
      name: sender?.p || sender?.d || email || '',
      email,
    },
    subject: typeof message?.su === 'string' ? message.su : '',
    snippet: typeof message?.fr === 'string' ? message.fr.replace(/\s+/g, ' ').trim().slice(0, 280) : '',
    receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
    unread: typeof message?.f === 'string' && message.f.includes('u'),
    flagged: typeof message?.f === 'string' && message.f.includes('f'),
    // Unverified deep link format for the Zimbra Ajax client.
    // Partage can't deep-link through the sign-in handoff: rows open the inbox.
    href: getMailWebmailHref(),
  }
}

function extractZimbraBody(rootMp) {
  let bodyHtml = ''
  let bodyText = ''
  const attachments = []
  const inlineParts = new Map()

  function walk(part) {
    if (!part) return
    if (Array.isArray(part)) {
      part.forEach(walk)
      return
    }

    const ct = String(part.ct || '').toLowerCase()
    const isAttachment = part.cd === 'attachment' || Boolean(part.filename)
    const ci = part.ci ? String(part.ci).replace(/^<|>$/g, '').trim() : null

    if (ci && part.part) {
      inlineParts.set(ci, String(part.part))
    }

    if (isAttachment) {
      attachments.push({
        part: String(part.part || ''),
        filename: part.filename || 'pièce-jointe',
        contentType: ct,
        size: Number(part.s) || null,
        contentId: ci,
      })
      if (!ct.includes('text/html') && !ct.includes('text/plain')) {
        return
      }
    }

    if (ct.includes('text/html') && part.content && !bodyHtml) {
      bodyHtml = part.content
    } else if (ct.includes('text/plain') && part.content && !bodyText) {
      bodyText = part.content
    }

    if (part.mp) {
      walk(part.mp)
    }
  }

  walk(rootMp)
  return { bodyHtml, bodyText, attachments, inlineParts }
}

async function queryZimbraInbox(context, { limit = MAIL_MAX_MESSAGES, query = 'in:inbox', offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || MAIL_MAX_MESSAGES, 1), 50)
  const [searchResult, folderResult] = await Promise.allSettled([
    zimbraSoapRequest(context, 'SearchRequest', {
      types: 'message',
      query: query || 'in:inbox',
      sortBy: 'dateDesc',
      limit: safeLimit,
      offset: Number(offset) || 0,
    }),
    // Folder id 2 is the Inbox in every Zimbra mailbox.
    zimbraSoapRequest(context, 'GetFolderRequest', { folder: { l: '2' }, depth: 0 }),
  ])

  let rawMessages
  if (searchResult.status === 'fulfilled') {
    rawMessages = Array.isArray(searchResult.value?.m) ? searchResult.value.m : []
  } else {
    // SOAP can be refused for CSRF reasons; the REST API has no CSRF check.
    rawMessages = await zimbraRestInbox(context)
  }

  let unreadCount = null
  if (folderResult.status === 'fulfilled') {
    const folder = Array.isArray(folderResult.value?.folder) ? folderResult.value.folder[0] : folderResult.value?.folder
    if (folder && typeof folder === 'object') {
      unreadCount = Number.isFinite(Number(folder.u)) ? Number(folder.u) : 0
    }
  }

  const messages = rawMessages
    .map((message) => normalizeZimbraMessage(message))
    .filter((message) => message.id)
    .sort((left, right) => String(right.receivedAt ?? '').localeCompare(String(left.receivedAt ?? '')))
    .slice(0, safeLimit)

  return { unreadCount, webmailHref: getMailWebmailHref(), messages }
}

async function getZimbraContext(session, { fresh = false } = {}) {
  let context = fresh ? null : runtimeMailContexts.get(session.id)
  if (!context) {
    context = await establishZimbraContext(session)
    runtimeMailContexts.set(session.id, context)
  }
  return context
}

async function fetchZimbraRecentMail(session, options = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let context = attempt === 0 ? runtimeMailContexts.get(session.id) : null

    if (!context) {
      context = await establishZimbraContext(session)
      runtimeMailContexts.set(session.id, context)
    }

    try {
      return await queryZimbraInbox(context, options)
    } catch (error) {
      runtimeMailContexts.delete(session.id)
      if (!(error instanceof MailAuthError) || attempt > 0) {
        throw error
      }
    }
  }

  throw new Error('Unable to load mail.')
}

async function fetchZimbraMessageDetail(session, messageId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let context = attempt === 0 ? runtimeMailContexts.get(session.id) : null
    if (!context) {
      context = await establishZimbraContext(session)
      runtimeMailContexts.set(session.id, context)
    }

    try {
      const response = await zimbraSoapRequest(context, 'GetMsgRequest', {
        m: { id: messageId, html: 1, raw: 0, max: 500000, needExp: 1 },
      })
      const rawMsg = response?.m
      const msg = Array.isArray(rawMsg) ? rawMsg[0] : rawMsg
      if (!msg) {
        throw new Error('Message not found')
      }

      const addresses = Array.isArray(msg?.e) ? msg.e : msg?.e ? [msg.e] : []
      const sender = addresses.find((a) => a?.t === 'f') ?? null
      const recipients = addresses.filter((a) => a?.t === 't').map((a) => ({ name: a?.p || a?.d || a?.a || '', email: a?.a || '' }))
      const ccRecipients = addresses.filter((a) => a?.t === 'c').map((a) => ({ name: a?.p || a?.d || a?.a || '', email: a?.a || '' }))
      const timestamp = Number(msg?.d)
      let { bodyHtml, bodyText, attachments, inlineParts } = extractZimbraBody(msg?.mp)

      // Fallback: If body is empty, try Zimbra REST API directly
      if (!bodyHtml && !bodyText && (!attachments || attachments.length === 0)) {
        try {
          const restUrl = `${context.origin}/service/home/~/?id=${encodeURIComponent(messageId)}`
          const restResp = await fetchWithJar(restUrl, context.jar, {
            headers: { Accept: 'text/html, text/plain, */*', Referer: `${context.origin}/` },
          })
          if (restResp.ok) {
            const rawBody = await restResp.text()
            if (rawBody) {
              const ct = restResp.headers.get('content-type') || ''
              if (ct.includes('text/html') || rawBody.includes('<html') || rawBody.includes('<body') || rawBody.includes('<div')) {
                bodyHtml = rawBody
              } else {
                bodyText = rawBody
              }
            }
          }
        } catch {
          // Body preview extraction failed; fallback to text snippet
        }
      }

      const resolvedId = String(msg.id || messageId)

      // Attach download URLs
      const safeAttachments = (attachments || []).map((att) => ({
        ...att,
        url: `/__ent_auth/mail/attachment?id=${encodeURIComponent(resolvedId)}&part=${encodeURIComponent(att.part)}`,
      }))

      // Rewrite inline images and attachments in bodyHtml
      if (bodyHtml) {
        if (inlineParts && inlineParts.size > 0) {
          for (const [cid, partId] of inlineParts.entries()) {
            const url = `/__ent_auth/mail/attachment?id=${encodeURIComponent(resolvedId)}&part=${encodeURIComponent(partId)}`
            bodyHtml = bodyHtml.split(`cid:${cid}`).join(url)
            bodyHtml = bodyHtml.split(`cid:<${cid}>`).join(url)
          }
        }
        for (const att of safeAttachments) {
          if (att.contentId) {
            bodyHtml = bodyHtml.split(`cid:${att.contentId}`).join(att.url)
            bodyHtml = bodyHtml.split(`cid:<${att.contentId}>`).join(att.url)
          }
        }
        // Rewrite relative Zimbra URLs like /service/home/~/?id=...
        bodyHtml = bodyHtml.replace(
          /(src|href)=["'](?:\/service\/home\/~?\/?\?id=([^"'\s&]+)(?:&amp;|&)part=([^"'\s&]+))["']/gi,
          (match, attr, mId, pId) => `${attr}="/__ent_auth/mail/attachment?id=${mId}&part=${pId}"`
        )
      }

      return {
        id: resolvedId,
        subject: typeof msg.su === 'string' ? msg.su : '',
        from: {
          name: sender?.p || sender?.d || sender?.a || '',
          email: sender?.a || null,
        },
        to: recipients,
        cc: ccRecipients,
        receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
        unread: typeof msg.f === 'string' && msg.f.includes('u'),
        flagged: typeof msg.f === 'string' && msg.f.includes('f'),
        bodyHtml: bodyHtml || null,
        bodyText: bodyText || msg.fr || '',
        snippet: typeof msg.fr === 'string' ? msg.fr.slice(0, 280) : '',
        attachments: safeAttachments,
      }
    } catch (error) {
      runtimeMailContexts.delete(session.id)
      if (!(error instanceof MailAuthError) || attempt > 0) {
        throw error
      }
    }
  }

  throw new Error('Unable to load message details.')
}

function parseRecipients(input, type = 't') {
  if (!input) return []
  const list = Array.isArray(input) ? input : String(input).split(/[,;]+/)
  const recipients = []
  for (const item of list) {
    if (typeof item === 'object' && item !== null) {
      const email = typeof item.email === 'string' ? item.email.trim() : ''
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        recipients.push({ t: type, a: email, ...(name ? { p: name } : {}) })
      }
    } else if (typeof item === 'string') {
      const trimmed = item.trim()
      const match = trimmed.match(/^(?:(.*)<)?([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>?$/)
      if (match) {
        const name = (match[1] || '').replace(/^["']|["']$/g, '').trim()
        const email = match[2].trim()
        recipients.push({ t: type, a: email, ...(name ? { p: name } : {}) })
      }
    }
  }
  return recipients
}

function convertHtmlToPlainText(html) {
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*[/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<blockquote[^>]*>/gi, '> ')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function sendZimbraMail(session, { to, cc, bcc, subject, bodyHtml, bodyText, attachments, origId, replyType } = {}) {
  const toRecipients = parseRecipients(to, 't')
  if (toRecipients.length === 0) {
    throw new Error('Au moins une adresse de destinataire valide est requise.')
  }
  const ccRecipients = parseRecipients(cc, 'c')
  const bccRecipients = parseRecipients(bcc, 'b')
  const allRecipients = [...toRecipients, ...ccRecipients, ...bccRecipients]

  const cleanSubject = typeof subject === 'string' ? subject.trim() : ''
  const finalSubject = cleanSubject || '(Sans objet)'

  const plain = (bodyText || (bodyHtml ? convertHtmlToPlainText(bodyHtml) : '')).trim()
  const html = (bodyHtml || (plain ? `<p>${plain.replace(/\n/g, '<br/>')}</p>` : '')).trim()

  const messagePayload = {
    e: allRecipients,
    su: finalSubject,
  }

  if (origId) {
    messagePayload.origid = String(origId)
    if (replyType) {
      messagePayload.rt = replyType
    }
  }

  if (html && plain) {
    messagePayload.mp = {
      ct: 'multipart/alternative',
      mp: [
        { ct: 'text/plain', content: plain },
        { ct: 'text/html', content: html },
      ],
    }
  } else if (html) {
    messagePayload.mp = {
      ct: 'text/html',
      content: html,
    }
  } else {
    messagePayload.mp = {
      ct: 'text/plain',
      content: plain,
    }
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    const attachmentParts = attachments.map((att) => ({
      ct: att.type || 'application/octet-stream',
      filename: att.name,
      content: att.base64,
    }))
    const bodyPart = messagePayload.mp
    messagePayload.mp = {
      ct: 'multipart/mixed',
      mp: [
        bodyPart,
        ...attachmentParts,
      ],
    }
  }

  const context = await getZimbraContext(session)
  const result = await zimbraSoapRequest(context, 'SendMsgRequest', {
    m: messagePayload,
  })

  // Invalidate cached mail so newly sent items or inbox counts sync
  runtimeMailCache.delete(session.id)

  return {
    ok: true,
    messageId: result?.m?.id || null,
  }
}

const DEMO_DIRECTORY_CONTACTS = [
  { name: 'Secrétariat Pédagogique BUT MMI', email: 'secretariat-mmi@univ-rennes.fr', type: 'service', department: 'IUT de Lannion' },
  { name: 'Scolarité Centrale', email: 'scolarite@univ-rennes.fr', type: 'service', department: 'Université de Rennes' },
  { name: 'Dr. Sophie Bernard (Resp. BUT 3)', email: 'sophie.bernard@univ-rennes.fr', type: 'teacher', department: 'Département Informatique' },
  { name: 'Marc Dupont (Enseignant R6.C.06)', email: 'marc.dupont@univ-rennes.fr', type: 'teacher', department: 'Département Réseaux & Télécoms' },
  { name: 'Claire Martin (Enseignante Web & Multimédia)', email: 'claire.martin@univ-rennes.fr', type: 'teacher', department: 'Département MMI' },
  { name: 'Alexandre Leroux (Professeur Développement)', email: 'alexandre.leroux@univ-rennes.fr', type: 'teacher', department: 'IUT de Lannion' },
  { name: 'Service des Absences & Justificatifs', email: 'absences-mmi@univ-rennes.fr', type: 'service', department: 'Pôle Pédagogie' },
  { name: 'Bibliothèque Universitaire (BU Beaulieu)', email: 'bu-contact@univ-rennes.fr', type: 'service', department: 'Documentation' },
  { name: 'Bureau des Stages & Alternance', email: 'stages-alternance@univ-rennes.fr', type: 'service', department: 'Insertion Professionnelle' },
  { name: 'Service Santé des Étudiants (SSE)', email: 'sante-etudiants@univ-rennes.fr', type: 'service', department: 'Vie Étudiante' },
]

async function searchZimbraDirectory(session, query) {
  if (!query || typeof query !== 'string') return []
  const clean = query.trim()
  if (clean.length < 1) return []

  const context = await getZimbraContext(session)
  try {
    const result = await zimbraSoapRequest(context, 'AutoCompleteRequest', {
      name: clean,
      t: 'all',
      needExp: 1,
    })
    const rawMatches = Array.isArray(result?.match) ? result.match : result?.match ? [result.match] : []
    return rawMatches.map((m) => ({
      name: m.display || m.email || '',
      email: m.email || '',
      type: m.type === 'gal' ? 'gal' : 'contact',
      department: m.department || null,
      title: m.jobTitle || m.title || null,
    })).filter((c) => c.email)
  } catch {
    try {
      const galResult = await zimbraSoapRequest(context, 'SearchGalRequest', {
        name: clean,
        type: 'all',
        limit: 15,
      })
      const entries = Array.isArray(galResult?.cn) ? galResult.cn : galResult?.cn ? [galResult.cn] : []
      return entries.map((entry) => {
        const attrs = Array.isArray(entry._attrs) ? entry._attrs : Array.isArray(entry.a) ? entry.a : []
        const getAttr = (key) => {
          const item = attrs.find((a) => (a.n || a._n) === key)
          return item ? item._content || item.content || item._ || '' : ''
        }
        const email = getAttr('email') || getAttr('mail')
        const fullName = getAttr('fullName') || getAttr('displayName') || `${getAttr('givenName')} ${getAttr('sn')}`.trim()
        return {
          name: fullName || email,
          email,
          type: 'gal',
          department: getAttr('department') || null,
          title: getAttr('title') || null,
        }
      }).filter((c) => c.email)
    } catch {
      return []
    }
  }
}

const MAIL_PROVIDERS = {
  zimbra: fetchZimbraRecentMail,
}

async function fetchRecentMail(session, options = {}) {
  const provider = MAIL_PROVIDERS[MAIL_PROVIDER]
  if (!provider) {
    throw new Error('Mail provider not configured')
  }

  return provider(session, options)
}

// 6c. Open the webmail already signed in. Zimbra's /service/preauth accepts
// an existing auth token (GET ?authtoken=…&isredirect=1), sets ZM_AUTH_TOKEN
// for the browser and redirects to /mail — so the user skips the SAML/CAS
// login. Verified on Partage (Oct 2026): POST and redirectURL are rejected
// (400), so it always lands on the inbox, not on a specific message.
// Any failure falls back to the regular launch relay.
app.get('/__ent_auth/mail/open', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  const fallbackHref = buildMailLaunchHref(MAIL_WEBMAIL_URL) ?? '/'
  const session = getSessionFromRequest(req)

  if (!session || !FEATURES.mail || MAIL_PROVIDER !== 'zimbra') {
    return res.redirect(fallbackHref)
  }

  if (isDemoSession(session)) {
    return res.redirect(buildDemoMailPayload().webmailHref ?? '/')
  }

  try {
    const context = await getZimbraContext(session)
    const authToken = context.jar.getCookieValue(new URL(context.origin).hostname, 'ZM_AUTH_TOKEN')
    if (!authToken) {
      throw new Error('No Zimbra auth token')
    }

    const preauthUrl = new URL('/service/preauth', context.origin)
    preauthUrl.searchParams.set('authtoken', authToken)
    preauthUrl.searchParams.set('isredirect', '1')
    setSessionCookie(res, session)
    res.redirect(preauthUrl.toString())
  } catch {
    res.redirect(fallbackHref)
  }
})

// 6b. Recent mail endpoint (for widget)
app.get('/__ent_auth/mail/recent', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, mail: null })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        mail: buildDemoMailPayload(),
      })
    }

    const cachedMail = getCachedMail(session.id)
    if (cachedMail) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        mail: cachedMail,
      })
    }

    const mail = await fetchRecentMail(session)
    setCachedMail(session.id, mail)
    setSessionCookie(res, session)
    return res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      mail,
    })
  } catch (error) {
    // Messages above are built from status codes/hostnames only — never from
    // cookies, tokens or upstream bodies.
    return sendServiceError(res, error)
  }
})

// 6d. Full inbox / search messages endpoint (for in-app MailPage)
app.get('/__ent_auth/mail/messages', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, mail: null })
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50)
    const userQuery = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const filterQuery = userQuery ? `in:inbox ${userQuery}` : 'in:inbox'

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      const demoPayload = buildDemoMailPayload()
      let messages = demoPayload.messages
      if (userQuery) {
        const q = userQuery.toLowerCase()
        messages = messages.filter(
          (m) =>
            m.subject?.toLowerCase().includes(q) ||
            m.snippet?.toLowerCase().includes(q) ||
            m.from?.name?.toLowerCase().includes(q) ||
            m.from?.email?.toLowerCase().includes(q)
        )
      }
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        mail: {
          ...demoPayload,
          messages: messages.slice(0, limit),
        },
      })
    }

    const mail = await fetchRecentMail(session, { limit, query: filterQuery })
    setSessionCookie(res, session)
    return res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      mail,
    })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6e. Single message detail endpoint (for in-app MailPage reader)
app.get('/__ent_auth/mail/message/:id', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(401).json({ authenticated: false, error: 'Non authentifié' })
    }

    const messageId = req.params.id
    if (!messageId) {
      return res.status(400).json({ error: 'Identifiant de message manquant' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      const message = buildDemoMailMessagePayload(messageId)
      if (!message) {
        return res.status(404).json({ error: 'Message introuvable' })
      }
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        message,
      })
    }

    const message = await fetchZimbraMessageDetail(session, messageId)
    setSessionCookie(res, session)
    return res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      message,
    })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6f. Mark message as read/unread
app.post('/__ent_auth/mail/read', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(401).json({ authenticated: false, error: 'Non authentifié' })
    }

    const { id, read = true } = req.body || {}
    if (!id) {
      return res.status(400).json({ error: 'Identifiant de message manquant' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({ ok: true })
    }

    const context = await getZimbraContext(session)
    await zimbraSoapRequest(context, 'MsgActionRequest', {
      action: { id, op: read ? 'read' : '!read' },
    })
    setSessionCookie(res, session)
    return res.status(200).json({ ok: true })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// Flag a message as important (Zimbra's flag), or not.
app.post('/__ent_auth/mail/flag', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(401).json({ authenticated: false, error: 'Non authentifié' })
    }

    const { id, flagged = true } = req.body || {}
    if (!id) {
      return res.status(400).json({ error: 'Identifiant de message manquant' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({ ok: true })
    }

    const context = await getZimbraContext(session)
    await zimbraSoapRequest(context, 'MsgActionRequest', {
      action: { id, op: flagged ? 'flag' : '!flag' },
    })
    setSessionCookie(res, session)
    return res.status(200).json({ ok: true })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// A link's preview in a mail (linkPreview.js): signed-in students only.
const getLinkPreview = createLinkPreviewer()
app.get('/__ent_auth/link-preview', async (req, res) => {
  if (!getSessionFromRequest(req)) {
    return res.status(401).json({ authenticated: false, preview: null })
  }
  const preview = await getLinkPreview(req.query.url)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  return res.status(200).json({ preview })
})

// 6g. Move message to trash
app.post('/__ent_auth/mail/trash', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(401).json({ authenticated: false, error: 'Non authentifié' })
    }

    const { id } = req.body || {}
    if (!id) {
      return res.status(400).json({ error: 'Identifiant de message manquant' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({ ok: true })
    }

    const context = await getZimbraContext(session)
    await zimbraSoapRequest(context, 'MsgActionRequest', {
      action: { id, op: 'trash' },
    })
    runtimeMailCache.delete(session.id)
    setSessionCookie(res, session)
    return res.status(200).json({ ok: true })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6h. Send mail message (for in-app composer)
app.post('/__ent_auth/mail/send', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(401).json({ authenticated: false, error: 'Non authentifié' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({
        ok: true,
        messageId: `demo-${Date.now()}`,
        demo: true,
      })
    }

    const { to, cc, bcc, subject, bodyHtml, bodyText, origId, replyType, attachments } = req.body || {}
    const result = await sendZimbraMail(session, {
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      attachments,
      origId,
      replyType,
    })

    setSessionCookie(res, session)
    return res.status(200).json(result)
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6h. Directory / Annuaire search endpoint
app.get('/__ent_auth/mail/directory', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(401).json({ authenticated: false, error: 'Non authentifié' })
    }

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      const q = query.toLowerCase()
      const matches = q
        ? DEMO_DIRECTORY_CONTACTS.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              c.email.toLowerCase().includes(q) ||
              (c.department && c.department.toLowerCase().includes(q))
          )
        : DEMO_DIRECTORY_CONTACTS
      return res.status(200).json({ ok: true, contacts: matches })
    }

    const contacts = await searchZimbraDirectory(session, query)
    setSessionCookie(res, session)
    return res.status(200).json({ ok: true, contacts })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6i. Attachment / inline image proxy endpoint
app.get('/__ent_auth/mail/attachment', async (req, res) => {
  try {
    const session = getSessionFromRequest(req)
    if (!session) {
      return res.status(401).end()
    }

    const { id, part } = req.query
    if (!id) {
      return res.status(400).end()
    }

    const context = await getZimbraContext(session)
    const upstreamUrl = `${context.origin}/service/home/~/?id=${encodeURIComponent(id)}${part ? `&part=${encodeURIComponent(part)}` : ''}`
    const upstream = await fetchWithJar(upstreamUrl, context.jar)

    if (!upstream.ok) {
      return res.status(upstream.status).end()
    }

    const ct = upstream.headers.get('content-type') || 'application/octet-stream'
    const cd = upstream.headers.get('content-disposition')
    res.setHeader('Content-Type', ct)
    if (cd) res.setHeader('Content-Disposition', cd)
    res.setHeader('Cache-Control', 'private, max-age=86400')

    const buffer = await upstream.arrayBuffer()
    return res.send(Buffer.from(buffer))
  } catch {
    return res.status(500).end()
  }
})

// ---------------------------------------------------------------------------
// Moodle deadlines ("Échéances Moodle" widget)
// ---------------------------------------------------------------------------
// Signs in to Moodle server-side with a copy of the session jar, reusing the
// launch relay's chain (Shibboleth → WAYF → IdP → CAS → SAML POST back to the
// SP) but posting the SAML response ourselves, so we end with a MoodleSession.
// The dashboard page gives the sesskey (M.cfg.sesskey) needed by the AJAX web
// service; deadlines come from core_calendar_get_action_events_by_timesort (the
// "Chronologie" block), with core_calendar_get_calendar_upcoming_view as a
// fallback when that function is unavailable. Normalized to the contract in
// src/entApi.js#getMoodleDeadlines.
//
// `submitted` is derived from the event's action (see normalizeMoodleEvent):
// best effort, true/false for assignments and quizzes, null otherwise.

class MoodleAuthError extends Error {}

const MOODLE_ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const MOODLE_DEADLINES_MAX_ITEMS = 6
const MOODLE_DEADLINES_MAX_OVERDUE = 3
const MOODLE_DEADLINES_LOOKAHEAD_DAYS = 30
const MOODLE_DEADLINES_OVERDUE_DAYS = 7
const MOODLE_AUTH_ERROR_CODES = new Set([
  'servicerequireslogin',
  'requireloginerror',
  'invalidsesskey',
  'sessionerroruser',
  'sessiontimedout',
])

function assertMoodleSignInUrl(url) {
  assertSignInUrl(url, MOODLE_SIGN_IN_DOMAINS, 'Moodle')
}

function buildMoodleLaunchHref(targetUrl) {
  return targetUrl && isMoodleLaunchTarget(targetUrl)
    ? `/__ent_auth/launch?url=${encodeURIComponent(targetUrl)}`
    : null
}

function extractMoodleSesskey(html) {
  const match = String(html ?? '').match(/"sesskey"\s*:\s*"([A-Za-z0-9]{6,})"/)
  return match ? match[1] : null
}

// Logged-in Moodle pages have a sesskey and no "notloggedin" body class (guest
// pages, e.g. the login page, also carry a sesskey).
function readSignedInMoodlePage(html, url) {
  if (getHostnameFromUrl(url) !== MOODLE_HOST) {
    return null
  }

  const bodyTag = String(html ?? '').match(/<body\b[^>]*>/i)?.[0] ?? ''
  if (!bodyTag || /\bnotloggedin\b/.test(bodyTag)) {
    return null
  }

  return extractMoodleSesskey(html)
}

async function establishMoodleContext(session) {
  if (!MOODLE_SHIBBOLETH_LOGIN_URL) {
    throw new Error('Moodle is not configured for this university.')
  }

  if (!getSessionLaunchCapabilities(session).canUseServerLaunch) {
    throw new MoodleAuthError('CAS session unavailable for Moodle; please sign in again.')
  }

  const jar = CookieJar.fromSerialized(session.jar.serialize())
  let currentUrl = MOODLE_SHIBBOLETH_LOGIN_URL
  let currentMethod = 'GET'
  let currentBody
  let currentHeaders = { Accept: MOODLE_ACCEPT_HTML }

  const goTo = (url, method = 'GET', body = undefined, headers = { Accept: MOODLE_ACCEPT_HTML }) => {
    currentUrl = url
    currentMethod = method
    currentBody = body
    currentHeaders = headers
  }

  for (let attempt = 0; attempt < 25; attempt += 1) {
    assertMoodleSignInUrl(currentUrl)
    const response = await fetchWithJar(currentUrl, jar, {
      method: currentMethod,
      body: currentBody,
      headers: currentHeaders,
      redirect: 'manual',
    })
    const location = response.headers.get('location')

    if (isRedirectStatus(response.status) && location) {
      await response.arrayBuffer().catch(() => null)
      const nextUrl = resolveUrl(location, currentUrl)
      // 307/308 replay a POST as-is; everything else continues as a GET.
      if (currentMethod === 'POST' && (response.status === 307 || response.status === 308)) {
        goTo(nextUrl, 'POST', currentBody, currentHeaders)
      } else {
        goTo(nextUrl)
      }
      continue
    }

    const html = await response.text()

    // Check this first: dashboard JS can look like an HTML redirect.
    const sesskey = response.ok ? readSignedInMoodlePage(html, currentUrl) : null
    if (sesskey) {
      return { jar, sesskey, createdAt: Date.now() }
    }

    if (isCasLoginForm(html, currentUrl)) {
      throw new MoodleAuthError('CAS session expired; please sign in again to load Moodle.')
    }

    if (/name=["']user_idp["']/i.test(html)) {
      if (!WAYF_ENTITY_ID) {
        throw new Error('Moodle WAYF entity id is not configured.')
      }
      const wayfRequest = buildMoodleWayfRequest({ html, url: currentUrl, acceptHeader: MOODLE_ACCEPT_HTML })
      goTo(wayfRequest.actionUrl, 'POST', wayfRequest.body, wayfRequest.headers)
      continue
    }

    const autoSubmitForm = extractAutoSubmitForm(html, currentUrl)
    if (autoSubmitForm) {
      goTo(autoSubmitForm.action, 'POST', autoSubmitForm.body, {
        Accept: MOODLE_ACCEPT_HTML,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: new URL(currentUrl).origin,
        Referer: currentUrl,
      })
      continue
    }

    const htmlRedirect = extractHtmlRedirect(html, currentUrl)
    if (htmlRedirect) {
      goTo(htmlRedirect)
      continue
    }

    if (response.status === 403) {
      throw new ServiceForbiddenError('Moodle', `${MOODLE_ORIGIN}/my/`)
    }
    throw new Error(`Moodle sign-in stopped on an unexpected page (${response.status} at ${getHostnameFromUrl(currentUrl)}).`)
  }

  throw new Error('Too many redirects while signing in to Moodle.')
}

async function moodleAjaxCall(context, methodname, args) {
  const url = `${MOODLE_ORIGIN}/lib/ajax/service.php?sesskey=${encodeURIComponent(context.sesskey)}&info=${encodeURIComponent(methodname)}`
  const response = await fetchWithJar(url, context.jar, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: MOODLE_ORIGIN,
      Referer: `${MOODLE_ORIGIN}/my/`,
    },
    body: JSON.stringify([{ index: 0, methodname, args }]),
  })

  if (response.status === 401 || response.status === 403 || isRedirectStatus(response.status)) {
    await response.arrayBuffer().catch(() => null)
    throw new MoodleAuthError(`Moodle ${methodname} rejected the session (HTTP ${response.status}).`)
  }

  const payload = await response.json().catch(() => null)
  // service.php answers an array of per-call results, or a single error object
  // when the whole request is refused (e.g. invalid sesskey).
  const result = Array.isArray(payload) ? payload[0] : payload
  const errorcode = result?.exception?.errorcode ?? result?.errorcode ?? null

  if (!response.ok || !result || typeof result !== 'object' || result.error) {
    const code = errorcode ? String(errorcode) : `HTTP ${response.status}`
    throw MOODLE_AUTH_ERROR_CODES.has(code)
      ? new MoodleAuthError(`Moodle ${methodname} rejected the session (${code}).`)
      : new Error(`Moodle ${methodname} failed (${code}).`)
  }

  return result.data
}

function getMoodleDeadlineType(modulename) {
  return ['assign', 'quiz', 'forum'].includes(modulename) ? modulename : 'other'
}

function normalizeMoodleEvent(event, nowMs) {
  const timestamp = Number(event?.timesort ?? event?.timestart)
  if (!event || !Number.isFinite(timestamp) || timestamp <= 0) {
    return null
  }

  const type = getMoodleDeadlineType(String(event.modulename ?? ''))
  const dueAtMs = timestamp * 1000
  const action = event.action && typeof event.action === 'object' ? event.action : null
  const title = [event.activityname, event.name]
    .find((value) => typeof value === 'string' && value.trim())
  const rawUrl = typeof event.url === 'string' ? event.url : (typeof action?.url === 'string' ? action.url : '')
  const cmidMatch = rawUrl.match(/[?&]id=(\d+)/)
  const cmid = cmidMatch ? Number(cmidMatch[1]) : (event.instance ? Number(event.instance) : null)

  return {
    id: String(event.id ?? `${event.modulename ?? 'event'}-${event.instance ?? ''}-${timestamp}`),
    cmid,
    title: title ? decodeHtmlEntities(title.trim()) : '',
    courseName: decodeHtmlEntities(String(event.course?.fullname || event.course?.shortname || '').trim()),
    dueAt: new Date(dueAtMs).toISOString(),
    type,
    overdue: dueAtMs < nowMs,
    // Moodle drops the action of an assignment/quiz once it's submitted.
    submitted: type === 'assign' || type === 'quiz' ? !action : null,
    href: buildMoodleLaunchHref(typeof event.url === 'string' ? event.url : null),
  }
}

function selectMoodleDeadlines(events, nowMs) {
  const fromMs = nowMs - MOODLE_DEADLINES_OVERDUE_DAYS * 24 * 60 * 60 * 1000
  const toMs = nowMs + MOODLE_DEADLINES_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000
  const seen = new Set()
  const items = events
    .map((event) => normalizeMoodleEvent(event, nowMs))
    .filter((item) => {
      if (!item || seen.has(item.id)) return false
      seen.add(item.id)
      const dueAtMs = Date.parse(item.dueAt)
      return dueAtMs >= fromMs && dueAtMs <= toMs
    })
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt))

  // Keep the most recent overdue items only, so stale ones don't crowd out
  // what's coming up.
  const overdue = items.filter((item) => item.overdue).slice(-MOODLE_DEADLINES_MAX_OVERDUE)
  const upcoming = items.filter((item) => !item.overdue)
  return [...overdue, ...upcoming].slice(0, MOODLE_DEADLINES_MAX_ITEMS)
}

async function requestMoodleEvents(context, methodname, args) {
  const data = await moodleAjaxCall(context, methodname, args)
  if (!Array.isArray(data?.events)) {
    throw new Error(`Moodle ${methodname} returned no event list.`)
  }
  return data.events
}

// Two web services, one request each:
// - core_calendar_get_action_events_by_timesort (the "Chronologie" block): what
//   is still to do, overdue items included; completed activities are left out.
// - core_calendar_get_calendar_upcoming_view (the "Événements à venir" block):
//   every upcoming event, with `action` unset once the student has submitted.
//   It brings back submitted assignments/quizzes, and is the fallback list
//   when the first service is unavailable (then without overdue items).
async function queryMoodleDeadlines(context) {
  const nowMs = Date.now()
  const nowSeconds = Math.floor(nowMs / 1000)
  const [actionResult, upcomingResult] = await Promise.allSettled([
    requestMoodleEvents(context, 'core_calendar_get_action_events_by_timesort', {
      limitnum: 30,
      timesortfrom: nowSeconds - MOODLE_DEADLINES_OVERDUE_DAYS * 24 * 60 * 60,
      timesortto: nowSeconds + MOODLE_DEADLINES_LOOKAHEAD_DAYS * 24 * 60 * 60,
      limittononsuspendedevents: true,
    }),
    requestMoodleEvents(context, 'core_calendar_get_calendar_upcoming_view', {
      courseid: 1,
      categoryid: 0,
    }),
  ])

  for (const result of [actionResult, upcomingResult]) {
    if (result.status === 'rejected' && result.reason instanceof MoodleAuthError) {
      throw result.reason
    }
  }

  const upcomingEvents = upcomingResult.status === 'fulfilled'
    ? upcomingResult.value.filter((event) => event?.modulename)
    : []
  let events

  if (actionResult.status === 'fulfilled') {
    const actionEventIds = new Set(actionResult.value.map((event) => String(event?.id)))
    const submittedEvents = upcomingEvents.filter((event) => (
      !actionEventIds.has(String(event.id))
      && !event.action
      && ['assign', 'quiz'].includes(event.modulename)
    ))
    events = [...actionResult.value, ...submittedEvents]
  } else if (upcomingResult.status === 'fulfilled') {
    events = upcomingEvents
  } else {
    throw actionResult.reason
  }

  return {
    moodleHref: buildMoodleLaunchHref(`${MOODLE_ORIGIN}/my/`),
    items: selectMoodleDeadlines(events, nowMs),
  }
}

async function getMoodleContext(session) {
  let context = runtimeMoodleContexts.get(session.id)
  if (context && Date.now() - context.createdAt > MOODLE_CONTEXT_TTL_MS) {
    context = null
  }

  if (!context) {
    context = await establishMoodleContext(session)
    runtimeMoodleContexts.set(session.id, context)
  }
  return context
}

async function fetchMoodleDeadlines(session) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const context = await getMoodleContext(session)
      return await queryMoodleDeadlines(context)
    } catch (error) {
      runtimeMoodleContexts.delete(session.id)
      if (!(error instanceof MoodleAuthError) || attempt > 0) {
        throw error
      }
    }
  }

  throw new Error('Unable to load Moodle deadlines.')
}

// Concurrent requests for the same session share one sign-in + fetch, so two
// SAML chains never race on the same Moodle context.
const moodleDeadlinesInflight = new Map()

function fetchMoodleDeadlinesOnce(session) {
  const inflight = moodleDeadlinesInflight.get(session.id)
  if (inflight) {
    return inflight
  }

  const promise = fetchMoodleDeadlines(session).finally(() => moodleDeadlinesInflight.delete(session.id))
  moodleDeadlinesInflight.set(session.id, promise)
  return promise
}

async function queryMoodleCourses(context) {
  let data
  try {
    data = await moodleAjaxCall(context, 'core_course_get_enrolled_courses_by_timeline_classification', {
      classification: 'all',
      limit: 0,
      offset: 0,
      sort: 'fullname',
    })
  } catch {
    try {
      data = await moodleAjaxCall(context, 'core_course_get_enrolled_courses_by_timeline_classification', {
        classification: 'all',
        limit: 0,
        offset: 0,
        sort: 'ul.timeaccess desc',
      })
    } catch {
      data = await moodleAjaxCall(context, 'core_enrol_get_users_courses', {
        userid: 0,
      })
    }
  }

  const rawCourses = Array.isArray(data?.courses) ? data.courses : (Array.isArray(data) ? data : [])
  const courses = rawCourses.map((course) => {
    const viewurl = course.viewurl || (MOODLE_ORIGIN ? `${MOODLE_ORIGIN}/course/view.php?id=${course.id}` : null)
    return {
      id: Number(course.id),
      fullname: decodeHtmlEntities(String(course.fullname || course.fullnamedisplay || '').trim()),
      shortname: decodeHtmlEntities(String(course.shortname || '').trim()),
      category: decodeHtmlEntities(String(course.coursecategory || course.categoryname || '').trim()),
      progress: typeof course.progress === 'number' && Number.isFinite(course.progress) ? Math.round(course.progress) : null,
      hasprogress: Boolean(course.hasprogress),
      courseimage: course.courseimage || null,
      viewurl,
      moodleHref: buildMoodleLaunchHref(viewurl),
    }
  }).sort((a, b) => a.fullname.localeCompare(b.fullname, 'fr'))

  return {
    moodleHref: buildMoodleLaunchHref(`${MOODLE_ORIGIN}/my/`),
    courses,
  }
}

async function fetchMoodleCourses(session) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const context = await getMoodleContext(session)
      return await queryMoodleCourses(context)
    } catch (error) {
      runtimeMoodleContexts.delete(session.id)
      if (!(error instanceof MoodleAuthError) || attempt > 0) {
        throw error
      }
    }
  }

  throw new Error('Unable to load Moodle courses.')
}

const moodleCoursesInflight = new Map()

function fetchMoodleCoursesOnce(session) {
  const inflight = moodleCoursesInflight.get(session.id)
  if (inflight) {
    return inflight
  }

  const promise = fetchMoodleCourses(session).finally(() => moodleCoursesInflight.delete(session.id))
  moodleCoursesInflight.set(session.id, promise)
  return promise
}

function parseMoodleCoursePageHtml(html, courseId) {
  if (!html || typeof html !== 'string') {
    return { courseId: Number(courseId), sections: [] }
  }

  const sections = []

  // 1. Primary parser: Moodle 4 Course Index drawer (<nav id="courseindex"> / .courseindex-section)
  // This is generated on 100% of Moodle 4 course pages (University of Rennes / theme_boost_union)
  if (html.includes('courseindex-section') || html.includes('course-index-section-')) {
    const courseIndexChunks = html.split(/(?=<div\b[^>]*\bid=["']course-index-section-\d+["']|<div\b[^>]*class=["'][^"']*\bcourseindex-section\b[^"']*["'][^>]*data-for=["']section["'])/i)

    for (const chunk of courseIndexChunks) {
      const idMatch = chunk.match(/\bid=["']course-index-section-(\d+)["']/i) || chunk.match(/data-id=["'](\d+)["']/i)
      if (!idMatch) continue

      const sectionId = Number(idMatch[1])
      const numMatch = chunk.match(/data-number=["'](\d+)["']/i)
      const sectionNum = numMatch ? Number(numMatch[1]) : sectionId

      let title = ''
      const titleMatch = chunk.match(/data-for=["']section_title["'][^>]*>([\s\S]*?)<\/a>/i)
        || chunk.match(/class=["'][^"']*\bcourseindex-section-title\b[^"']*["'][\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)
      if (titleMatch) {
        title = titleMatch[1].replace(/<[^>]+>/g, '').trim()
      }
      if (!title) {
        title = sectionNum === 0 ? 'Généralités' : `Section ${sectionNum}`
      }

      // Restrict module search to this section's cmlist ul if available
      const cmlistMatch = chunk.match(/<ul\b[^>]*data-for=["']cmlist["'][^>]*data-id=["']\d+["'][\s\S]*?<\/ul>/i)
      const contentToSearch = cmlistMatch ? cmlistMatch[0] : chunk

      const modules = []
      const cmChunks = contentToSearch.split(/(?=<li\b[^>]*class=["'][^"']*\bcourseindex-item\b[^"']*["'][^>]*data-for=["']cm["'])/i)

      for (const cmChunk of cmChunks) {
        const cmidMatch = cmChunk.match(/data-id=["'](\d+)["']/i) || cmChunk.match(/\bid=["']course-index-cm-(\d+)["']/i)
        const linkMatch = cmChunk.match(/href=["']([^"']*\/mod\/([a-zA-Z0-9_-]+)\/[^"']*\bid=\d+[^"']*)["']/i)
        if (!cmidMatch || !linkMatch) continue

        const cmid = Number(cmidMatch[1])
        const modUrl = linkMatch[1]
        const modType = linkMatch[2].toLowerCase()

        let modName = ''
        const nameMatch = cmChunk.match(/data-for=["']cm_name["'][^>]*>([\s\S]*?)<\/a>/i)
          || cmChunk.match(/<a\b[^>]*class=["'][^"']*\bcourseindex-link\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
        if (nameMatch) {
          modName = nameMatch[1].replace(/<[^>]+>/g, '').trim()
        }
        if (!modName) {
          modName = `${modType} ${cmid}`
        }
        modName = decodeHtmlEntities(modName)

        const contents = []
        if (modType === 'resource' && modUrl) {
          const effectiveUrl = modUrl.includes('redirect=1') ? modUrl : `${modUrl}${modUrl.includes('?') ? '&' : '?'}redirect=1`
          let detectedFilename = modName
          if (!detectedFilename.includes('.')) {
            detectedFilename = `${detectedFilename}.pdf`
          }

          contents.push({
            filename: detectedFilename,
            filesize: 0,
            fileurl: effectiveUrl,
            mimetype: 'application/pdf',
            proxyUrl: `/__ent_auth/moodle/file?url=${encodeURIComponent(effectiveUrl)}&name=${encodeURIComponent(detectedFilename)}`,
          })
        }

        const pluralMap = {
          resource: 'Fichiers',
          assign: 'Devoirs',
          quiz: 'Tests',
          forum: 'Forums',
          folder: 'Dossiers',
          url: 'Liens',
          page: 'Pages',
        }

        const downloadFolderProxyUrl = modType === 'folder' && MOODLE_ORIGIN
          ? `/__ent_auth/moodle/file?url=${encodeURIComponent(`${MOODLE_ORIGIN}/mod/folder/download_folder.php?id=${cmid}`)}&name=${encodeURIComponent(`${modName}.zip`)}&download=1`
          : null

        modules.push({
          id: cmid,
          name: modName,
          modname: modType,
          modplural: pluralMap[modType] || modType,
          modicon: null,
          url: modUrl,
          launchHref: buildMoodleLaunchHref(modUrl),
          contents,
          downloadFolderProxyUrl,
        })
      }

      if (modules.length > 0 || (title && title !== 'Généralités')) {
        sections.push({
          id: sectionId,
          name: decodeHtmlEntities(title),
          summary: '',
          modules,
        })
      }
    }
  }

  // 2. Secondary fallback parser: Traditional section/activity DOM (Moodle 3 or course page body)
  if (sections.length === 0) {
    const sectionSplits = html.split(/(?=<li\b[^>]*\bid=["']section-\d+["']|<div\b[^>]*\bid=["']section-\d+["']|<div\b[^>]*class=["'][^"']*\bcourse-section\b[^"']*["']|<li\b[^>]*class=["'][^"']*\bsection\b[^"']*["'])/i)

    for (const chunk of sectionSplits) {
      const idMatch = chunk.match(/\bid=["']section-(\d+)["']/i)
        || chunk.match(/data-sectionid=["'](\d+)["']/i)
        || chunk.match(/data-id=["'](\d+)["']/i)
      if (!idMatch) continue

      const sectionNum = Number(idMatch[1])

      let title = ''
      const titleMatch = chunk.match(/<(?:h3|h4|div)\b[^>]*class=["'][^"']*(?:sectionname|section-title|section_title)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h3|h4|div)>/i)
        || chunk.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)
      if (titleMatch) {
        title = titleMatch[1]
          .replace(/<span\b[^>]*class=["'][^"']*accesshide[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
          .replace(/<[^>]+>/g, '')
          .trim()
      }
      if (!title) {
        title = sectionNum === 0 ? 'Généralités' : `Section ${sectionNum}`
      }

      let summary = ''
      const summaryMatch = chunk.match(/<div\b[^>]*class=["'][^"']*(?:summary|section-summary|description-inner)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
      if (summaryMatch) {
        summary = summaryMatch[1].trim()
      }

      const modules = []
      const moduleChunks = chunk.split(/(?=<li\b[^>]*class=["'][^"']*\bactivity\b|<div\b[^>]*class=["'][^"']*\bactivity-item\b)/i)

      for (const modChunk of moduleChunks) {
        if (!modChunk.includes('/mod/')) continue

        const linkMatch = modChunk.match(/href=["']([^"']*\/mod\/([a-zA-Z0-9_-]+)\/[^"']*\bid=(\d+)[^"']*)["']/i)
        if (!linkMatch) continue

        const modUrl = linkMatch[1]
        const modType = linkMatch[2].toLowerCase()
        const cmid = Number(linkMatch[3])

        if (modules.some((m) => m.id === cmid)) continue

        let modName = ''
        const nameMatch = modChunk.match(/<span\b[^>]*class=["'][^"']*(?:instancename|activityname)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
        if (nameMatch) {
          modName = nameMatch[1]
            .replace(/<span\b[^>]*class=["'][^"']*accesshide[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
            .replace(/<[^>]+>/g, '')
            .trim()
        } else {
          const aMatch = modChunk.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
          if (aMatch) {
            modName = aMatch[1]
              .replace(/<span\b[^>]*class=["'][^"']*accesshide[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
              .replace(/<[^>]+>/g, '')
              .trim()
          }
        }

        if (!modName) {
          modName = `${modType} ${cmid}`
        }

        modName = decodeHtmlEntities(modName)

        const contents = []
        if (modType === 'resource' && modUrl) {
          const effectiveUrl = modUrl.includes('redirect=1') ? modUrl : `${modUrl}${modUrl.includes('?') ? '&' : '?'}redirect=1`
          let detectedFilename = modName
          if (!detectedFilename.includes('.')) {
            detectedFilename = `${detectedFilename}.pdf`
          }

          contents.push({
            filename: detectedFilename,
            filesize: 0,
            fileurl: effectiveUrl,
            mimetype: 'application/pdf',
            proxyUrl: `/__ent_auth/moodle/file?url=${encodeURIComponent(effectiveUrl)}&name=${encodeURIComponent(detectedFilename)}`,
          })
        }

        const pluralMap = {
          resource: 'Fichiers',
          assign: 'Devoirs',
          quiz: 'Tests',
          forum: 'Forums',
          folder: 'Dossiers',
          url: 'Liens',
          page: 'Pages',
        }

        const downloadFolderProxyUrl = modType === 'folder' && MOODLE_ORIGIN
          ? `/__ent_auth/moodle/file?url=${encodeURIComponent(`${MOODLE_ORIGIN}/mod/folder/download_folder.php?id=${cmid}`)}&name=${encodeURIComponent(`${modName}.zip`)}&download=1`
          : null

        modules.push({
          id: cmid,
          name: modName,
          modname: modType,
          modplural: pluralMap[modType] || modType,
          modicon: null,
          url: modUrl,
          launchHref: buildMoodleLaunchHref(modUrl),
          contents,
          downloadFolderProxyUrl,
        })
      }

      if (modules.length > 0 || summary) {
        sections.push({
          id: sectionNum,
          name: decodeHtmlEntities(title),
          summary,
          modules,
        })
      }
    }
  }

  return {
    courseId: Number(courseId),
    sections,
  }
}

function parseMoodleFolderPageHtml(html, cmid, moodleOrigin) {
  if (!html || typeof html !== 'string') {
    return { cmid: Number(cmid), name: '', files: [], downloadFolderProxyUrl: null }
  }

  const h2Match = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)
  const name = h2Match ? decodeHtmlEntities(h2Match[1].replace(/<[^>]+>/g, '').trim()) : ''

  const files = []
  const fileRegex = /href=["']([^"']*\/pluginfile\.php\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  const seenUrls = new Set()

  while ((match = fileRegex.exec(html)) !== null) {
    let fileurl = match[1].replace(/&amp;/g, '&')
    if (fileurl.startsWith('/')) {
      fileurl = `${moodleOrigin}${fileurl}`
    }
    if (seenUrls.has(fileurl)) continue
    seenUrls.add(fileurl)

    if (fileurl.includes('/theme_') || fileurl.includes('/pix/') || fileurl.includes('/favicon')) {
      continue
    }

    let filename = match[2].replace(/<[^>]+>/g, '').trim()
    if (!filename || filename.length > 150) {
      try {
        filename = decodeURIComponent(new URL(fileurl).pathname.split('/').pop() || '')
      } catch {
        filename = 'document.pdf'
      }
    }
    if (!filename) filename = 'document.pdf'

    files.push({
      filename,
      filepath: '/',
      filesize: 0,
      fileurl,
      mimetype: filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
      timemodified: 0,
      proxyUrl: `/__ent_auth/moodle/file?url=${encodeURIComponent(fileurl)}&name=${encodeURIComponent(filename)}`,
    })
  }

  const downloadFolderUrl = `${moodleOrigin}/mod/folder/download_folder.php?id=${cmid}`
  const downloadFolderProxyUrl = `/__ent_auth/moodle/file?url=${encodeURIComponent(downloadFolderUrl)}&name=${encodeURIComponent(name || 'dossier')}.zip&download=1`

  return {
    cmid: Number(cmid),
    name,
    files,
    downloadFolderProxyUrl,
  }
}

async function queryMoodleCourseContents(context, courseId) {
  try {
    const data = await moodleAjaxCall(context, 'core_course_get_contents', {
      courseid: Number(courseId),
      options: [],
    })

    if (Array.isArray(data)) {
      const sections = data
        .filter((section) => section.uservisible !== false)
        .map((section) => {
          const modules = (Array.isArray(section.modules) ? section.modules : [])
            .filter((mod) => mod.uservisible !== false && mod.visibleoncoursepage !== 0)
            .map((mod) => {
              const modUrl = mod.url || null
              const modType = String(mod.modname || 'other').toLowerCase()

              let contents = (Array.isArray(mod.contents) ? mod.contents : []).map((file) => {
                let fileurl = file.fileurl || null
                if (fileurl && fileurl.includes('/webservice/pluginfile.php/')) {
                  fileurl = fileurl.replace('/webservice/pluginfile.php/', '/pluginfile.php/')
                }
                const filename = file.filename || 'document.pdf'
                return {
                  filename,
                  filepath: file.filepath || '/',
                  filesize: Number(file.filesize) || 0,
                  fileurl,
                  mimetype: file.mimetype || 'application/pdf',
                  timemodified: Number(file.timemodified) || 0,
                  proxyUrl: fileurl
                    ? `/__ent_auth/moodle/file?url=${encodeURIComponent(fileurl)}&name=${encodeURIComponent(filename)}`
                    : null,
                }
              })

              // If contents is empty but this is a resource activity with a URL, create the direct file entry
              if (contents.length === 0 && (modType === 'resource' || (modUrl && modUrl.includes('/mod/resource/')))) {
                const effectiveUrl = modUrl.includes('redirect=1') ? modUrl : `${modUrl}${modUrl.includes('?') ? '&' : '?'}redirect=1`
                let detectedFilename = decodeHtmlEntities(String(mod.name || 'document')).trim()
                if (!detectedFilename.includes('.')) {
                  detectedFilename = `${detectedFilename}.pdf`
                }
                contents = [{
                  filename: detectedFilename,
                  filepath: '/',
                  filesize: 0,
                  fileurl: effectiveUrl,
                  mimetype: 'application/pdf',
                  proxyUrl: `/__ent_auth/moodle/file?url=${encodeURIComponent(effectiveUrl)}&name=${encodeURIComponent(detectedFilename)}`,
                }]
              }

              const isFolder = modType === 'folder'
              const cmid = Number(mod.id)
              const downloadFolderProxyUrl = isFolder && MOODLE_ORIGIN
                ? `/__ent_auth/moodle/file?url=${encodeURIComponent(`${MOODLE_ORIGIN}/mod/folder/download_folder.php?id=${cmid}`)}&name=${encodeURIComponent(`${decodeHtmlEntities(String(mod.name || 'dossier')).trim()}.zip`)}&download=1`
                : null

              return {
                id: cmid,
                name: decodeHtmlEntities(String(mod.name || '').trim()),
                modname: modType,
                modplural: decodeHtmlEntities(String(mod.modplural || '').trim()),
                modicon: mod.modicon || null,
                url: modUrl,
                launchHref: buildMoodleLaunchHref(modUrl),
                contents,
                downloadFolderProxyUrl,
              }
            })

          return {
            id: Number(section.id),
            name: decodeHtmlEntities(String(section.name || `Section ${section.section ?? ''}`).trim()),
            summary: section.summary || '',
            modules,
          }
        })

      return {
        courseId: Number(courseId),
        sections,
      }
    }
  } catch (err) {
    if (err instanceof MoodleAuthError) {
      throw err
    }
  }

  // Fallback: fetch course/view.php?id=... with session jar and parse HTML
  try {
    const url = `${MOODLE_ORIGIN}/course/view.php?id=${encodeURIComponent(courseId)}`
    const resp = await fetchWithJar(url, context.jar, {
      headers: { Accept: MOODLE_ACCEPT_HTML },
    })

    if (resp.status === 401 || resp.status === 403) {
      throw new MoodleAuthError(`Moodle course view rejected the session (${resp.status}).`)
    }

    if (resp.ok) {
      const html = await resp.text()
      return parseMoodleCoursePageHtml(html, courseId)
    }
  } catch (err) {
    if (err instanceof MoodleAuthError) {
      throw err
    }
  }

  return {
    courseId: Number(courseId),
    sections: [],
  }
}

async function fetchMoodleCourseContents(session, courseId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const context = await getMoodleContext(session)
      return await queryMoodleCourseContents(context, courseId)
    } catch (error) {
      runtimeMoodleContexts.delete(session.id)
      if (!(error instanceof MoodleAuthError) || attempt > 0) {
        throw error
      }
    }
  }

  throw new Error('Unable to load course contents.')
}

const moodleContentsInflight = new Map()

function fetchMoodleCourseContentsOnce(session, courseId) {
  const key = `${session.id}:${courseId}`
  const inflight = moodleContentsInflight.get(key)
  if (inflight) {
    return inflight
  }

  const promise = fetchMoodleCourseContents(session, courseId).finally(() => moodleContentsInflight.delete(key))
  moodleContentsInflight.set(key, promise)
  return promise
}

// 6d. Moodle deadlines endpoint
app.get('/__ent_auth/moodle/deadlines', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, deadlines: null })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        deadlines: buildDemoMoodleDeadlinesPayload(),
      })
    }

    const cachedDeadlines = getCachedMoodleDeadlines(session.id)
    if (cachedDeadlines) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        deadlines: cachedDeadlines,
      })
    }

    const deadlines = await fetchMoodleDeadlinesOnce(session)
    setCachedMoodleDeadlines(session.id, deadlines)
    setSessionCookie(res, session)
    return res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      deadlines,
    })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6e. Moodle enrolled courses endpoint
app.get('/__ent_auth/moodle/courses', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, courses: [] })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        ...buildDemoMoodleCoursesPayload(),
      })
    }

    const cached = getCachedMoodleCourses(session.id)
    if (cached) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        ...cached,
      })
    }

    const payload = await fetchMoodleCoursesOnce(session)
    setCachedMoodleCourses(session.id, payload)
    setSessionCookie(res, session)
    return res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      ...payload,
    })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6f. Moodle course contents & resources endpoint
app.get('/__ent_auth/moodle/course-contents', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(200).json({ authenticated: false, sections: [] })
    }

    const courseId = Number(req.query.courseId)
    if (!Number.isFinite(courseId) || courseId <= 0) {
      return res.status(400).json({ error: 'Valid courseId is required.' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        ...buildDemoMoodleCourseContentsPayload(courseId),
      })
    }

    const cached = getCachedMoodleContents(session.id, courseId)
    if (cached) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        ...cached,
      })
    }

    const payload = await fetchMoodleCourseContentsOnce(session, courseId)
    setCachedMoodleContents(session.id, courseId, payload)
    setSessionCookie(res, session)
    return res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      ...payload,
    })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6g. Moodle folder contents endpoint
app.get('/__ent_auth/moodle/folder-contents', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)
    if (!session) {
      return res.status(200).json({ authenticated: false, files: [] })
    }

    const cmid = Number(req.query.cmid)
    const courseId = Number(req.query.courseId)
    if (!Number.isFinite(cmid) || cmid <= 0) {
      return res.status(400).json({ error: 'Valid cmid is required.' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      const demoContents = buildDemoMoodleCourseContentsPayload(courseId || 101)
      const allMods = (demoContents.sections || []).flatMap((s) => s.modules || [])
      const matchedMod = allMods.find((m) => m.id === cmid)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        cmid,
        name: matchedMod?.name || 'Dossier',
        files: (matchedMod?.contents || []).map((file) => ({
          ...file,
          proxyUrl: file.proxyUrl || `/__ent_auth/moodle/file?url=${encodeURIComponent(file.fileurl || '')}&name=${encodeURIComponent(file.filename || '')}`,
        })),
        downloadFolderProxyUrl: matchedMod?.downloadFolderProxyUrl || `/__ent_auth/moodle/file?download=1&name=${encodeURIComponent(matchedMod?.name || 'dossier')}.zip`,
      })
    }

    if (courseId) {
      const cached = getCachedMoodleContents(session.id, courseId)
      if (cached?.sections) {
        const found = cached.sections.flatMap((s) => s.modules || []).find((m) => m.id === cmid)
        if (found && Array.isArray(found.contents) && found.contents.length > 0) {
          setSessionCookie(res, session)
          return res.status(200).json({
            authenticated: true,
            sessionMode: session.mode ?? null,
            cmid,
            name: found.name,
            files: found.contents,
            downloadFolderProxyUrl: found.downloadFolderProxyUrl || null,
          })
        }
      }
    }

    const context = await getMoodleContext(session)
    const folderUrl = `${MOODLE_ORIGIN}/mod/folder/view.php?id=${encodeURIComponent(cmid)}`
    const resp = await fetchWithJar(folderUrl, context.jar, {
      headers: { Accept: MOODLE_ACCEPT_HTML },
    })

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Moodle folder request failed (${resp.status})` })
    }

    const html = await resp.text()
    const parsed = parseMoodleFolderPageHtml(html, cmid, MOODLE_ORIGIN)
    setSessionCookie(res, session)
    return res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      ...parsed,
    })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6g. Moodle assignment details & submission parsing
function parseMoodleAssignmentPageHtml(html, cmid, moodleOrigin) {
  const nameMatch = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)
    || html.match(/<div\b[^>]*class=["'][^"']*\bpage-header-headings\b[^"']*["'][^>]*>([\s\S]*?)<\/h[12]>/i)
    || html.match(/data-region=["']header["'][^>]*>([\s\S]*?)<\/h[12]>/i)
  const name = nameMatch ? decodeHtmlEntities(nameMatch[1].replace(/<[^>]+>/g, '').trim()) : `Devoir ${cmid}`

  let introHtml = ''
  const introMatch = html.match(/<div\b[^>]*class=["'][^"']*\b(intro|generalbox|no-overflow)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/<div\b[^>]*id=["']intro["'][^>]*>([\s\S]*?)<\/div>/i)
  if (introMatch) {
    introHtml = introMatch[2].trim().replace(/href=["']([^"']*pluginfile\.php[^"']*)["']/gi, (_m, u) => {
      let full = u
      if (full.startsWith('/')) full = `${moodleOrigin}${full}`
      return `href="/__ent_auth/moodle/file?url=${encodeURIComponent(full)}&name=document"`
    })
  }

  let status = 'not_submitted'
  let statusLabel = 'Aucun devoir remis'
  let gradingStatus = 'not_graded'
  let gradingStatusLabel = 'Non noté'
  let dueDateFormatted = ''
  let timeRemaining = ''
  let lastModified = ''
  const submittedFiles = []
  let onlineText = ''
  const acceptedTypes = []

  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch
  while ((trMatch = rowRegex.exec(html)) !== null) {
    const rowContent = trMatch[1]
    const thMatch = rowContent.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)
    const tdMatch = rowContent.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)
    if (!thMatch || !tdMatch) continue

    const header = thMatch[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
    const tdText = decodeHtmlEntities(tdMatch[1].replace(/<[^>]+>/g, '').trim())
    const tdHtml = tdMatch[1]

    if (header.includes('statut') && (header.includes('remis') || header.includes('travaux') || header.includes('submission'))) {
      if (/remis pour|submitted for/i.test(tdText)) {
        status = 'submitted'
        statusLabel = 'Remis pour évaluation'
      } else if (/brouillon|draft/i.test(tdText)) {
        status = 'draft'
        statusLabel = 'Brouillon (non remis)'
      } else {
        status = 'not_submitted'
        statusLabel = tdText || 'Aucun devoir remis'
      }
    } else if (header.includes('évaluation') || header.includes('grading')) {
      if (/non noté|not graded/i.test(tdText)) {
        gradingStatus = 'not_graded'
        gradingStatusLabel = 'Non noté'
      } else if (/noté|graded|évalué/i.test(tdText)) {
        gradingStatus = 'graded'
        gradingStatusLabel = tdText || 'Noté'
      }
    } else if (header.includes('date limite') || header.includes('due date')) {
      dueDateFormatted = tdText
    } else if (header.includes('temps restant') || header.includes('time remaining')) {
      timeRemaining = tdText
    } else if (header.includes('dernière modification') || header.includes('last modified')) {
      lastModified = tdText
    } else if (header.includes('fichiers') || header.includes('file submissions')) {
      const fileRegex = /<a\b[^>]*href=["']([^"']*pluginfile\.php[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
      let fMatch
      while ((fMatch = fileRegex.exec(tdHtml)) !== null) {
        let fileurl = fMatch[1].replace(/&amp;/g, '&')
        if (fileurl.startsWith('/')) fileurl = `${moodleOrigin}${fileurl}`
        const fname = decodeHtmlEntities(fMatch[2].replace(/<[^>]+>/g, '').trim())
        if (fname && !submittedFiles.some((f) => f.filename === fname)) {
          submittedFiles.push({
            filename: fname,
            fileurl,
            proxyUrl: `/__ent_auth/moodle/file?url=${encodeURIComponent(fileurl)}&name=${encodeURIComponent(fname)}&download=1`,
          })
        }
      }
    } else if (header.includes('texte en ligne') || header.includes('online text')) {
      onlineText = tdHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim()
    } else if (header.includes('types de fichiers') || header.includes('accepted')) {
      const exts = tdText.match(/\.[a-zA-Z0-9_-]+/g)
      if (exts) {
        for (const ext of exts) {
          if (!acceptedTypes.includes(ext.toLowerCase())) acceptedTypes.push(ext.toLowerCase())
        }
      }
    }
  }

  const canSubmit = /action=editsubmission/i.test(html) || /ajouter un travail|modifier le devoir/i.test(html)
  const canFinalize = /action=submit\b/i.test(html) || /envoyer le devoir/i.test(html)
  const canRemove = /action=removesubmissionconfirm/i.test(html) || /supprimer le devoir/i.test(html)

  return {
    cmid: Number(cmid),
    name,
    introHtml,
    status,
    statusLabel,
    gradingStatus,
    gradingStatusLabel,
    dueDateFormatted,
    timeRemaining,
    lastModified,
    submittedFiles,
    onlineText,
    acceptedTypes: acceptedTypes.length > 0 ? acceptedTypes : ['.pdf', '.zip', '.tar.gz', '.sql', '.md', '.txt', '.docx'],
    maxFiles: 5,
    maxFileSizeFormatted: '50 Mo',
    canSubmit,
    canEdit: canSubmit,
    canFinalize,
    canRemove,
    launchHref: buildMoodleLaunchHref(`${moodleOrigin}/mod/assign/view.php?id=${cmid}`),
  }
}

function extractMoodleFormHiddenInputs(html) {
  const fields = {}
  const inputRegex = /<input\b[^>]*>/gi
  let match
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0]
    if (!/\btype=["']hidden["']/i.test(tag)) continue
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i)
    const valueMatch = tag.match(/\bvalue=["']([^"']*?)["']/i)
    if (nameMatch) {
      fields[decodeHtmlEntities(nameMatch[1])] = valueMatch ? decodeHtmlEntities(valueMatch[1]) : ''
    }
  }
  return fields
}

async function submitMoodleAssignmentLive(context, cmid, files, onlineText, finalize) {
  const editUrl = `${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}&action=editsubmission`
  const { response: editResp, finalUrl: editFinalUrl } = await followRedirectChain(editUrl, context.jar, {
    headers: {
      Accept: MOODLE_ACCEPT_HTML,
      Referer: `${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}`,
    },
  })
  const editHtml = await editResp.text()

  if (isCasLoginForm(editHtml, editFinalUrl) || isMoodleLoginPage(editHtml, editFinalUrl)) {
    throw new MoodleAuthError('Session Moodle expirée, veuillez vous reconnecter.')
  }

  const sesskeyMatch = editHtml.match(/name=["']sesskey["'][^>]*value=["']([^"']+)["']/i)
    || editHtml.match(/value=["']([^"']+)["'][^>]*name=["']sesskey["']/i)
    || editHtml.match(/["']sesskey["']\s*:\s*["']([^"']+)["']/i)
  const pageSesskey = sesskeyMatch ? sesskeyMatch[1] : context.sesskey

  const hiddenInputs = extractMoodleFormHiddenInputs(editHtml)

  let draftItemId = hiddenInputs['files_filemanager']
  if (!draftItemId) {
    const fmKey = Object.keys(hiddenInputs).find((k) => k.includes('filemanager') || k.includes('files'))
    if (fmKey) draftItemId = hiddenInputs[fmKey]
  }
  if (!draftItemId) {
    const draftItemMatch = editHtml.match(/name=["']files_filemanager["'][^>]*value=["'](\d+)["']/i)
      || editHtml.match(/value=["'](\d+)["'][^>]*name=["']files_filemanager["']/i)
      || editHtml.match(/["']itemid["']\s*:\s*(\d+)/i)
      || editHtml.match(/draftitemid["']\s*:\s*(\d+)/i)
    draftItemId = draftItemMatch ? draftItemMatch[1] : null
  }

  const repoMatch = editHtml.match(/["']type["']\s*:\s*["']upload["'][^}]*?["']id["']\s*:\s*(\d+)/i)
    || editHtml.match(/["']id["']\s*:\s*(\d+)[^}]*?["']type["']\s*:\s*["']upload["']/i)
    || editHtml.match(/repo_id["']?\s*[:=]\s*["']?(\d+)/i)
  const repoId = repoMatch ? repoMatch[1] : '4'

  if (draftItemId && Array.isArray(files) && files.length > 0) {
    for (const file of files) {
      const buffer = Buffer.from(file.base64 || '', 'base64')
      const formData = new FormData()
      formData.append('repo_id', repoId)
      formData.append('itemid', draftItemId)
      formData.append('sesskey', pageSesskey)
      const filename = file.name || file.filename || 'rendu.md'
      formData.append('title', filename)
      formData.append('author', '')
      formData.append('license', 'allrightsreserved')
      formData.append('savepath', '/')
      const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' })
      formData.append('repo_upload_file', blob, filename)

      const uploadUrl = `${MOODLE_ORIGIN}/repository/repository_ajax.php?action=upload`
      const uploadResp = await fetchWithJar(uploadUrl, context.jar, {
        method: 'POST',
        body: formData,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Origin: MOODLE_ORIGIN,
          Referer: editFinalUrl || editUrl,
        },
      })

      const uploadJson = await uploadResp.json().catch(() => null)
      if (uploadJson && uploadJson.error) {
        throw new Error(uploadJson.error || 'Erreur lors du dépôt du fichier dans Moodle.')
      }
    }
  }

  const saveParams = new URLSearchParams()
  for (const [key, value] of Object.entries(hiddenInputs)) {
    saveParams.append(key, value)
  }

  saveParams.set('id', String(cmid))
  saveParams.set('action', 'savesubmission')
  saveParams.set('sesskey', pageSesskey)
  saveParams.set('_qf__mod_assign_submission_form', '1')

  if (draftItemId) {
    saveParams.set('files_filemanager', String(draftItemId))
  }

  if (onlineText) {
    saveParams.set('onlinetext_editor[text]', onlineText)
    saveParams.set('onlinetext_editor[format]', '1')
    if (hiddenInputs['onlinetext_editor[itemid]']) {
      saveParams.set('onlinetext_editor[itemid]', hiddenInputs['onlinetext_editor[itemid]'])
    }
  }

  if (/name=["']submissionstatement["']/i.test(editHtml)) {
    saveParams.set('submissionstatement', '1')
  }

  const submitBtnMatch = editHtml.match(/name=["']submitbutton["'][^>]*value=["']([^"']*)["']/i)
    || editHtml.match(/value=["']([^"']*)["'][^>]*name=["']submitbutton["']/i)
  const submitButtonValue = submitBtnMatch ? decodeHtmlEntities(submitBtnMatch[1]) : 'Enregistrer les modifications'
  saveParams.set('submitbutton', submitButtonValue)

  const saveUrl = `${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}`
  const { response: saveResp } = await followRedirectChain(saveUrl, context.jar, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: MOODLE_ORIGIN,
      Referer: editFinalUrl || editUrl,
    },
    body: saveParams.toString(),
  })

  const saveHtml = await saveResp.text()
  const formErrorMatch = saveHtml.match(/class=["'][^"']*\b(form-control-feedback|error|alert-danger)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p)>/i)
  if (formErrorMatch && !saveResp.headers.get('location') && !/action=editsubmission/i.test(saveResp.url || '')) {
    const errorText = decodeHtmlEntities(formErrorMatch[2].replace(/<[^>]+>/g, '').trim())
    if (errorText) {
      throw new Error(errorText)
    }
  }

  if (finalize) {
    const confirmParams = new URLSearchParams()
    confirmParams.append('id', String(cmid))
    confirmParams.append('action', 'submit')
    confirmParams.append('sesskey', pageSesskey)
    confirmParams.append('confirm', '1')

    await followRedirectChain(`${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}`, context.jar, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: MOODLE_ORIGIN,
        Referer: saveUrl,
      },
      body: confirmParams.toString(),
    }).catch(() => null)
  }

  const { response: viewResp } = await followRedirectChain(`${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}`, context.jar, {
    headers: { Accept: MOODLE_ACCEPT_HTML },
  })
  const viewHtml = await viewResp.text()
  return parseMoodleAssignmentPageHtml(viewHtml, cmid, MOODLE_ORIGIN)
}

async function removeMoodleAssignmentFileLive(context, cmid, filename) {
  const editUrl = `${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}&action=editsubmission`
  const { response: editResp, finalUrl: editFinalUrl } = await followRedirectChain(editUrl, context.jar, {
    headers: {
      Accept: MOODLE_ACCEPT_HTML,
      Referer: `${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}`,
    },
  })
  const editHtml = await editResp.text()

  const sesskeyMatch = editHtml.match(/name=["']sesskey["'][^>]*value=["']([^"']+)["']/i)
    || editHtml.match(/value=["']([^"']+)["'][^>]*name=["']sesskey["']/i)
    || editHtml.match(/["']sesskey["']\s*:\s*["']([^"']+)["']/i)
  const pageSesskey = sesskeyMatch ? sesskeyMatch[1] : context.sesskey

  const hiddenInputs = extractMoodleFormHiddenInputs(editHtml)
  let draftItemId = hiddenInputs['files_filemanager']
  if (!draftItemId) {
    const fmKey = Object.keys(hiddenInputs).find((k) => k.includes('filemanager') || k.includes('files'))
    if (fmKey) draftItemId = hiddenInputs[fmKey]
  }

  if (draftItemId) {
    const deleteParams = new URLSearchParams()
    deleteParams.append('sesskey', pageSesskey)
    deleteParams.append('itemid', String(draftItemId))
    deleteParams.append('filepath', '/')
    deleteParams.append('filename', filename)

    await fetchWithJar(`${MOODLE_ORIGIN}/repository/draftfiles_ajax.php?action=delete`, context.jar, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: MOODLE_ORIGIN,
        Referer: editFinalUrl || editUrl,
      },
      body: deleteParams.toString(),
    }).catch(() => null)
  }

  const saveParams = new URLSearchParams()
  for (const [key, value] of Object.entries(hiddenInputs)) {
    saveParams.append(key, value)
  }
  saveParams.set('id', String(cmid))
  saveParams.set('action', 'savesubmission')
  saveParams.set('sesskey', pageSesskey)
  saveParams.set('_qf__mod_assign_submission_form', '1')
  if (draftItemId) {
    saveParams.set('files_filemanager', String(draftItemId))
  }
  saveParams.set('submitbutton', 'Enregistrer les modifications')

  const saveUrl = `${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}`
  await followRedirectChain(saveUrl, context.jar, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: MOODLE_ORIGIN,
      Referer: editFinalUrl || editUrl,
    },
    body: saveParams.toString(),
  })

  const { response: viewResp } = await followRedirectChain(`${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}`, context.jar, {
    headers: { Accept: MOODLE_ACCEPT_HTML },
  })
  const viewHtml = await viewResp.text()
  return parseMoodleAssignmentPageHtml(viewHtml, cmid, MOODLE_ORIGIN)
}

// 6h. Moodle assignment details endpoint
app.get('/__ent_auth/moodle/assignment-details', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)
    if (!session) {
      return res.status(200).json({ authenticated: false, assignment: null })
    }

    const cmid = Number(req.query.cmid)
    const courseId = req.query.courseId ? Number(req.query.courseId) : null
    if (!cmid || !Number.isFinite(cmid)) {
      return res.status(400).json({ error: 'Paramètre cmid requis' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      const assignment = getDemoAssignmentDetails(cmid, courseId)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        assignment,
      })
    }

    const context = await getMoodleContext(session)
    const viewUrl = `${MOODLE_ORIGIN}/mod/assign/view.php?id=${encodeURIComponent(cmid)}`
    const { response: resp } = await followRedirectChain(viewUrl, context.jar, {
      headers: { Accept: MOODLE_ACCEPT_HTML },
    })

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Moodle assign request failed (${resp.status})` })
    }

    const html = await resp.text()
    const assignment = parseMoodleAssignmentPageHtml(html, cmid, MOODLE_ORIGIN)
    setSessionCookie(res, session)
    return res.status(200).json({
      authenticated: true,
      sessionMode: session.mode ?? null,
      assignment,
    })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// 6i. Moodle assignment submission endpoint
app.post('/__ent_auth/moodle/submit-assignment', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)
    if (!session) {
      return res.status(401).json({ error: 'Session non authentifiée' })
    }

    const { cmid, files, onlineText, finalize } = req.body || {}
    const numericCmid = Number(cmid)
    if (!numericCmid || !Number.isFinite(numericCmid)) {
      return res.status(400).json({ error: 'Paramètre cmid requis' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      const assignment = submitDemoAssignment({
        cmid: numericCmid,
        files: Array.isArray(files) ? files : [],
        onlineText: typeof onlineText === 'string' ? onlineText : '',
        finalize: Boolean(finalize),
      })
      return res.status(200).json({
        ok: true,
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        message: 'Devoir téléversé avec succès',
        assignment,
      })
    }

    const context = await getMoodleContext(session)
    const assignment = await submitMoodleAssignmentLive(context, numericCmid, files, onlineText, finalize)
    setSessionCookie(res, session)
    return res.status(200).json({
      ok: true,
      authenticated: true,
      sessionMode: session.mode ?? null,
      message: 'Devoir téléversé avec succès sur Moodle',
      assignment,
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// 6j. Moodle remove assignment file endpoint
app.post('/__ent_auth/moodle/assignment-file/remove', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)
    if (!session) {
      return res.status(401).json({ error: 'Session non authentifiée' })
    }

    const { cmid, filename } = req.body || {}
    const numericCmid = Number(cmid)
    if (!numericCmid || !filename) {
      return res.status(400).json({ error: 'Paramètres cmid et filename requis' })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      const assignment = removeDemoAssignmentFile({ cmid: numericCmid, filename })
      return res.status(200).json({
        ok: true,
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        message: 'Fichier retiré',
        assignment,
      })
    }

    const context = await getMoodleContext(session)
    const assignment = await removeMoodleAssignmentFileLive(context, numericCmid, filename)
    setSessionCookie(res, session)
    return res.status(200).json({
      ok: true,
      authenticated: true,
      sessionMode: session.mode ?? null,
      message: 'Fichier retiré avec succès sur Moodle',
      assignment,
    })
  } catch (error) {
    return sendServiceError(res, error)
  }
})

// Cache for resolved pluginfile URLs so subsequent clicks are instantaneous
const moodleResolvedFileUrls = new Map()

// 6g. Moodle file download / preview proxy
app.get('/__ent_auth/moodle/file', async (req, res) => {
  try {
    const session = getSessionFromRequest(req)
    if (!session) {
      return res.status(401).end()
    }

    const { url: targetUrl, name, download } = req.query
    if (!targetUrl || typeof targetUrl !== 'string') {
      return res.status(400).end()
    }

    if (isDemoSession(session)) {
      const fileName = String(name || 'document.pdf')
      const isZip = fileName.endsWith('.zip')
      const ct = isZip ? 'application/zip' : 'application/pdf'
      const disposition = download === '1' ? 'attachment' : 'inline'
      res.setHeader('Content-Type', ct)
      res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`)
      res.setHeader('Cache-Control', 'private, max-age=86400')
      const samplePdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n')
      return res.send(samplePdf)
    }

    let parsed
    try {
      parsed = new URL(targetUrl)
    } catch {
      return res.status(400).end()
    }

    const host = parsed.hostname.toLowerCase()
    const allowedHosts = new Set([
      MOODLE_HOST,
      ...(MOODLE_SIGN_IN_DOMAINS ?? []).map((d) => d.toLowerCase()),
    ].filter(Boolean))

    if (!allowedHosts.has(host) && !host.endsWith(`.${MOODLE_HOST}`)) {
      return res.status(403).end()
    }

    const context = await getMoodleContext(session)

    // Check if we already have the resolved pluginfile URL for this resource
    const cachedResolved = moodleResolvedFileUrls.get(targetUrl)
    if (cachedResolved) {
      const redirectUrl = download === '1'
        ? (cachedResolved.includes('forcedownload=1') ? cachedResolved : `${cachedResolved}${cachedResolved.includes('?') ? '&' : '?'}forcedownload=1`)
        : cachedResolved
      return res.redirect(redirectUrl)
    }

    if (targetUrl.includes('/pluginfile.php/')) {
      const redirectUrl = download === '1'
        ? (targetUrl.includes('forcedownload=1') ? targetUrl : `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}forcedownload=1`)
        : targetUrl
      return res.redirect(redirectUrl)
    }

    let fetchUrl = targetUrl
    if (fetchUrl.includes('/mod/resource/view.php') && !fetchUrl.includes('redirect=1')) {
      fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'redirect=1'
    }

    let { response: upstream, finalUrl } = await followRedirectChain(fetchUrl, context.jar)

    if (finalUrl && finalUrl.includes('/pluginfile.php/')) {
      moodleResolvedFileUrls.set(targetUrl, finalUrl)
      const redirectUrl = download === '1'
        ? (finalUrl.includes('forcedownload=1') ? finalUrl : `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}forcedownload=1`)
        : finalUrl
      return res.redirect(redirectUrl)
    }

    // If the response is text/html (like Moodle's resource viewer wrapper /mod/resource/view.php?id=...)
    // we extract the direct file download URL (pluginfile.php) specifically from the resource container,
    // carefully ignoring any favicons or theme images!
    let ct = upstream.headers.get('content-type') || ''
    let discoveredName = ''

    if (upstream.ok && ct.includes('text/html')) {
      const htmlText = await upstream.text()

      // 1. Highest priority: Moodle's standard download container <div class="resourceworkaround">...<a href="...">...</a></div>
      const workaroundMatch = htmlText.match(/class=["'][^"']*resourceworkaround[^"']*["'][\s\S]*?<a\b[^>]*href=["']([^"']*\/pluginfile\.php\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)

      // 2. Second priority: Links with /mod_resource/content/ path (the true Moodle resource file location)
      const modContentMatch = htmlText.match(/(?:href|data|src)=["']([^"']*\/pluginfile\.php\/\d+\/mod_resource\/content\/\d+\/[^"']*)["']/i)
        || htmlText.match(/https?:\/\/[^"'\s<>]*\/pluginfile\.php\/\d+\/mod_resource\/content\/\d+\/[^"'\s<>]+/i)

      // 3. Embedded object or viewer
      const embedMatch = htmlText.match(/<(?:object|embed|iframe)\b[^>]*(?:data|src)=["']([^"']*\/pluginfile\.php\/(?!.*(?:theme_|favicon|pix\/))[^"']*)["']/i)

      // 4. Any direct file link with pluginfile.php that points to a document
      const cleanPluginfile = htmlText.match(/href=["']([^"']*\/pluginfile\.php\/(?!.*(?:theme_|favicon|pix\/))[^"']*(?:\.pdf|\.zip|\.docx?|\.pptx?|\.xlsx?)[^"']*)["']/i)

      let extractedCandidate = null
      if (workaroundMatch) {
        extractedCandidate = workaroundMatch[1]
        discoveredName = workaroundMatch[2].replace(/<[^>]+>/g, '').trim()
      } else if (modContentMatch) {
        extractedCandidate = modContentMatch[1] || modContentMatch[0]
      } else if (embedMatch) {
        extractedCandidate = embedMatch[1]
      } else if (cleanPluginfile) {
        extractedCandidate = cleanPluginfile[1]
      }

      if (extractedCandidate) {
        let extractedUrl = extractedCandidate.replace(/&amp;/g, '&')
        if (extractedUrl.startsWith('/')) {
          extractedUrl = `${parsed.origin}${extractedUrl}`
        }

        moodleResolvedFileUrls.set(targetUrl, extractedUrl)

        const redirectUrl = download === '1'
          ? (extractedUrl.includes('forcedownload=1') ? extractedUrl : `${extractedUrl}${extractedUrl.includes('?') ? '&' : '?'}forcedownload=1`)
          : extractedUrl
        return res.redirect(redirectUrl)
      }
    }

    if (!upstream.ok) {
      return res.status(upstream.status).end()
    }

    // Determine the filename from discoveredName, finalUrl, or original name
    let fileName = discoveredName || String(name || '').trim()
    try {
      const pathname = new URL(finalUrl || fetchUrl).pathname
      const last = decodeURIComponent(pathname.split('/').pop() || '')
      if (last && last.includes('.')) {
        fileName = last
      }
    } catch {
      // Ignore URL parsing fallback
    }

    if (!fileName) {
      fileName = 'document.pdf'
    }

    // Ensure proper content-type for PDF/Zip if Moodle sent a generic octet-stream
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    if (ext === 'pdf' && (!ct || ct.includes('octet-stream') || ct.includes('text/html'))) {
      ct = 'application/pdf'
    } else if (ext === 'zip' && (!ct || ct.includes('octet-stream'))) {
      ct = 'application/zip'
    } else if (!ct) {
      ct = 'application/octet-stream'
    }

    const disposition = download === '1' ? 'attachment' : 'inline'
    res.setHeader('Content-Type', ct)
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}"`)
    res.setHeader('Cache-Control', 'private, max-age=86400')

    const buffer = await upstream.arrayBuffer()
    return res.send(Buffer.from(buffer))
  } catch (err) {
    console.error('Moodle file proxy error:', err)
    return res.status(500).end()
  }
})


app.get('/__ent_auth/student-pic', async (req, res) => {
  try {
    const wantsMeta = req.query.meta === '1'
    const session = getSessionFromRequest(req)

    if (!session) {
      if (wantsMeta) {
        return res.status(200).json({
          authenticated: false,
          available: false,
          source: 'scodoc',
          previewUrl: null,
        })
      }

      return res.status(401).json({
        error: 'Authentication required.',
      })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      if (wantsMeta) {
        return res.status(200).json({
          authenticated: true,
          sessionMode: DEMO_SESSION_MODE,
          available: false,
          source: 'demo',
          previewUrl: null,
        })
      }

      return res.status(404).json({ available: false, source: 'demo' })
    }

    const picture = await fetchGradesStudentPicture(session.jar)
    const isImage = isGradesStudentPicture(picture)

    setSessionCookie(res, session)
    res.setHeader('Cache-Control', 'no-store')

    if (wantsMeta) {
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        available: picture.ok && isImage,
        source: 'scodoc',
        contentType: picture.contentType,
        size: picture.size,
        status: picture.status,
        previewUrl: picture.ok && isImage ? '/__ent_auth/student-pic' : null,
      })
    }

    if (!picture.ok || !isImage) {
      return res.status(404).json({
        available: false,
        source: 'scodoc',
        contentType: picture.contentType,
        status: picture.status,
      })
    }

    res.setHeader('Content-Type', picture.contentType)
    res.setHeader('Content-Length', String(picture.size))
    return res.status(200).end(picture.buffer)
  } catch (error) {
    if (req.query.meta === '1') {
      return res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      })
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// CROUS restaurants and menus (« Menu du RU »), from the CROUS's own public
// feeds (server/crousFeed.js): no sign-in involved, cached for everyone.
const getCrousFeed = FEATURES.crous && universityConfig.crous?.region
  ? createCrousFeed({ region: universityConfig.crous.region })
  : null

// The region's restaurants, and the coming days of `resto` (an id from that
// list) when asked: { restaurants, restaurantId, days, fetchedAt }.
app.get('/__ent_auth/crous', async (req, res) => {
  try {
    if (!getCrousFeed) {
      return res.status(404).json({ error: 'CROUS menus are not enabled.' })
    }

    const feed = await getCrousFeed()
    const restaurantId = typeof req.query.resto === 'string' && feed.restaurants.some((resto) => resto.id === req.query.resto)
      ? req.query.resto
      : null
    // Many RUs publish no menu online: `hasMenu` says which have one from
    // today on (French time), to point the student to them.
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date())
    const hasUpcomingMenu = (id) => (feed.menus.get(id) ?? [])
      .some((day) => day.date >= today && day.meals.some((meal) => meal.sections.length))
    res.setHeader('Cache-Control', 'private, max-age=600')
    res.status(200).json({
      restaurants: feed.restaurants.map((resto) => ({ ...resto, hasMenu: hasUpcomingMenu(resto.id) })),
      restaurantId,
      days: restaurantId ? feed.menus.get(restaurantId) ?? [] : [],
      fetchedAt: new Date(feed.fetchedAt).toISOString(),
    })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// « Bus »: the town's bus network (server/transitFeed.js), journeys and
// departures (server/transitPlanner.js), and the anonymous push reminders
// (server/transitPush.js). Public data: only the reminders need a session.
const TRANSIT_CONFIG = FEATURES.transit && universityConfig.transit?.gtfsUrl ? universityConfig.transit : null
const transitFeed = TRANSIT_CONFIG
  ? createTransitFeed({ gtfsUrl: TRANSIT_CONFIG.gtfsUrl, realtimeUrl: TRANSIT_CONFIG.realtimeUrl ?? null })
  : null
const transitPush = transitFeed
  ? createTransitPushStore({
    universityId: universityConfig.id,
    dataDir: options.appIcons?.dataDir ?? resolveDataDir(),
    feed: transitFeed,
    // The contact push services ask for (Apple refuses localhost ones).
    subject: process.env.VAPID_SUBJECT || 'https://github.com/l-ent-univ/tafac',
  })
  : null
if (transitPush && options.transitPush?.start !== false) transitPush.start()
app.locals.transitPush = transitPush

const TRANSIT_MAX_QUERIES = 20

// { placeId } | { lat, lon } | { campus } → [{ stopId, walkSeconds }], or
// null when it names nothing this network knows.
function resolveTransitPoint(network, point) {
  if (!point || typeof point !== 'object') return null
  if (typeof point.placeId === 'string') {
    const place = network.places.get(point.placeId)
    return place ? place.stopIds.map((stopId) => ({ stopId, walkSeconds: 0 })) : null
  }
  const campus = typeof point.campus === 'string' ? TRANSIT_CONFIG.campuses?.[point.campus] : null
  const lat = campus ? campus.lat : Number(point.lat)
  const lon = campus ? campus.lon : Number(point.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return stopsNear(network, { lat, lon })
}

// GET → the network as the client draws it: { name, attribution, timezone,
//   validUntil, realtime, routes, places, lines, campuses }
app.get('/__ent_auth/transit/network', async (req, res) => {
  try {
    if (!transitFeed) return res.status(404).json({ error: 'Bus network not enabled.' })
    const network = await transitFeed.getNetwork()
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.status(200).json({
      name: TRANSIT_CONFIG.name ?? network.agencyName,
      attribution: TRANSIT_CONFIG.attribution ?? null,
      timezone: network.timezone,
      validUntil: network.validUntil,
      realtime: Boolean(TRANSIT_CONFIG.realtimeUrl),
      routes: [...network.routes.values()]
        .filter((route) => network.lines.some((line) => line.routeId === route.id))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.shortName.localeCompare(right.shortName, 'fr', { numeric: true })),
      places: [...network.places.values()].map((place) => ({ ...place, routeIds: [...network.routeIdsByPlace.get(place.id)] })),
      lines: network.lines,
      campuses: TRANSIT_CONFIG.campuses ?? {},
      stopPlaces: Object.fromEntries([...network.stops.values()].map((stop) => [stop.id, stop.placeId])),
    })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// GET ?place=<placeId>&limit= → { departures, later, realtime }
//   later: when nothing leaves within 3 h, the next departure within a
//   day (the first bus of tomorrow), else null.
app.get('/__ent_auth/transit/departures', async (req, res) => {
  try {
    if (!transitFeed) return res.status(404).json({ error: 'Bus network not enabled.' })
    const [network, realtime] = await Promise.all([transitFeed.getNetwork(), transitFeed.getRealtime()])
    const place = network.places.get(String(req.query.place ?? ''))
    if (!place) return res.status(400).json({ error: 'Unknown stop.' })
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 20)
    const fromMs = Date.now()
    const departures = findDepartures(network, realtime, { stopIds: place.stopIds, fromMs, limit })
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      departures,
      later: departures.length ? null : findDepartures(network, realtime, { stopIds: place.stopIds, fromMs, limit: 1, horizonMs: 24 * 60 * 60 * 1000 })[0] ?? null,
      realtime: Boolean(realtime),
    })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// POST { queries: [{ from, to, arriveBy? | departAt? | lastOfDay?, limit? }] }
//   from/to: { placeId } | { lat, lon } | { campus: <establishment> }
//   arriveBy/departAt: epoch ms; lastOfDay: 'YYYYMMDD'
// → { results: [journeys | null], realtime }, in the order asked.
app.post('/__ent_auth/transit/plan', async (req, res) => {
  try {
    if (!transitFeed) return res.status(404).json({ error: 'Bus network not enabled.' })
    const queries = Array.isArray(req.body?.queries) ? req.body.queries : null
    if (!queries || queries.length > TRANSIT_MAX_QUERIES) return res.status(400).json({ error: `Up to ${TRANSIT_MAX_QUERIES} queries.` })
    const [network, realtime] = await Promise.all([transitFeed.getNetwork(), transitFeed.getRealtime()])
    const results = queries.map((query) => {
      const origins = resolveTransitPoint(network, query?.from)
      const destinations = resolveTransitPoint(network, query?.to)
      if (!origins || !destinations) return null
      const arriveByMs = Number.isFinite(Number(query.arriveBy)) && query.arriveBy != null ? Number(query.arriveBy) : null
      const departAtMs = Number.isFinite(Number(query.departAt)) && query.departAt != null ? Number(query.departAt) : null
      const lastOfDayKey = /^\d{8}$/.test(String(query.lastOfDay ?? '')) ? String(query.lastOfDay) : null
      if (arriveByMs == null && departAtMs == null && !lastOfDayKey) return null
      return planJourneys(network, realtime, {
        origins,
        destinations,
        arriveByMs,
        departAtMs: arriveByMs == null ? departAtMs : null,
        lastOfDayKey: arriveByMs == null && departAtMs == null ? lastOfDayKey : null,
        limit: Math.min(Math.max(Number(query.limit) || 3, 1), 5),
      })
    })
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ results, realtime: Boolean(realtime) })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// GET → { publicKey }: the VAPID key a push subscription is made with.
app.get('/__ent_auth/transit/push', async (req, res) => {
  try {
    if (!transitPush) return res.status(404).json({ error: 'Bus reminders not enabled.' })
    res.status(200).json({ publicKey: await transitPush.getPublicKey() })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// PUT { subscription, reminders } → { ok, count }: replaces the reminders
// of this subscription (an empty list removes it). Signed-in students only,
// but nothing about the student is kept.
app.put('/__ent_auth/transit/push', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    if (!transitPush) return res.status(404).json({ ok: false, error: 'Bus reminders not enabled.' })
    if (!getSessionFromRequest(req)) return res.status(401).json({ ok: false, error: 'Not signed in.' })
    const subscription = readSubscription(req.body?.subscription)
    const reminders = readReminders(req.body?.reminders, Date.now())
    if (!subscription || !reminders) return res.status(400).json({ ok: false, error: 'Invalid subscription or reminders.' })
    if (!await transitPush.setReminders(subscription, reminders)) return res.status(503).json({ ok: false, error: 'Too many subscriptions.' })
    res.status(200).json({ ok: true, count: reminders.length })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

// DELETE { endpoint } → { ok }: forgets a subscription (reminders turned off).
app.delete('/__ent_auth/transit/push', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    if (!transitPush) return res.status(404).json({ ok: false, error: 'Bus reminders not enabled.' })
    if (typeof req.body?.endpoint !== 'string') return res.status(400).json({ ok: false, error: 'Missing endpoint.' })
    await transitPush.remove(req.body.endpoint)
    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

// 6e. Application tile icons (see server/appIcons.js)
// POST { services: [{ id, title, description?, category? }] }
//   200 { ok: true, palette: { [color]: { light: { bg, fg }, dark: { bg, fg } } },
//         icons: { [id]: { icon, color } } }   icon: Iconify name in this
//         university's style; color: a key of palette (its colour mode)
//   400 { ok: false, error }   body isn't { services: [...] }
//   401 { ok: false, error }   no session
// The first pick for a service is kept for the whole university. Demo
// credentials are public, so a demo session only gets demo services written
// down (with the server's own titles); anything else it sends is answered
// without being stored.
app.post('/__ent_auth/app-icons', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

    if (!session) {
      return res.status(401).json({ ok: false, error: 'Authentication required.' })
    }

    const services = sanitizeAppIconRequest(req.body)
    if (!services) {
      return res.status(400).json({ ok: false, error: 'Expected { services: [...] }.' })
    }

    let picks
    if (isDemoSession(session)) {
      const demoServices = []
      const otherServices = []
      for (const service of services) {
        const demoService = DEMO_APP_ICON_SERVICES.get(service.id)
        if (demoService) {
          demoServices.push({ ...service, ...demoService })
        } else {
          otherServices.push(service)
        }
      }
      picks = {
        ...await appIconStore.resolve(otherServices, { remember: false }),
        ...await appIconStore.resolve(demoServices),
      }
    } else {
      picks = await appIconStore.resolve(services)
    }

    const icons = Object.fromEntries(Object.entries(picks).map(([id, { icon, color }]) => (
      [id, { icon: toIconifyName(icon, APP_ICON_THEME), color }]
    )))
    setSessionCookie(res, session)
    return res.status(200).json({ ok: true, palette: APP_ICON_THEME.palette, icons })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// ============================================================================
// CERTIFICAT DE SCOLARITÉ (MonDossierWeb)
// ============================================================================

// "Is there a certificate?" is answered from cache for a while: each check
// opens a Vaadin UI on MonDossierWeb.
const SCHOOL_CERTIFICATE_STATUS_TTL_MS = 15 * 60 * 1000
const schoolCertificateStatusCache = new Map()
// One MonDossierWeb UI at a time per session: two would share the same
// server-side Vaadin session and step on each other's sync ids.
const schoolCertificateInflight = new Map()

function withSchoolCertificateLock(session, task) {
  const previous = schoolCertificateInflight.get(session.id) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(task)
  const settled = run.catch(() => {})
  schoolCertificateInflight.set(session.id, settled)
  settled.then(() => {
    if (schoolCertificateInflight.get(session.id) === settled) {
      schoolCertificateInflight.delete(session.id)
    }
  })
  return run
}

function openSchoolCertificate(session) {
  return openCertificateDownload({
    origin: SCHOOL_CERTIFICATE_ORIGIN,
    jar: session.jar,
    menuCaption: SCHOOL_CERTIFICATE_MENU_CAPTION,
    followRedirectChain,
    fetchWithJar,
  })
}

// "2026-2027" from September, "2025-2026" until August.
function getCurrentSchoolYear(date = new Date()) {
  const start = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1
  return `${start}-${start + 1}`
}

// The real file name carries accents ("Scolarité"): plain ASCII for old
// clients, the exact name in filename*.
function buildAttachmentHeader(filename) {
  const ascii = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

// GET /__ent_auth/documents/school-certificate/status
//   200 { available: true, schoolYear: '2026-2027' } | { available: false }
//   401 no session · 404 feature off for this university
app.get('/__ent_auth/documents/school-certificate/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const session = getSessionFromRequest(req)
  if (!session) {
    return res.status(401).json({ available: false, error: 'Authentication required.' })
  }
  if (!SCHOOL_CERTIFICATE_ORIGIN) {
    return res.status(404).json({ available: false })
  }

  setSessionCookie(res, session)
  if (isDemoSession(session)) {
    return res.status(200).json({ available: true, schoolYear: getCurrentSchoolYear() })
  }

  const cached = schoolCertificateStatusCache.get(session.id)
  if (cached && Date.now() - cached.at < SCHOOL_CERTIFICATE_STATUS_TTL_MS) {
    return res.status(200).json(cached.status)
  }

  try {
    const download = await withSchoolCertificateLock(session, () => openSchoolCertificate(session))
    const status = { available: true, schoolYear: download.schoolYear }
    schoolCertificateStatusCache.set(session.id, { at: Date.now(), status })
    return res.status(200).json(status)
  } catch (error) {
    // "No certificate" is remembered; a network hiccup is retried next time.
    if (error instanceof SchoolCertificateUnavailableError) {
      schoolCertificateStatusCache.set(session.id, { at: Date.now(), status: { available: false } })
    }
    return res.status(200).json({ available: false })
  }
})

// GET /__ent_auth/documents/school-certificate
//   200 the PDF (attachment) · 401 no session · 404 none for this student
//   502 MonDossierWeb failed. Streamed through, never stored.
app.get('/__ent_auth/documents/school-certificate', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const session = getSessionFromRequest(req)
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' })
  }
  if (!SCHOOL_CERTIFICATE_ORIGIN) {
    return res.status(404).json({ ok: false, error: 'No certificate service for this university.' })
  }

  setSessionCookie(res, session)
  if (isDemoSession(session)) {
    const schoolYear = getCurrentSchoolYear()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', buildAttachmentHeader(`Certificat_de_scolarite_demo_${schoolYear}.pdf`))
    return res.status(200).send(buildDemoCertificatePdf(schoolYear))
  }

  try {
    const certificate = await withSchoolCertificateLock(session, async () => {
      const download = await openSchoolCertificate(session)
      const response = await fetchWithJar(download.url, session.jar, {
        headers: { Accept: 'application/pdf,*/*', Referer: `${SCHOOL_CERTIFICATE_ORIGIN}/` },
      })
      const body = Buffer.from(await response.arrayBuffer())
      if (!response.ok || body.subarray(0, 4).toString('latin1') !== '%PDF') {
        throw new Error(`MonDossierWeb download failed (${response.status}).`)
      }
      return { body, filename: download.filename }
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', buildAttachmentHeader(certificate.filename))
    return res.status(200).send(certificate.body)
  } catch (error) {
    const unavailable = error instanceof SchoolCertificateUnavailableError
    return res.status(unavailable ? 404 : 502).json({
      ok: false,
      error: unavailable ? 'Aucun certificat de scolarité disponible.' : 'Certificat indisponible pour le moment.',
    })
  }
})

// ============================================================================
// ADE SCHEDULE API ENDPOINTS
// ============================================================================

// 7. ADE Status
app.get('/__ent_auth/ade/status', async (req, res) => {
  try {
    if (USE_PLANNING_PORTAL_REST) {
      const entSession = getSessionFromRequest(req)
      const result = await fetchPortalStatus(entSession?.jar ?? new CookieJar())
      if (entSession) {
        setSessionCookie(res, entSession)
      }
      return res.status(200).json({
        ok: result.ok,
        status: result.status,
        data: result.data,
        api: 'portal-rest',
      })
    }

    const result = await fetchAdeApi('/timetable/getAdeStatus', null)
    res.status(200).json({ ok: result.ok, status: result.status, data: result.data })
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

// 8. ADE Calendar Metadata
app.get('/__ent_auth/ade/calendar', async (req, res) => {
  try {
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, calendar: null })

    const targetDate = typeof req.query.date === 'string' && req.query.date.trim()
      ? req.query.date.trim()
      : null
    const requestedResourceId = String(req.query.resourceId ?? '')

    if (isDemoSession(entSession)) {
      const calendar = buildDemoCalendarPayload({
        date: targetDate,
        resourceId: requestedResourceId,
      })

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        calendar,
        debug: {
          source: 'demo',
        },
      })
    }

    if (USE_PLANNING_PORTAL_REST) {
      const portalResult = await fetchPortalCalendar(entSession.jar, {
        cacheScope: getPlanningCacheScope(entSession),
      })

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: entSession.mode ?? null,
        calendar: {
          source: PLANNING_HOST,
          resourceId: requestedResourceId || null,
          targetDate,
          data: portalResult.calendar,
        },
        debug: {
          source: PLANNING_HOST,
          api: 'portal-rest',
          projectId: portalResult.projectId,
          cache: portalResult.cache,
        },
      })
    }

    const calendar = await fetchPlanningCalendarMetadataFromRpc(entSession.jar, {
      targetDate,
      resourceId: requestedResourceId,
      cacheScope: getPlanningCacheScope(entSession),
    })

    setSessionCookie(res, entSession)
    res.status(200).json({
      authenticated: true,
      sessionMode: entSession.mode ?? null,
      calendar: {
        source: PLANNING_HOST,
        resourceId: calendar.resourceId,
        currentResourceId: calendar.currentResourceId,
        requestedResourceId: calendar.requestedResourceId,
        targetDate: calendar.targetDate,
        targetDateMatched: calendar.targetDateMatched,
        outOfRange: calendar.outOfRange,
        matchedWeek: calendar.matchedWeek,
        currentWeek: calendar.currentWeek,
        firstWeek: calendar.firstWeek,
        lastWeek: calendar.lastWeek,
        weekCount: calendar.weekCount,
        weeks: calendar.weeks,
      },
      debug: {
        finalUrl: calendar.finalUrl,
        planningIdentifier: calendar.planningIdentifier,
        displayConfigurationId: calendar.displayConfigurationId,
        cache: calendar.cache,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// Group names of the student's upcoming courses on the Campus mobile API, as
// [{ name, count }] sorted by count. With no explicit resource the API answers
// for the student's own enrolment (customEtabVet). Best effort: [] on failure.
async function fetchCampusGroupHints(jar, cacheScope) {
  if (!ADE_ORIGIN || !fetchAdeUpcomingFromApi) {
    return []
  }

  try {
    const result = await fetchAdeUpcomingFromApi(jar, null, {
      date: new Date().toISOString().slice(0, 10),
      lookaheadDays: 28,
      resourceIds: [],
      cacheScope,
    })
    const counts = new Map()
    for (const event of result.allEvents ?? []) {
      for (const group of new Set(event.groups ?? [])) {
        counts.set(group, (counts.get(group) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count)
  } catch {
    return []
  }
}

// 9. ADE VET Tree
app.get('/__ent_auth/ade/tree', async (req, res) => {
  try {
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, tree: null })

    const requestedTreeId = String(req.query.etabsVets ?? '')

    if (isDemoSession(entSession)) {
      const tree = buildDemoAdeTreePayload(requestedTreeId)
      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        tree,
        debug: {
          source: 'demo',
        },
      })
    }

    if (USE_PLANNING_PORTAL_REST) {
      const cacheScope = getPlanningCacheScope(entSession)
      let tree = await fetchPortalTree(entSession.jar, {
        requestedResourceId: requestedTreeId,
        fallbackResourceId: String(req.query.fallback ?? ''),
        cacheScope,
      })
      let campusGroups = null

      // The ADE portal account has no group attached (common outside the
      // IUTs): the Campus mobile API still lists the student's courses from
      // their enrolment, with the groups of each course.
      if (!requestedTreeId && !tree.defaultSelection) {
        campusGroups = await fetchCampusGroupHints(entSession.jar, cacheScope)
        if (campusGroups.length > 0) {
          tree = await fetchPortalTree(entSession.jar, {
            cacheScope,
            groupHints: campusGroups,
          })
        }
      }

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: entSession.mode ?? null,
        tree: {
          source: PLANNING_HOST,
          root: tree.root,
          currentResourceId: tree.currentResourceId,
          focusResourceId: tree.focusResourceId,
          currentPathIds: tree.currentPathIds,
          selectionPathIds: tree.selectionPathIds,
          selectionSchema: tree.selectionSchema,
          defaultSelection: tree.defaultSelection,
        },
        debug: {
          source: PLANNING_HOST,
          api: 'portal-rest',
          projectId: tree.projectId,
          cache: tree.cache,
          authCache: tree.authCache,
          accountSource: tree.accountSource ?? null,
          campusGroups: campusGroups ? campusGroups.slice(0, 15) : null,
        },
      })
    }

    const tree = await fetchPlanningTreeFromRpc(entSession.jar, requestedTreeId, {
      cacheScope: getPlanningCacheScope(entSession),
    })

    setSessionCookie(res, entSession)
    res.status(200).json({
      authenticated: true,
      sessionMode: entSession.mode ?? null,
      tree: {
        source: PLANNING_HOST,
        root: tree.root,
        currentResourceId: tree.currentResourceId,
        focusResourceId: tree.focusResourceId,
        currentPathIds: tree.currentPathIds,
      },
      debug: {
        finalUrl: tree.finalUrl,
        planningIdentifier: tree.planningIdentifier,
        cache: tree.cache,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// 10. ADE Search
app.get('/__ent_auth/ade/search', async (req, res) => {
  try {
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, results: null })

    const query = req.query.q || ''
    if (!query.trim()) return res.status(400).json({ error: 'Query parameter "q" is required.' })

    if (isDemoSession(entSession)) {
      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        results: searchDemoAdeTree(query),
        debug: {
          source: 'demo',
        },
      })
    }

    if (USE_PLANNING_PORTAL_REST) {
      const searchResult = await searchPortalTree(entSession.jar, query, {
        cacheScope: getPlanningCacheScope(entSession),
      })

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: entSession.mode ?? null,
        results: searchResult.results,
        debug: {
          source: PLANNING_HOST,
          api: 'portal-rest',
          projectId: searchResult.projectId,
          cache: searchResult.cache,
        },
      })
    }

    const authResult = await authenticateToAde(entSession.jar, null, {
      cacheScope: getPlanningCacheScope(entSession),
    })
    const result = await fetchAdeApi(`/timetable/vetSearch?q=${encodeURIComponent(query)}`, authResult.session)

    setSessionCookie(res, entSession)
    res.status(200).json({
      authenticated: true,
      sessionMode: entSession.mode ?? null,
      results: result.data,
      debug: {
        apiStatus: result.status,
        apiOk: result.ok,
        sessionSource: entSession.sessionSource ?? null,
        ...authResult,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// 10b. ADE Teachers
app.get('/__ent_auth/ade/teachers', async (req, res) => {
  try {
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, teachers: [] })

    const query = String(req.query.q || '').trim()

    if (isDemoSession(entSession)) {
      setSessionCookie(res, entSession)
      const q = query.toLowerCase()
      const filtered = q
        ? DEMO_TEACHERS.filter((t) => t.name.toLowerCase().includes(q))
        : DEMO_TEACHERS
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        teachers: filtered,
        available: true,
      })
    }

    if (USE_PLANNING_PORTAL_REST && listPortalInstructors) {
      const result = await listPortalInstructors(entSession.jar, query, {
        cacheScope: getPlanningCacheScope(entSession),
      })
      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: entSession.mode ?? null,
        teachers: result.teachers,
        available: result.available,
      })
    }

    res.status(200).json({ authenticated: true, teachers: [], available: false })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// 10c. ADE rooms (free-room finder): every room of the "Salles" branch, with
// the folders above it (site, building) to pick a building by.
app.get('/__ent_auth/ade/rooms', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, rooms: [] })

    if (isDemoSession(entSession)) {
      setSessionCookie(res, entSession)
      return res.status(200).json({ authenticated: true, available: true, rooms: DEMO_ROOMS })
    }

    if (USE_PLANNING_PORTAL_REST && listPortalClassrooms) {
      const result = await listPortalClassrooms(entSession.jar, { cacheScope: getPlanningCacheScope(entSession) })
      setSessionCookie(res, entSession)
      return res.status(200).json({ authenticated: true, available: result.available, rooms: result.rooms })
    }

    res.status(200).json({ authenticated: true, available: false, rooms: [] })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// Rooms asked at once: a building's worth, not the whole university.
const MAX_ROOMS_PER_REQUEST = 120

// 10d. The courses held on one day in the rooms `ids` (comma-separated), to
// tell which are free.
app.get('/__ent_auth/ade/rooms/events', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, events: [] })

    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? String(req.query.date) : null
    const ids = [...new Set(String(req.query.ids ?? '').split(',').map((id) => id.trim()).filter(Boolean))]
    if (!date || !ids.length || ids.length > MAX_ROOMS_PER_REQUEST) {
      return res.status(400).json({ error: `Expected a date and 1 to ${MAX_ROOMS_PER_REQUEST} room ids.` })
    }

    if (isDemoSession(entSession)) {
      setSessionCookie(res, entSession)
      return res.status(200).json({ authenticated: true, events: buildDemoRoomEvents({ date, roomIds: ids }) })
    }

    if (!USE_PLANNING_PORTAL_REST || !ids.every((id) => /^-?\d+$/.test(id))) {
      return res.status(400).json({ error: 'Unknown rooms.' })
    }

    const result = await fetchPortalEvents(entSession.jar, {
      date,
      lookaheadDays: 1,
      resourceIds: ids,
      cacheScope: getPlanningCacheScope(entSession),
    })
    setSessionCookie(res, entSession)
    res.status(200).json({ authenticated: true, events: result.events })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// 11. ADE Timetable
app.get('/__ent_auth/ade/timetable', async (req, res) => {
  try {
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, timetable: null })

    const requestedDate = String(req.query.date ?? new Date().toISOString().slice(0, 10))
    const requestedResourceId = String(req.query.resourceId ?? '')

    if (isDemoSession(entSession)) {
      const timetable = buildDemoTimetablePayload({
        date: requestedDate,
        resourceId: requestedResourceId,
      })

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        timetable,
        debug: {
          source: 'demo',
        },
      })
    }

    if (USE_PLANNING_PORTAL_REST) {
      const week = getPortalWeekRange(requestedDate)
      const portalResult = await fetchPortalEvents(entSession.jar, {
        date: week.start,
        lookaheadDays: 7,
        resourceIds: requestedResourceId ? [requestedResourceId] : [],
        cacheScope: getPlanningCacheScope(entSession),
      })

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: entSession.mode ?? null,
        timetable: {
          source: PLANNING_HOST,
          date: requestedDate,
          resourceId: portalResult.resourceIds[0] ?? (requestedResourceId || null),
          weekLabel: week.label,
          resolvedWeek: week,
          outOfRange: false,
          dayLabels: week.dayLabels,
          events: portalResult.events,
        },
        debug: {
          source: PLANNING_HOST,
          api: 'portal-rest',
          projectId: portalResult.projectId,
          resourceIds: portalResult.resourceIds,
          cache: portalResult.cache,
        },
      })
    }

    const timetable = await fetchPlanningTimetableFromRpc(entSession.jar, requestedDate, requestedResourceId, {
      cacheScope: getPlanningCacheScope(entSession),
    })

    setSessionCookie(res, entSession)
    res.status(200).json({
      authenticated: true,
      sessionMode: entSession.mode ?? null,
      timetable: {
        source: PLANNING_HOST,
        date: requestedDate,
        resourceId: timetable.resourceId,
        weekLabel: timetable.weekLabel,
        resolvedWeek: timetable.resolvedWeek,
        outOfRange: timetable.outOfRange,
        dayLabels: timetable.dayLabels,
        events: timetable.events,
      },
      debug: {
        finalUrl: timetable.finalUrl,
        planningIdentifier: timetable.planningIdentifier,
        resourceId: timetable.resourceId,
        currentResourceId: timetable.currentResourceId,
        displayConfigurationId: timetable.displayConfigurationId,
        weekIndex: timetable.weekIndex,
        calendarWeekIndex: timetable.calendarWeekIndex,
        requestedDateMatched: timetable.requestedDateMatched,
        outOfRange: timetable.outOfRange,
        cache: timetable.cache,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// 12. ADE Upcoming Courses
app.post('/__ent_auth/ade/upcoming', async (req, res) => {
  try {
    const entSession = getSessionFromRequest(req)
    if (!entSession) {
      return res.status(200).json({
        authenticated: false,
        upcoming: null,
      })
    }

    const requestedDate = typeof req.body?.date === 'string' && req.body.date.trim()
      ? req.body.date.trim()
      : new Date().toISOString().slice(0, 10)
    // Upper bound matches the largest step offered by the account-modal
    // lookahead slider (ADE_LOOKAHEAD_DAY_OPTIONS in src/profileStorage.js).
    const lookaheadDays = Math.max(
      1,
      Math.min(60, Number.parseInt(String(req.body?.lookaheadDays ?? '21'), 10) || 21),
    )
    const selection = req.body?.selection && typeof req.body.selection === 'object'
      ? req.body.selection
      : null

    if (isDemoSession(entSession)) {
      const upcoming = buildDemoUpcomingPayload({
        date: requestedDate,
        lookaheadDays,
        selection,
      })

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        upcoming,
        debug: {
          source: 'demo',
        },
      })
    }

    const resourceIds = getAdeSelectionResourceIds(selection)
    const selectionLabels = getAdeSelectionLabels(selection)

    if (USE_PLANNING_PORTAL_REST) {
      const portalResult = await fetchPortalEvents(entSession.jar, {
        date: requestedDate,
        lookaheadDays,
        resourceIds,
        cacheScope: getPlanningCacheScope(entSession),
      })
      const nextEvent = portalResult.events.find((event) => {
        const endTime = Number.isFinite(event?.endMs) ? event.endMs : Date.parse(event?.end)
        return Number.isFinite(endTime) && endTime > Date.now()
      }) ?? null

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: entSession.mode ?? null,
        upcoming: {
          source: PLANNING_HOST,
          date: requestedDate,
          lookaheadDays,
          complete: portalResult.complete,
          resourceIds: portalResult.resourceIds,
          selectionLabels,
          events: portalResult.events,
          nextEvent,
        },
        debug: {
          source: PLANNING_HOST,
          api: 'portal-rest',
          projectId: portalResult.projectId,
          cache: portalResult.cache,
        },
      })
    }

    // No credentials: the ADE mobile API is reached through the CAS with the TGC.
    const upcoming = await resolveAdeUpcoming(entSession.jar, null, {
      date: requestedDate,
      lookaheadDays,
      resourceIds,
      selectionLabels,
      cacheScope: getPlanningCacheScope(entSession),
    })

    setSessionCookie(res, entSession)
    res.status(200).json({
      authenticated: true,
      sessionMode: entSession.mode ?? null,
      upcoming: {
        source: upcoming.source,
        date: requestedDate,
        lookaheadDays,
        complete: upcoming.complete,
        resourceIds: upcoming.resourceIds,
        selectionLabels: upcoming.selectionLabels,
        events: upcoming.events,
        nextEvent: upcoming.nextEvent,
      },
      debug: {
        apiStatus: upcoming.apiStatus,
        authMode: upcoming.authMode,
        cache: upcoming.cache,
        sessionCache: upcoming.sessionCache,
        fallback: upcoming.fallback,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// 13. ADE Global Alerts
app.get('/__ent_auth/ade/alerts', async (req, res) => {
  try {
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, alerts: null })

    if (isDemoSession(entSession)) {
      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        alerts: buildDemoAlertsPayload(),
        debug: {
          source: 'demo',
        },
      })
    }

    if (USE_PLANNING_PORTAL_REST) {
      const portalResult = await fetchPortalCalendar(entSession.jar, {
        cacheScope: getPlanningCacheScope(entSession),
      })
      const calendar = portalResult.calendar
      const alerts = Array.isArray(calendar?.alerts)
        ? calendar.alerts
        : Array.isArray(calendar?.messages)
          ? calendar.messages
          : []

      setSessionCookie(res, entSession)
      return res.status(200).json({
        authenticated: true,
        sessionMode: entSession.mode ?? null,
        alerts,
        debug: {
          source: PLANNING_HOST,
          api: 'portal-rest',
          projectId: portalResult.projectId,
          cache: portalResult.cache,
        },
      })
    }

    const authResult = await authenticateToAde(entSession.jar, null, {
      cacheScope: getPlanningCacheScope(entSession),
    })
    const etabsVets = req.query.etabsVets || ''
    const apiPath = etabsVets
      ? `/timetable/getADEGlobalAlerts?etabsVets=${encodeURIComponent(etabsVets)}`
      : '/timetable/getADEGlobalAlerts'
    const result = await fetchAdeApi(apiPath, authResult.session)

    setSessionCookie(res, entSession)
    res.status(200).json({ authenticated: true, sessionMode: entSession.mode ?? null, alerts: result.data, debug: { apiStatus: result.status, apiOk: result.ok, ...authResult } })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// 14. Logout Endpoint — also ends the CAS single sign-on session (best effort,
// short timeout) so the TGC that travelled in the cookie is dead upstream.
app.post('/__ent_auth/logout', async (req, res) => {
  const session = getSessionFromRequest(req)
  if (session?.id) {
    dropRuntimeSession(session.id)
    clearSensitiveSessionCaches(session)

    if (!isDemoSession(session)) {
      await terminateCasSession(session.jar)
    }
  }

  clearSessionCookies(res)
  res.status(200).json({
    authenticated: false,
  })
})

app.all('/__ent_auth/demo/request', express.text({ type: '*/*' }), (req, res) => {
  const session = getSessionFromRequest(req)

  if (!isDemoSession(session)) {
    return res.status(403).json({
      error: 'Demo session required.',
    })
  }

  const requestPath = String(req.query.path ?? '').trim()
  const payload = buildDemoRequestPayload(requestPath, session)

  setSessionCookie(res, session)
  res.status(payload.status)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', payload.contentType)
  return res.send(payload.body)
})

// ============================================================================
// PROXY MIDDLEWARE
// ============================================================================
app.use('/__ent_proxy', createProxyMiddleware({
  target: ENT_ORIGIN,
  changeOrigin: true,
  secure: true,
  pathRewrite: { '^/__ent_proxy': '' },
  on: {
    proxyReq: (proxyReq, req) => {
      const manualCookie = req.headers['x-ent-cookie']
      if (typeof manualCookie === 'string' && manualCookie.trim()) {
        proxyReq.setHeader('cookie', manualCookie.trim())
      } else {
        const session = getSessionFromRequest(req)
        if (session) {
          const targetUrl = buildEntProxyTargetUrl(req.url)
          const cookieHeader = session.jar.getCookieHeader(targetUrl)
          if (cookieHeader) {
            proxyReq.setHeader('cookie', cookieHeader)
          }
        }
      }

      const manualReferer = req.headers['x-ent-referer']
      if (typeof manualReferer === 'string' && manualReferer.trim()) {
        proxyReq.setHeader('referer', manualReferer.trim())
      } else {
        proxyReq.setHeader('referer', DEFAULT_REFERER)
      }

      const extraHeaders = req.headers['x-ent-extra-headers']
      if (typeof extraHeaders === 'string' && extraHeaders.trim()) {
        try {
          const parsedHeaders = JSON.parse(extraHeaders)
          for (const [name, value] of Object.entries(parsedHeaders)) {
            if (value !== undefined && value !== null && value !== '') {
              proxyReq.setHeader(name, String(value))
            }
          }
        } catch {
          proxyReq.setHeader('x-ent-extra-headers-error', 'invalid-json')
        }
      }

      proxyReq.removeHeader('x-ent-cookie')
      proxyReq.removeHeader('x-ent-referer')
      proxyReq.removeHeader('x-ent-extra-headers')
    },
    proxyRes: (proxyRes, req, res) => {
      const session = getSessionFromRequest(req)
      if (session) {
        const targetUrl = buildEntProxyTargetUrl(req.url)
        session.jar.setFromProxySetCookie(proxyRes.headers['set-cookie'], targetUrl)
        setSessionCookie(res, session)
      }

      delete proxyRes.headers['set-cookie']
    }
  }
}))

return app
}
