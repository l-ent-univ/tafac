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
import express from 'express'
import cookieParser from 'cookie-parser'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
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
  getSessionUniversityId,
  isSessionDataExpired,
  readSessionCookies,
  resolveSessionSecrets,
  unpackJarCookies,
} from './sessionCookie.js'
import { createLaunchTargetPolicy } from './launchTargets.js'
import {
  buildMailMessage,
  getMailPartDisposition,
  isValidDemoMailMessageId,
  isValidMailMessageId,
  isValidMailPartId,
  mailTextToHtml,
  readContentDispositionFilename,
} from './mailMessage.js'
import { isEmptiableMailFolder, normalizeZimbraFolderTree, parseZimbraMarkReadPref } from './mailFolders.js'
import { buildZimbraAutoCompleteRequest, normalizeZimbraAutoComplete, searchDemoMailContacts } from './mailAutocomplete.js'
import {
  UploadIdleError,
  UploadTooLargeError,
  createUploadByteCounter,
  createUploadLimiter,
  readContentLength,
  sendToZimbraUpload,
} from './mailUpload.js'
import { createPlanningPortalApiClient } from '../planningPortalApi.js'
import {
  buildDrupalLayout,
  isDrupalSignedInPage,
  parseDrupalProfileName,
  parseDrupalToolCatalogue,
  resolvePortalKind,
} from './portalSession.js'
import { SchoolCertificateUnavailableError, buildDemoCertificatePdf, openCertificateDownload } from './schoolCertificate.js'
import { createPlanningRpcClient } from '../planningRpc.js'
import { createTempoApiClient } from '../tempoApi.js'
import {
  DEMO_ACCOUNT,
  DEMO_GRADES_DEPARTMENT_MESSAGE,
  DEMO_SESSION_MODE,
  applyDemoLayoutMutation,
  buildDemoAdeTreePayload,
  buildDemoAlertsPayload,
  buildDemoCalendarPayload,
  buildDemoEvaluationDistribution,
  buildDemoGradesPayload,
  buildDemoLayoutData,
  buildDemoLayoutDocData,
  buildDemoMailPayload,
  buildDemoMarketplaceEntries,
  buildDemoMoodleDeadlinesPayload,
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
import { buildZimbraSearchQuery, foldMailSearchText, parseMailSearchWords } from '../src/mailSearch.js'
import { RECIPIENT_QUERY_MIN_LENGTH, normalizeRecipientQuery } from '../src/mailCompose.js'
import { HARD_ATTACHMENT_LIMIT_BYTES, deriveAttachmentLimits, normalizeAttachmentType, sanitizeAttachmentName } from '../src/mailAttachments.js'

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
// options.session: { secret, previousSecrets, production, legacyUniversityId }
// — defaults to SESSION_SECRET / SESSION_SECRET_PREVIOUS and NODE_ENV ===
// 'production'. legacyUniversityId (an id, or a function of the request) is
// the university of a session cookie issued before sessions carried one;
// defaults to this university.
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
// The mail page's endless list asks for the next page by offset, up to this.
const MAIL_MAX_OFFSET = 5000
// The reader: each body part is cut past this (Zimbra's GetMsg `max`), and
// an attachment over this isn't relayed.
const MAIL_MESSAGE_MAX_BYTES = 1_000_000
const MAIL_PART_MAX_BYTES = 50 * 1024 * 1024
// Every request to the webmail has a deadline: a Partage that hangs must not
// pile up open requests (and students waiting) behind it. Each step of the
// webmail sign-in, each SOAP or REST call: the whole answer within this.
const ZIMBRA_REQUEST_TIMEOUT_MS = 15_000
// A part (attachment, inline image) streams for as long as it takes, but its
// headers come within ZIMBRA_REQUEST_TIMEOUT_MS and then no gap between two
// chunks may pass this (a stalled upstream, or a client gone quiet: the pipe
// waits on it).
const MAIL_PART_IDLE_TIMEOUT_MS = 60_000
// Ending the webmail session at logout: best effort, never a long wait.
const ZIMBRA_LOGOUT_TIMEOUT_MS = 4000
// Mail routes, per session: a token bucket. All students reach Partage from
// this server's one address, so one session hammering the routes (a script,
// a stuck loop) could get that address throttled for everyone. Normal use
// stays far below: the 45 s check of the inbox, a thread and its bodies on
// each opening, a row's hover prefetch (the thread list only), a mail's
// inline images (one request each), marking read. 60 in a burst covers an
// image-heavy mail opened right after another; 5 a second sustained is
// several openings a second. Past it: 429 with Retry-After, which the page
// takes as any failure (its list stays, « Réessayer » in the reader).
const MAIL_RATE_LIMIT_BURST = 60
const MAIL_RATE_LIMIT_PER_SECOND = 5
// The composer's uploads (POST /__ent_auth/mail/upload), per session, apart
// from the bucket above (an upload is one request however long it runs):
// a few files picked at once, a mail's worth of them several times over in
// an hour, MAIL_UPLOAD_CONCURRENT streams open at once (the page sends two).
const MAIL_UPLOAD_PER_MINUTE = 20
const MAIL_UPLOAD_BYTES_PER_HOUR = 300 * 1024 * 1024
const MAIL_UPLOAD_CONCURRENT = 3
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
// planning.api: 'portal-rest' (ADE's REST portal, planningPortalApi.js) and
// 'tempo' (tempoApi.js) are both clients with the portal interface, served
// by the same routes; without one, the GWT planning (planningRpc.js).
const PLANNING_API = universityConfig.planning?.api ?? null
const USE_PLANNING_PORTAL_REST = PLANNING_API === 'portal-rest' || PLANNING_API === 'tempo'

const PORTAL_ENTRY_URL = `${ENT_ORIGIN}${universityConfig.auth.portalEntryPath}`
// Portal software behind ENT_ORIGIN (server/portalSession.js): only uPortal
// has the layout and userinfo APIs.
const PORTAL_KIND = resolvePortalKind(universityConfig.auth)
// Drupal portal: page listing the tools, read for the applications grid.
const PORTAL_CATALOG_URL = universityConfig.catalog?.path ? `${ENT_ORIGIN}${universityConfig.catalog.path}` : null
// Moodle signs in either through its own CAS login (moodle.casLoginPath,
// Rennes 2: '/login/index.php?authCAS=CAS', which goes straight to the CAS
// and back with a ticket) or through Shibboleth (the default).
const MOODLE_CAS_LOGIN_URL = MOODLE_ORIGIN && universityConfig.moodle?.casLoginPath
  ? `${MOODLE_ORIGIN}${universityConfig.moodle.casLoginPath}`
  : null
const MOODLE_SHIBBOLETH_LOGIN_URL = MOODLE_ORIGIN && !MOODLE_CAS_LOGIN_URL
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

// Targets the launch relay may fetch with the session jar and send the
// browser to: this university's services only (server/launchTargets.js).
const launchTargets = createLaunchTargetPolicy(universityConfig)

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
// Every session says which university it belongs to (`uni` in the payload);
// this app only accepts its own, so one university's session never reaches
// another one's services.
const UNIVERSITY_ID = universityConfig.id
const legacySessionUniversity = options.session?.legacyUniversityId ?? UNIVERSITY_ID
function getLegacySessionUniversityId(req) {
  return typeof legacySessionUniversity === 'function' ? legacySessionUniversity(req) : legacySessionUniversity
}
// In-memory sessions (full jar, caches) are dropped after this much idle time;
// the cookie rebuilds them on the next request. The cookie itself follows the
// rolling/absolute lifetimes in server/sessionCookie.js.
const RUNTIME_SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000
const GRADES_CACHE_TTL_MS = 10 * 60 * 1000
const MAIL_CACHE_TTL_MS = 2 * 60 * 1000
const MOODLE_DEADLINES_CACHE_TTL_MS = 5 * 60 * 1000
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
// The account's mail address read from the webmail, by session (or null when
// it couldn't be read), for portals that don't give it (Drupal).
const runtimeMailAddresses = new Map()
// sessionId → { cachedAt, data }: short-lived Moodle deadlines snapshot.
const runtimeMoodleDeadlinesCache = new Map()
// sessionId → { createdAt, jar, sesskey }: signed-in Moodle context, runtime-only
// for the same reason as runtimeMailContexts.
const runtimeMoodleContexts = new Map()
const loginRateLimitByIp = new Map()
const loginRateLimitByUsername = new Map()
// sessionId → { tokens, updatedAt }: the mail routes' token buckets
// (takeMailRateLimitToken).
const mailRateLimitBuckets = new Map()
let mailRateLimitPrunedAt = 0
// The uploads' own limits (MAIL_UPLOAD_*, createUploadLimiter).
const mailUploadLimiter = createUploadLimiter({
  perMinute: MAIL_UPLOAD_PER_MINUTE,
  bytesPerHour: MAIL_UPLOAD_BYTES_PER_HOUR,
  concurrent: MAIL_UPLOAD_CONCURRENT,
})

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
  runtimeMailAddresses.delete(sessionId)
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

function getCachedGrades(sessionId) {
  if (!sessionId) {
    return null
  }

  pruneRuntimeGradesCache()
  return runtimeGradesCache.get(sessionId)?.data ?? null
}

function setCachedGrades(sessionId, grades) {
  if (!sessionId) {
    return
  }

  pruneRuntimeGradesCache()
  runtimeGradesCache.set(sessionId, {
    cachedAt: Date.now(),
    data: grades,
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

function clearMoodleCaches(sessionId) {
  if (!sessionId) {
    return
  }

  runtimeMoodleDeadlinesCache.delete(sessionId)
  runtimeMoodleContexts.delete(sessionId)
}

function setSessionCookie(res, session) {
  pruneRuntimeSessions()
  session.lastSeenAt = Date.now()
  runtimeSessions.set(session.id, session)

  const { payload, dropped } = fitSessionPayload({
    data: {
      id: session.id,
      uni: UNIVERSITY_ID,
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

// Keep one User-Agent for every CAS request of a session: the Rennes 2 CAS
// binds the TGC to it and deletes the TGC when another one shows it.
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

  const portal = await fetchPortalSession(jar)

  if (!portal.authenticated) {
    throw new Error('CAS login completed, but the portal session was not established.')
  }

  return {
    jar,
    // A portal without its own user id (Drupal) keys the profile on the login.
    user: portal.user ?? normalizeLoginIdentifier(username),
    redirectChain: [...loginPageResult.chain, ...portalRedirectResult.chain],
  }
}

function isAuthenticatedLayout(layout) {
  return Boolean(layout?.ok && layout.data && String(layout.data.authenticated) === 'true')
}

// Signed-in state of the portal session held by the jar: { authenticated,
// user }, `user` being the portal's own user id, or null when it has none.
async function fetchPortalSession(jar) {
  if (PORTAL_KIND === 'drupal') {
    const response = await fetchWithJar(PORTAL_ENTRY_URL, jar, {
      headers: { Accept: HTML_ACCEPT_HEADER },
    })
    const html = await response.text()
    return { authenticated: isDrupalSignedInPage(response.status, html), user: null }
  }

  const layout = await fetchEntLayout(jar)
  return { authenticated: isAuthenticatedLayout(layout), user: layout.data?.user ?? null }
}

// Silent re-login: when the portal session lapsed (idle timeout, server
// restart) but the jar still holds the CAS TGC, replay the login-time entry
// (portal → CAS → portal with a service ticket) without any credentials. The
// stale portal cookies are dropped first so the entry behaves exactly as at
// login. Resolves to the signed-in portal session (fetchPortalSession), or
// null when the CAS no longer honors the TGC (TGT expired, or killed by a
// logout).
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

  const portal = await fetchPortalSession(session.jar)
  return portal.authenticated ? portal : null
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
  return readSessionCookies(req.cookies, { codec: sessionCodec, cookieName: SESSION_COOKIE_NAME })
}

function getSessionFromRequest(req) {
  pruneRuntimeSessions()

  const decoded = readSessionCookie(req)
  const data = decoded?.data
  if (!data || typeof data.id !== 'string' || !data.id || isSessionDataExpired(data)) {
    return null
  }

  // Another university's session: not signed in here.
  if (getSessionUniversityId(data, getLegacySessionUniversityId(req)) !== UNIVERSITY_ID) {
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

  // Not one of this university's services: the browser opens it itself.
  if (!launchTargets.isAllowed(targetUrl)) {
    return {
      finalUrl: targetUrl,
      chain: [],
      useServerLaunch: false,
      reason: 'target-not-allowed',
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
        reason: MOODLE_CAS_LOGIN_URL ? 'moodle-cas-relay' : 'server-saml-relay',
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

        // The chain leaves the university's services: the browser follows it.
        if (!launchTargets.isAllowed(nextUrl)) {
          return {
            finalUrl: targetUrl,
            chain,
            useServerLaunch: false,
            reason: 'direct-browser-launch',
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

        if (!launchTargets.isAllowed(htmlRedirect)) {
          return {
            finalUrl: targetUrl,
            chain,
            useServerLaunch: false,
            reason: 'direct-browser-launch',
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

// One mail request for this session: 0 when it may go, otherwise the
// seconds until a token is back (Retry-After). A bucket refills to full in
// BURST / PER_SECOND seconds; one idle longer is the same as none, so those
// are dropped (looked over once a minute at most).
function takeMailRateLimitToken(sessionId, now = Date.now()) {
  const fullAfterMs = (MAIL_RATE_LIMIT_BURST / MAIL_RATE_LIMIT_PER_SECOND) * 1000
  if (now - mailRateLimitPrunedAt > 60_000) {
    mailRateLimitPrunedAt = now
    for (const [key, entry] of mailRateLimitBuckets) {
      if (now - entry.updatedAt > fullAfterMs) mailRateLimitBuckets.delete(key)
    }
  }
  const entry = mailRateLimitBuckets.get(sessionId)
  const tokens = entry
    ? Math.min(MAIL_RATE_LIMIT_BURST, entry.tokens + ((now - entry.updatedAt) / 1000) * MAIL_RATE_LIMIT_PER_SECOND)
    : MAIL_RATE_LIMIT_BURST
  if (tokens < 1) {
    mailRateLimitBuckets.set(sessionId, { tokens, updatedAt: now })
    return Math.max(1, Math.ceil((1 - tokens) / MAIL_RATE_LIMIT_PER_SECOND))
  }
  mailRateLimitBuckets.set(sessionId, { tokens: tokens - 1, updatedAt: now })
  return 0
}

function getActiveLoginRateLimit(req, username) {
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

const portalClient = PLANNING_API === 'tempo'
  ? createTempoApiClient({
      casOrigin: CAS_ORIGIN,
      tempoOrigin: PLANNING_ORIGIN,
      timeZone: universityConfig.planning?.timeZone,
      fetchWithJar,
    })
  : PLANNING_API === 'portal-rest'
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

// 6j. A file for the composer (src/components/MailComposer.jsx), relayed to
// Partage's upload servlet as it comes: the request's body is piped into the
// upstream request, never written to disk nor held whole in memory, and
// Partage's answer is cut down to { aid, name, size, contentType } (its
// attachment id, which a send will one day name in SendMsgRequest's
// <attach aid>). The file is the raw body: Content-Type its type,
// Content-Disposition its name (RFC 5987), Content-Length required.
//
// Registered before express.json(), which would otherwise read (and buffer)
// a file sent as application/json, and apart from the mail routes' reading
// bucket: the uploads have their own limits (mailUploadLimiter), so the
// feature gate is checked here too. Refused before a byte of the body is
// read: past one file's limit (the account's, from GetInfo's attSizeLimit,
// deriveAttachmentLimits), cross-site, without a session, too many. Then
// the bytes are counted as they pass (never more than declared), and a
// client gone quiet for MAIL_PART_IDLE_TIMEOUT_MS ends it. Neither the file
// nor its name is ever logged. A demo session's file is read and dropped:
// the same checks, a made-up aid.
//   200 { attachment: { aid, name, size, contentType } },
//   400 empty, 401 no session, 403 cross-site, 404 no mail, 408 idle,
//   411 no length, 413 { error, maxBytes } too large, 429 too many
//   (Retry-After), 502 { error: 'mail_upload_retry' } Partage refused the
//   session (signed in again on the next try), 500 { error } otherwise.
app.post('/__ent_auth/mail/upload', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  // An answer before the body is read closes the connection: Node would
  // otherwise read the rest of the body to discard it, the very traffic
  // the refusal is there to spare.
  const refuse = (status, error, extra = null) => {
    res.setHeader('Connection', 'close')
    return res.status(status).json({ error, ...extra })
  }
  if (!FEATURES.mail) {
    res.setHeader('Connection', 'close')
    return res.status(404).json({ ok: false, disabled: true, feature: 'mail' })
  }
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin') return refuse(403, 'Cross-site request.')
  const session = getSessionFromRequest(req)
  if (!session) return refuse(401, 'Authentication required.')
  const demo = isDemoSession(session)
  if (!demo && MAIL_PROVIDER !== 'zimbra') return refuse(404, 'Upload unavailable.')
  const length = req.headers['transfer-encoding'] ? null : readContentLength(req.headers['content-length'])
  if (length === null) return refuse(411, 'mail_upload_length_required')
  if (length === 0) return refuse(400, 'mail_upload_empty')
  if (length > HARD_ATTACHMENT_LIMIT_BYTES) return refuse(413, 'mail_upload_too_large', { maxBytes: HARD_ATTACHMENT_LIMIT_BYTES })

  const slot = mailUploadLimiter.take(session.id, length)
  if (!slot.ok) {
    res.setHeader('Retry-After', String(slot.retryAfter))
    return refuse(429, 'mail_upload_rate_limited')
  }
  const name = sanitizeAttachmentName(readContentDispositionFilename(req.headers['content-disposition']))
  const contentType = normalizeAttachmentType(req.headers['content-type'])

  // The upstream request's end: a client gone quiet (no chunk for
  // MAIL_PART_IDLE_TIMEOUT_MS), Partage slow to answer once the file is in
  // (ZIMBRA_REQUEST_TIMEOUT_MS), the student's side closed (the upload
  // cancelled, the composer closed, the tab gone).
  const controller = new AbortController()
  let deadline = null
  let received = 0
  const abortAfter = (ms, error) => {
    clearTimeout(deadline)
    deadline = setTimeout(() => controller.abort(error), ms)
  }
  res.on('close', () => {
    clearTimeout(deadline)
    slot.settle(received)
    if (!res.writableFinished) controller.abort()
  })
  const countedBody = (maxBytes) => Readable.toWeb(req).pipeThrough(createUploadByteCounter(maxBytes, (total) => {
    received = total
    abortAfter(total < length ? MAIL_PART_IDLE_TIMEOUT_MS : ZIMBRA_REQUEST_TIMEOUT_MS, total < length
      ? new UploadIdleError('Upload went idle.')
      : new Error('Zimbra upload timed out.'))
  }))

  try {
    if (demo) {
      const limits = deriveAttachmentLimits(null)
      if (length > limits.maxFileBytes) {
        slot.settle(0)
        return refuse(413, 'mail_upload_too_large', { maxBytes: limits.maxFileBytes })
      }
      abortAfter(MAIL_PART_IDLE_TIMEOUT_MS, new UploadIdleError('Upload went idle.'))
      const reader = countedBody(length).getReader()
      controller.signal.addEventListener('abort', () => reader.cancel().catch(() => {}), { once: true })
      while (!(await reader.read()).done) {
        // Read and dropped.
      }
      clearTimeout(deadline)
      if (controller.signal.aborted) throw controller.signal.reason ?? new UploadIdleError('Upload ended early.')
      setSessionCookie(res, session)
      return res.status(200).json({ attachment: { aid: `demo-upload-${randomUUID()}`, name, size: received, contentType } })
    }

    // The account's limit (one GetInfo per webmail sign-in, often read
    // already by /mail/prefs), and a context known to work: signing in
    // again is only possible before the body starts going.
    const { context, limits } = await withZimbraContext(session, async (current) => ({
      context: current,
      limits: await readZimbraAttachmentLimits(current),
    }))
    if (length > limits.maxFileBytes) {
      slot.settle(0)
      return refuse(413, 'mail_upload_too_large', { maxBytes: limits.maxFileBytes })
    }

    abortAfter(MAIL_PART_IDLE_TIMEOUT_MS, new UploadIdleError('Upload went idle.'))
    const { httpStatus, parsed } = await sendToZimbraUpload({
      send: (url, init) => fetchWithJar(url, context.jar, init),
      origin: context.origin,
      csrfToken: context.csrfToken,
      body: countedBody(length),
      length,
      name,
      contentType,
      signal: controller.signal,
    })
    clearTimeout(deadline)
    // Partage (or a proxy before it) may answer before it has the whole
    // file: whatever the page still sends isn't read on a failure.
    if (httpStatus !== 200 || parsed?.status !== 200) res.setHeader('Connection', 'close')
    if (httpStatus === 401 || httpStatus === 403 || isRedirectStatus(httpStatus) || parsed?.status === 401) {
      // A lapsed webmail session (or a CSRF refusal): signed in again on the
      // page's next try. The body is gone, so not retried here.
      runtimeMailContexts.delete(session.id)
      console.error(`[mail] upload failed: Zimbra rejected the session (HTTP ${httpStatus}, ${parsed?.status ?? 'no status'}${context.csrfToken ? '' : ', no CSRF token'})`)
      return res.status(502).json({ error: 'mail_upload_retry' })
    }
    if (parsed?.status === 413) return res.status(413).json({ error: 'mail_upload_too_large', maxBytes: limits.maxFileBytes })
    if (httpStatus < 200 || httpStatus > 299 || parsed?.status !== 200 || parsed.uploads.length !== 1) {
      throw new Error(`Zimbra upload failed (HTTP ${httpStatus}, ${parsed ? `status ${parsed.status}` : 'unreadable answer'}).`)
    }
    const [upload] = parsed.uploads
    setSessionCookie(res, session)
    return res.status(200).json({
      attachment: { aid: upload.aid, name, size: upload.size ?? received, contentType: upload.contentType || contentType },
    })
  } catch (error) {
    clearTimeout(deadline)
    if (res.writableEnded || res.destroyed) return undefined
    const reason = controller.signal.aborted ? controller.signal.reason : null
    const cause = [error, error?.cause, reason]
    if (!res.headersSent) res.setHeader('Connection', 'close')
    if (cause.some((entry) => entry instanceof UploadTooLargeError)) return res.status(413).json({ error: 'mail_upload_too_large' })
    if (cause.some((entry) => entry instanceof UploadIdleError)) return res.status(408).json({ error: 'mail_upload_idle' })
    return sendMailRouteError(res, 'upload', error)
  }
})

app.use('/__ent_auth', express.json()) // Automatically parse incoming JSON requests for auth endpoints

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

// The mail routes' limit, per session (MAIL_RATE_LIMIT_*). Keyed by the
// session cookie's id; a request without one goes on to its route's 401,
// which reaches nothing upstream.
app.use('/__ent_auth/mail', (req, res, next) => {
  const sessionId = readSessionCookie(req)?.data?.id
  if (typeof sessionId !== 'string' || !sessionId) return next()
  const retryAfterSeconds = takeMailRateLimitToken(sessionId)
  if (!retryAfterSeconds) return next()
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Retry-After', String(retryAfterSeconds))
  return res.status(429).json({ error: 'mail_rate_limited' })
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
        university: UNIVERSITY_ID,
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
        university: UNIVERSITY_ID,
      })
    }

    let portal = await fetchPortalSession(session.jar)

    // Portal session lapsed: sign in again silently with the CAS TGC.
    if (!portal.authenticated) {
      portal = await reestablishEntSessionOnce(session)
    }

    if (!portal) {
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
        university: UNIVERSITY_ID,
      })
    }

    session.user = portal.user ?? session.user
    setSessionCookie(res, session)
    const launchCapabilities = getSessionLaunchCapabilities(session)

    res.status(200).json({
      authenticated: true,
      user: session.user,
      sessionMode: session.mode ?? null,
      sessionSource: session.sessionSource ?? null,
      cookieNames: session.jar.getCookieNamesForHost(ENT_HOST),
      casCookieNames: session.jar.getCookieNamesForHost(CAS_HOST),
      ...launchCapabilities,
      analyticsEnabled: analytics.enabled,
        university: UNIVERSITY_ID,
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
        university: UNIVERSITY_ID,
      })
    }

    const result = await performEntLogin({ username, password })
    clearLoginRateLimit(req, username)
    // The password lives only in this request: the session keeps the CAS TGC,
    // which signs in to every service (ENT, ADE, Moodle, webmail…) on its own.
    const session = {
      id: randomUUID(),
      user: result.user,
      jar: result.jar,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }

    // Prime the ADE session cache while the credentials are still in hand
    // (later refreshes go through the CAS with the TGC).
    if (FEATURES.ade && ADE_ORIGIN) {
      try {
        await authenticateToAde(result.jar, { username, password }, {
          cacheScope: getPlanningCacheScope(session),
        })
      } catch (adeError) {
        console.warn('ADE session bootstrap failed during login:', adeError)
      }
    }

    setSessionCookie(res, session)

    res.status(200).json({
      authenticated: true,
      user: result.user,
      sessionMode: session.mode ?? null,
      university: UNIVERSITY_ID,
    })
  } catch (error) {
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

    // Drupal has no userinfo API: the name comes from the profile page.
    if (PORTAL_KIND === 'drupal') {
      const profile = await followRedirectChain(`${ENT_ORIGIN}/user`, session.jar, {
        headers: { Accept: HTML_ACCEPT_HEADER },
      })
      const html = await profile.response.text()
      const signedIn = getHostnameFromUrl(profile.finalUrl) === ENT_HOST && isDrupalSignedInPage(profile.response.status, html)
      // The portal has no address: the webmail's (Partage), when there is one.
      const email = signedIn ? await fetchMailAddress(session) : null
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        account: signedIn ? { ...parseDrupalProfileName(html), email } : null,
        sessionMode: session.mode ?? null,
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
          api: PLANNING_API,
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

  // Only this university's services, never an arbitrary address: no open
  // redirect from our domain, no server-side fetch of anything else.
  if (typeof targetUrl !== 'string' || !launchTargets.isAllowed(targetUrl)) {
    return res.redirect('/')
  }

  const session = getSessionFromRequest(req)
  if (!session) {
    return res.redirect(targetUrl)
  }

  // Moodle behind its CAS login: the plain CAS relay below, started from that
  // login (an activity page would answer Moodle's multi-login page, not the
  // CAS), so the student lands on Moodle signed in.
  const relayUrl = MOODLE_CAS_LOGIN_URL && isMoodleLaunchTarget(targetUrl) ? MOODLE_CAS_LOGIN_URL : targetUrl

  if (isMoodleLaunchTarget(targetUrl) && !MOODLE_CAS_LOGIN_URL) {
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
  const targetHost = new URL(relayUrl).hostname

  try {
    let currentUrl = relayUrl

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
          // Leaving the university's services: the browser takes it from the target.
          if (!launchTargets.isAllowed(htmlRedirect)) {
            if (debug) return res.json({ finalUrl: targetUrl, chain, leftAllowedHosts: true })
            return res.redirect(targetUrl)
          }
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

      if (!launchTargets.isAllowed(nextUrl)) {
        if (debug) return res.json({ finalUrl: targetUrl, chain, leftAllowedHosts: true })
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

    const cachedGrades = getCachedGrades(session.id)
    if (cachedGrades) {
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        grades: cachedGrades,
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
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
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
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)

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
    res.status(500).json({
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

// 6d. Promo histogram of one evaluation, what the passerelle shows when a
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

function isPdfBuffer(buffer) {
  return buffer.length > 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF'
}

// 6e. Official-looking PDF relevé, generated by the passerelle. The student id
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
      signal: AbortSignal.timeout(ZIMBRA_REQUEST_TIMEOUT_MS),
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

    throw new Error(`Webmail sign-in stopped on an unexpected page (${response.status} at ${getHostnameFromUrl(currentUrl)}).`)
  }

  throw new Error('Too many redirects while signing in to the webmail.')
}

// `namespace`: urn:zimbraMail (mail requests) or urn:zimbraAccount (GetInfo…).
// `timeoutMs`: the whole answer's deadline (ZIMBRA_REQUEST_TIMEOUT_MS).
async function zimbraSoapRequest(context, requestName, requestBody, namespace = 'urn:zimbraMail', { timeoutMs = ZIMBRA_REQUEST_TIMEOUT_MS } = {}) {
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
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      Header: { context: soapContext },
      Body: { [requestName]: { _jsns: namespace, ...requestBody } },
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

async function zimbraRestInbox(context, limit) {
  const url = `${context.origin}/service/home/~/inbox?fmt=json&limit=${limit}`
  const response = await fetchWithJar(url, context.jar, {
    headers: { Accept: 'application/json', Referer: `${context.origin}/` },
    signal: AbortSignal.timeout(ZIMBRA_REQUEST_TIMEOUT_MS),
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
  // The first recipient: who a sent mail or a draft is for.
  const recipient = addresses.find((address) => address?.t === 't') ?? null
  const recipientEmail = typeof recipient?.a === 'string' && recipient.a ? recipient.a : null
  const timestamp = Number(message?.d)
  const id = String(message?.id ?? '')

  return {
    id,
    from: {
      name: sender?.p || sender?.d || email || '',
      email,
    },
    to: recipient ? { name: recipient.p || recipient.d || recipientEmail || '', email: recipientEmail } : null,
    subject: typeof message?.su === 'string' ? message.su : '',
    snippet: typeof message?.fr === 'string' ? message.fr.replace(/\s+/g, ' ').trim().slice(0, 280) : '',
    receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
    unread: typeof message?.f === 'string' && message.f.includes('u'),
    flagged: typeof message?.f === 'string' && message.f.includes('f'),
    // A row is a thread (normalizeZimbraConversation); a lone message (the
    // REST fallback's) is one of one.
    messageIds: id ? [id] : [],
    count: 1,
    // Unverified deep link format for the Zimbra Ajax client.
    // Partage can't deep-link through the sign-in handoff: rows open the inbox.
    href: getMailWebmailHref(),
  }
}

// A thread of the list (SearchRequest types=conversation): as a message row
// (normalizeZimbraMessage's shape), its newest mail's sender, subject,
// preview and date; `messageIds`, its mails the search found (those in the
// folder: what the row's actions act on); `count`, all its mails. A lone
// mail's thread has a virtual id, « -<its id> ».
function normalizeZimbraConversation(conversation) {
  const id = String(conversation?.id ?? '')
  const hits = (Array.isArray(conversation?.m) ? conversation.m : [])
    .map((message) => String(message?.id ?? ''))
    .filter(Boolean)
  const messageIds = hits.length ? hits : (id.startsWith('-') ? [id.slice(1)] : [])
  const base = normalizeZimbraMessage({ ...conversation, id })
  const flags = typeof conversation?.f === 'string' ? conversation.f : ''
  return {
    ...base,
    unread: flags.includes('u') || Number(conversation?.u) > 0,
    flagged: flags.includes('f'),
    messageIds,
    count: Math.max(Number(conversation?.n) || 1, messageIds.length, 1),
  }
}

// One thread for the reader (GetConvRequest): its mails, oldest first, as
// list rows. Those in the trash or the junk folder are left out unless the
// thread is read from there (`folder`). A lone mail's virtual thread that
// Zimbra won't give is that mail alone.
async function queryZimbraThread(context, id, folder) {
  let result = null
  try {
    result = await zimbraSoapRequest(context, 'GetConvRequest', { c: { id } })
  } catch (error) {
    if (!id.startsWith('-')) throw error
  }
  const conversation = Array.isArray(result?.c) ? result.c[0] : result?.c
  const messages = (Array.isArray(conversation?.m) ? conversation.m : [])
    .filter((message) => {
      const location = String(message?.l ?? '')
      return location === folder || !['3', '4'].includes(location)
    })
    .map((message) => ({ ...normalizeZimbraMessage(message), folder: String(message?.l ?? '') }))
    .filter((message) => message.id)
    .sort((left, right) => String(left.receivedAt ?? '').localeCompare(String(right.receivedAt ?? '')))
  if (messages.length) return messages
  return id.startsWith('-') ? [{ id: id.slice(1), messageIds: [id.slice(1)], count: 1, folder }] : []
}

// `offset`: where the page starts, newest first. The unread count only comes
// with the first page.
// Zimbra's system folders have the same ids in every mailbox; the whole
// tree (sub-folders included) is read by normalizeZimbraFolderTree
// (server/mailFolders.js). Folder id 2 is the Inbox.
const MAIL_INBOX_FOLDER = '2'

function isValidMailFolderId(value) {
  return typeof value === 'string' && /^\d{1,9}$/.test(value)
}

// The demo account's tree: the system folders and one empty sub-folder of
// the inbox, so the « Dossiers » menu has something to show.
const DEMO_MAIL_FOLDERS = [
  { id: '2', kind: 'inbox', name: 'Inbox', unread: 7, count: 5, parentId: null, path: 'Inbox', depth: 0 },
  { id: '300', kind: 'folder', name: 'Moodle', unread: 0, count: 0, parentId: '2', path: 'Inbox/Moodle', depth: 1 },
  { id: '5', kind: 'sent', name: 'Sent', unread: 0, count: 0, parentId: null, path: 'Sent', depth: 0 },
  { id: '6', kind: 'drafts', name: 'Drafts', unread: 0, count: 0, parentId: null, path: 'Drafts', depth: 0 },
  { id: '4', kind: 'junk', name: 'Junk', unread: 0, count: 0, parentId: null, path: 'Junk', depth: 0 },
  { id: '3', kind: 'trash', name: 'Trash', unread: 0, count: 0, parentId: null, path: 'Trash', depth: 0 },
]

// The mail page's search (parseMailSearchWords, buildZimbraSearchQuery):
// src/mailSearch.js, shared with the page, which asks the server only when
// a search word is left.

// `words`: a search (parseMailSearchWords) instead of the whole folder; no
// unread count then. `folder`: a folder id (the inbox by default). Only the
// inbox, unsearched, has the REST fallback (its URL names the inbox).
async function queryZimbraInbox(context, { offset = 0, words = [], folder = MAIL_INBOX_FOLDER } = {}) {
  const searching = words.length > 0
  const restFallback = !searching && folder === MAIL_INBOX_FOLDER
  const [searchResult, folderResult] = await Promise.allSettled([
    zimbraSoapRequest(context, 'SearchRequest', {
      // Threads, as Apple Mail lists them (normalizeZimbraConversation).
      types: 'conversation',
      query: searching ? buildZimbraSearchQuery(words, folder) : `inid:${folder}`,
      sortBy: 'dateDesc',
      limit: MAIL_MAX_MESSAGES,
      offset,
    }),
    // Folder id 2 is the Inbox in every Zimbra mailbox.
    offset === 0 && !searching
      ? zimbraSoapRequest(context, 'GetFolderRequest', { folder: { l: folder }, depth: 0 })
      : Promise.resolve(null),
  ])

  let rawMessages
  let hasMore
  // Where the page starts in rawMessages: the REST API has no offset.
  let pageStart = 0
  let threads = false
  if (searchResult.status === 'fulfilled') {
    rawMessages = Array.isArray(searchResult.value?.c) ? searchResult.value.c : []
    threads = true
    hasMore = searchResult.value?.more === true
  } else if (!restFallback) {
    throw searchResult.reason
  } else {
    // SOAP can be refused for CSRF reasons; the REST API has no CSRF check.
    // Everything up to the page, and one more to know if others follow.
    rawMessages = await zimbraRestInbox(context, offset + MAIL_MAX_MESSAGES + 1)
    hasMore = rawMessages.length > offset + MAIL_MAX_MESSAGES
    pageStart = offset
  }

  let unreadCount = null
  if (folderResult.status === 'fulfilled' && folderResult.value) {
    const folder = Array.isArray(folderResult.value?.folder) ? folderResult.value.folder[0] : folderResult.value?.folder
    if (folder && typeof folder === 'object') {
      unreadCount = Number.isFinite(Number(folder.u)) ? Number(folder.u) : 0
    }
  }

  const messages = rawMessages
    .map((message) => (threads ? normalizeZimbraConversation(message) : normalizeZimbraMessage(message)))
    .filter((message) => message.id)
    .sort((left, right) => String(right.receivedAt ?? '').localeCompare(String(left.receivedAt ?? '')))
    .slice(pageStart, pageStart + MAIL_MAX_MESSAGES)

  return { unreadCount, webmailHref: getMailWebmailHref(), messages, hasMore }
}

// The demo account's search: its mails holding every word (accents, case
// and apostrophe styles aside, as the page's local filter), one page.
function searchDemoMail(payload, words, offset) {
  const folded = words.map(foldMailSearchText)
  const messages = offset > 0 ? [] : payload.messages.filter((message) => {
    const text = foldMailSearchText([message.from?.name, message.from?.email, message.subject, message.snippet].join(' '))
    return folded.every((word) => text.includes(word))
  })
  return { ...payload, messages, hasMore: false }
}

async function getZimbraContext(session, { fresh = false } = {}) {
  let context = fresh ? null : runtimeMailContexts.get(session.id)
  if (!context) {
    context = await establishZimbraContext(session)
    runtimeMailContexts.set(session.id, context)
  }
  return context
}

// The mail address of the account, as the webmail knows it (Zimbra
// GetInfo's account name). Null when there's no Zimbra webmail or it can't
// be read; read once per session.
async function fetchMailAddress(session) {
  if (!FEATURES.mail || MAIL_PROVIDER !== 'zimbra') {
    return null
  }
  if (runtimeMailAddresses.has(session.id)) {
    return runtimeMailAddresses.get(session.id)
  }

  let address = null
  try {
    const context = await getZimbraContext(session)
    const info = await zimbraSoapRequest(context, 'GetInfoRequest', { sections: 'mbox' }, 'urn:zimbraAccount')
    // The same answer gives the attachment limits (readZimbraAttachmentLimits).
    context.attachmentLimits ??= deriveAttachmentLimits(info?.attSizeLimit)
    const name = String(info?.name ?? '').trim()
    address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name) ? name : null
  } catch {
    address = null
  }
  runtimeMailAddresses.set(session.id, address)
  return address
}

async function fetchZimbraRecentMail(session, options) {
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

const MAIL_PROVIDERS = {
  zimbra: fetchZimbraRecentMail,
}

// `options.offset`: the page to read (0, the newest, by default).
async function fetchRecentMail(session, options) {
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

// Runs `fn(context)` with the session's Zimbra context; a rejected session is
// signed in again once.
async function withZimbraContext(session, fn) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const context = await getZimbraContext(session, { fresh: attempt > 0 })
    try {
      return await fn(context)
    } catch (error) {
      runtimeMailContexts.delete(session.id)
      if (!(error instanceof MailAuthError) || attempt > 0) throw error
    }
  }
  throw new Error('Unable to reach the webmail.')
}

class MailNotFoundError extends Error {}

// Logout ends the webmail session too. /__ent_auth/mail/open hands this
// session's Zimbra auth token to the browser (preauth), so a webmail tab
// opened from here holds the same token: dropping our copy alone would leave
// it valid upstream until it expires. EndSessionRequest with logoff asks
// Zimbra to invalidate the auth token itself, not only the SOAP session.
// Unverified on Partage (RENATER may run it with token invalidation off, or
// accept the request without revoking the token): best effort, a short
// deadline, any failure ignored, never in the way of the logout.
async function endZimbraSession(context) {
  if (!context) return
  try {
    await zimbraSoapRequest(context, 'EndSessionRequest', { logoff: '1' }, 'urn:zimbraAccount', { timeoutMs: ZIMBRA_LOGOUT_TIMEOUT_MS })
  } catch {
    // Timeout, network error or a fault: the token lapses on its own.
  }
}

// A mail route's 500 when the webmail failed: a fixed code for the page, the
// details for the server log only. The errors thrown on the way name Zimbra
// requests, SOAP fault codes, hosts and HTTP statuses: nothing the student
// can act on, and a map of the upstream for anyone probing the proxy. The
// page tells a failure from a success by the status alone (src/entApi.js:
// getRecentMail, getMailMessage, getMailThread, getMailFolders, mailAction).
// One case keeps a code of its own: the webmail sign-in found the CAS
// session lapsed (establishZimbraContext), which a new sign-in fixes and
// « Réessayer » doesn't. The 401 « no session » answers and /recent's
// { authenticated: false } are left as they are, before any of this.
// Logged: the error's class and message, never a mail, a cookie or a token
// (none is ever put in these messages).
const MAIL_CAS_EXPIRED_PATTERN = /^CAS session (expired|unavailable)\b/

function sendMailRouteError(res, route, error) {
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error && error.cause?.code ? ` (${error.cause.code})` : ''
  console.error(`[mail] ${route} failed: ${name}: ${message.slice(0, 300)}${cause}`)
  const code = MAIL_CAS_EXPIRED_PATTERN.test(message) ? 'mail_session_expired' : 'mail_unavailable'
  return res.headersSent ? res.end() : res.status(500).json({ error: code })
}

// One message, cleaned for the reader (server/mailMessage.js). neuter: 0
// gives the HTML as sent (mailMessage.js holds the remote images back
// itself); not marked read here (POST /__ent_auth/mail/action).
async function fetchZimbraMessage(session, id) {
  return withZimbraContext(session, async (context) => {
    let result
    try {
      result = await zimbraSoapRequest(context, 'GetMsgRequest', {
        m: { id, html: 1, neuter: 0, needExp: 1, max: MAIL_MESSAGE_MAX_BYTES },
      })
    } catch (error) {
      if (/NO_SUCH_(MSG|ITEM)/.test(error.message)) throw new MailNotFoundError('No such message.')
      throw error
    }
    const message = Array.isArray(result.m) ? result.m[0] : result.m
    if (!message) throw new MailNotFoundError('No such message.')
    return buildMailMessage(message, id)
  })
}

// The demo account's attachments, by message (what a real mail's are,
// buildMailMessage's, without the download link: the part route doesn't
// serve the demo).
const DEMO_MAIL_ATTACHMENTS = {
  'demo-mail-1': [
    { part: '2', name: 'Consignes TP4 – composants et état.pdf', type: 'application/pdf', size: 248_312, href: null },
    { part: '3', name: 'maquette-composants.png', type: 'image/png', size: 612_480, href: null },
  ],
}

// A demo account's message: its preview, as a plain text mail.
function buildDemoMailMessage(id) {
  const message = buildDemoMailPayload().messages.find((entry) => entry.id === id)
  if (!message) return null
  return {
    id,
    subject: message.subject,
    from: message.from,
    replyTo: null,
    to: [],
    cc: [],
    receivedAt: message.receivedAt,
    unread: Boolean(message.unread),
    format: 'text',
    html: mailTextToHtml(message.snippet),
    remoteImages: 0,
    truncated: false,
    // Sample files for a forward to carry (nothing behind them: no link).
    attachments: DEMO_MAIL_ATTACHMENTS[id] ?? [],
  }
}

function getMailMessageSession(req, res) {
  const session = getSessionFromRequest(req)
  if (!session) {
    res.status(401).json({ error: 'Authentication required.' })
    return null
  }
  if (!isDemoSession(session) && MAIL_PROVIDER !== 'zimbra') {
    res.status(404).json({ error: 'Message unavailable.' })
    return null
  }
  return session
}

// The ids a session's mail routes take: Zimbra's numeric ones for a real
// session, the sample ones for the demo account (whose routes never reach
// Zimbra). Each kind is refused for the other session.
function isValidSessionMailId(session, id) {
  return isDemoSession(session) ? isValidDemoMailMessageId(id) : isValidMailMessageId(id)
}

// 6d. One message for the mail page's reader. The HTML is already cleaned;
// the page still shows it in a sandboxed iframe (src/components/MailReader.jsx).
app.get('/__ent_auth/mail/message', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const session = getMailMessageSession(req, res)
  if (!session) return undefined
  const id = String(req.query.id ?? '')
  if (!isValidSessionMailId(session, id)) {
    return res.status(400).json({ error: 'Invalid message id.' })
  }

  try {
    const message = isDemoSession(session) ? buildDemoMailMessage(id) : await fetchZimbraMessage(session, id)
    if (!message) throw new MailNotFoundError('No such message.')
    setSessionCookie(res, session)
    return res.status(200).json({ message })
  } catch (error) {
    if (error instanceof MailNotFoundError) return res.status(404).json({ error: 'No such message.' })
    return sendMailRouteError(res, 'message', error)
  }
})

// 6e. What the reader does to a message, as Zimbra's MsgActionRequest ops:
// read (when it opens an unread one), unread, flag and unflag, trash and
// spam (both reversible: `inbox` moves it back, the reader's « Annuler »),
// on one message or a selection (`ids`, in one request: Zimbra takes them
// comma-separated). Folder id 2 is the Inbox in every Zimbra mailbox.
const MAIL_ACTIONS = {
  read: { op: 'read' },
  unread: { op: '!read' },
  flag: { op: 'flag' },
  unflag: { op: '!flag' },
  trash: { op: 'trash' },
  spam: { op: 'spam' },
  inbox: { op: 'move', l: '2' },
  // To `folder` (the body's): « Annuler » back to where the mail was, a
  // trashed mail restored, a mail filed in another folder.
  move: { op: 'move' },
  // Gone for good (« Supprimer définitivement », offered in the trash and the
  // junk folder only). `tcon` (Zimbra's target constraint) makes the server
  // hold to that too: only mails lying in the trash (t) or the junk folder
  // (j) are deleted, any other id in the list is left alone.
  delete: { op: 'delete', tcon: 'tj' },
}
// A selection is the loaded list at most (pages of MAIL_MAX_MESSAGES).
const MAIL_ACTION_MAX_IDS = 500

// The mailbox's folders (normalizeZimbraFolderTree), kept on the session's
// Zimbra context: read by /mail/folders for the page's pills and menu, and
// by a `move` to check its target is one of them. The page only ever moves
// a mail to a folder it got from that list (« Annuler » back to the one it
// showed it in, a restore, a mail filed elsewhere), so anything else is
// refused: a folder shared by someone else (a mountpoint, never listed), a
// calendar or contacts folder, an id made up. Kept with the context, it
// goes with it (a new sign-in, a logout) and is read again then.
async function readZimbraMailFolders(context, { fresh = false } = {}) {
  if (!fresh && Array.isArray(context.mailFolders)) return context.mailFolders
  // The root (USER_ROOT, id 1) and everything under it, however deep.
  const result = await zimbraSoapRequest(context, 'GetFolderRequest', { folder: { l: '1' } })
  const folders = normalizeZimbraFolderTree(Array.isArray(result?.folder) ? result.folder[0] : result?.folder)
  context.mailFolders = folders
  return folders
}

// The account's attachment limits (deriveAttachmentLimits) from Zimbra
// GetInfo's attSizeLimit (zimbraMtaMaxMessageSize), kept on the context:
// read once per webmail sign-in (by /mail/prefs, /mail/upload or
// fetchMailAddress, whichever comes first). A GetInfo that fails for
// another reason than the session leaves the fallback limits.
async function readZimbraAttachmentLimits(context) {
  if (context.attachmentLimits) return context.attachmentLimits
  let messageLimit = null
  try {
    const info = await zimbraSoapRequest(context, 'GetInfoRequest', { sections: 'mbox' }, 'urn:zimbraAccount')
    messageLimit = info?.attSizeLimit
  } catch (error) {
    if (error instanceof MailAuthError) throw error
  }
  context.attachmentLimits = deriveAttachmentLimits(messageLimit)
  return context.attachmentLimits
}

// Same-origin only; the session cookie is SameSite=Lax as well.
app.post('/__ent_auth/mail/action', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin') {
    return res.status(403).json({ error: 'Cross-site request.' })
  }
  const session = getMailMessageSession(req, res)
  if (!session) return undefined
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
  if (!ids.length || ids.length > MAIL_ACTION_MAX_IDS || !ids.every((id) => isValidSessionMailId(session, id))) {
    return res.status(400).json({ error: 'Invalid message ids.' })
  }
  const action = Object.hasOwn(MAIL_ACTIONS, req.body?.action) ? MAIL_ACTIONS[req.body.action] : null
  if (!action) {
    return res.status(400).json({ error: 'Invalid action.' })
  }

  const move = req.body.action === 'move'
  const folder = String(req.body?.folder ?? '')
  if (move && !isValidMailFolderId(folder)) {
    return res.status(400).json({ error: 'Invalid folder.' })
  }

  try {
    if (isDemoSession(session)) {
      // Nothing moves in the demo, but the same rule: one of its folders.
      if (move && !DEMO_MAIL_FOLDERS.some((entry) => entry.id === folder)) {
        return res.status(400).json({ error: 'Invalid folder.' })
      }
    } else {
      if (move) {
        // One of the mailbox's own folders (readZimbraMailFolders). Listed
        // again once when it isn't in the kept list: a folder made in the
        // webmail since, or a list read on another context.
        const listed = (folders) => folders.some((entry) => entry.id === folder)
        let folders = await withZimbraContext(session, (context) => readZimbraMailFolders(context))
        if (!listed(folders)) {
          folders = await withZimbraContext(session, (context) => readZimbraMailFolders(context, { fresh: true }))
        }
        if (!listed(folders)) {
          return res.status(400).json({ error: 'Invalid folder.' })
        }
      }
      await withZimbraContext(session, (context) => zimbraSoapRequest(context, 'MsgActionRequest', {
        action: { ...action, ...(move ? { l: folder } : null), id: ids.join(',') },
      }))
      // The cached first page would show the message as it was.
      runtimeMailCache.delete(session.id)
    }
    setSessionCookie(res, session)
    return res.status(200).json({ ok: true })
  } catch (error) {
    return sendMailRouteError(res, 'action', error)
  }
})

// 6f. One part of a message: the inline images the reader shows, the
// attachments it offers. Streamed from Zimbra's REST servlet; anything but a
// plain raster image downloads, and the response can't run anything if
// opened (CSP sandbox, nosniff).
app.get('/__ent_auth/mail/part', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Referrer-Policy', 'no-referrer')
  const session = getSessionFromRequest(req)
  const id = String(req.query.id ?? '')
  const part = String(req.query.part ?? '')

  if (!session || isDemoSession(session) || MAIL_PROVIDER !== 'zimbra') {
    return res.status(404).end()
  }
  if (!isValidMailMessageId(id) || !isValidMailPartId(part)) {
    return res.status(400).end()
  }

  // The upstream request's deadlines (ZIMBRA_REQUEST_TIMEOUT_MS for its
  // headers, then MAIL_PART_IDLE_TIMEOUT_MS between chunks), and its end
  // when the student's side closes first (a download cancelled, the reader
  // closed on a loading image).
  const upstreamController = new AbortController()
  let upstreamDeadline = null
  const abortUpstreamAfter = (ms) => {
    clearTimeout(upstreamDeadline)
    upstreamDeadline = setTimeout(() => upstreamController.abort(new Error('Mail part request timed out.')), ms)
  }
  res.on('close', () => {
    clearTimeout(upstreamDeadline)
    upstreamController.abort()
  })

  try {
    const upstream = await withZimbraContext(session, async (context) => {
      const url = new URL('/service/home/~/', context.origin)
      url.searchParams.set('auth', 'co')
      url.searchParams.set('id', id)
      url.searchParams.set('part', part)
      abortUpstreamAfter(ZIMBRA_REQUEST_TIMEOUT_MS)
      const response = await fetchWithJar(url.toString(), context.jar, {
        headers: { Referer: `${context.origin}/` },
        signal: upstreamController.signal,
      })
      if (response.status === 401 || response.status === 403 || isRedirectStatus(response.status)) {
        await response.body?.cancel()
        throw new MailAuthError(`Zimbra REST rejected the session (HTTP ${response.status}).`)
      }
      return response
    })

    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel()
      return res.status(upstream.status === 404 ? 404 : 502).end()
    }
    const length = Number(upstream.headers.get('content-length'))
    if (Number.isFinite(length) && length > MAIL_PART_MAX_BYTES) {
      await upstream.body.cancel()
      return res.status(413).end()
    }

    const { contentType, disposition } = getMailPartDisposition({
      contentType: upstream.headers.get('content-type'),
      filename: readContentDispositionFilename(upstream.headers.get('content-disposition')),
      download: req.query.download === '1',
    })
    res.setHeader('Cache-Control', 'private, max-age=600')
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', disposition)
    if (Number.isFinite(length) && length > 0) res.setHeader('Content-Length', String(length))
    setSessionCookie(res, session)

    const body = Readable.fromWeb(upstream.body)
    abortUpstreamAfter(MAIL_PART_IDLE_TIMEOUT_MS)
    body.on('data', () => abortUpstreamAfter(MAIL_PART_IDLE_TIMEOUT_MS))
    body.on('end', () => clearTimeout(upstreamDeadline))
    body.on('error', () => res.destroy())
    body.pipe(res)
    return undefined
  } catch {
    return res.headersSent ? res.destroy() : res.status(502).end()
  }
})

// 6b. Recent mail endpoint. ?offset=N: the next page of the mail page's
// endless list (not cached, the first page is).
// One thread for the reader (queryZimbraThread), `folder` the one it's read
// from: 200 { messages: [list rows, oldest first, with their folder] }.
app.get('/__ent_auth/mail/thread', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const session = getMailMessageSession(req, res)
  if (!session) return undefined
  const id = String(req.query.id ?? '')
  if (!isValidSessionMailId(session, id)) {
    return res.status(400).json({ error: 'Invalid thread id.' })
  }
  const folder = isValidMailFolderId(String(req.query.folder ?? '')) ? String(req.query.folder) : MAIL_INBOX_FOLDER
  try {
    const messages = isDemoSession(session)
      ? buildDemoMailPayload().messages.filter((message) => message.id === id).map((message) => ({ ...message, messageIds: [message.id], count: 1, folder }))
      : await withZimbraContext(session, (context) => queryZimbraThread(context, id, folder))
    setSessionCookie(res, session)
    return res.status(200).json({ messages })
  } catch (error) {
    return sendMailRouteError(res, 'thread', error)
  }
})

// The mailbox's folders for the mail page's pills and its « Dossiers » menu
// (normalizeZimbraFolderTree, server/mailFolders.js):
//   200 { folders: [{ id, kind, name, unread, count, parentId, path, depth }] }
//   (parents before their children), 401 no session.
app.get('/__ent_auth/mail/folders', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const session = getMailMessageSession(req, res)
  if (!session) return undefined
  try {
    const folders = isDemoSession(session)
      ? DEMO_MAIL_FOLDERS
      // The root (USER_ROOT, id 1) and everything under it, however deep:
      // sub-folders of the inbox (a « Moodle » filter's) included. The
      // calendars, contacts and the like come along and are dropped there.
      // Always read afresh here, and kept for the `move` check
      // (readZimbraMailFolders): what the page offers is what it may move to.
      : await withZimbraContext(session, (context) => readZimbraMailFolders(context, { fresh: true }))
    setSessionCookie(res, session)
    return res.status(200).json({ folders })
  } catch (error) {
    return sendMailRouteError(res, 'folders', error)
  }
})

// 6g. What the mail page does to a whole folder, as Zimbra's
// FolderActionRequest ops: `read` marks every mail in it read (« Tout
// marquer comme lu », any mail folder), `empty` deletes all it holds for
// good (« Vider la corbeille », « Vider les indésirables »: the trash and the
// junk folder only, refused for any other). Same-origin only, as
// /mail/action. A demo account's folders don't change: a no-op.
//   POST { folder, action: 'read' | 'empty' } → 200 { ok: true },
//   400 a bad folder or action, 401 no session, 403 cross-site.
const MAIL_FOLDER_ACTIONS = new Set(['read', 'empty'])

app.post('/__ent_auth/mail/folder-action', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin') {
    return res.status(403).json({ error: 'Cross-site request.' })
  }
  const session = getMailMessageSession(req, res)
  if (!session) return undefined
  const action = typeof req.body?.action === 'string' && MAIL_FOLDER_ACTIONS.has(req.body.action) ? req.body.action : null
  if (!action) {
    return res.status(400).json({ error: 'Invalid action.' })
  }
  const folder = String(req.body?.folder ?? '')
  // The root (1) and Zimbra's other low ids aren't mail folders to act on;
  // emptying is held to the trash and the junk folder whatever is asked.
  if (!isValidMailFolderId(folder) || Number(folder) < 2 || (action === 'empty' && !isEmptiableMailFolder(folder))) {
    return res.status(400).json({ error: 'Invalid folder.' })
  }

  try {
    if (isDemoSession(session)) {
      // Nothing changes in the demo, but the same rule: one of its folders.
      if (!DEMO_MAIL_FOLDERS.some((entry) => entry.id === folder)) {
        return res.status(400).json({ error: 'Invalid folder.' })
      }
    } else {
      // One of the mailbox's own folders (readZimbraMailFolders), as for a
      // `move`: listed again once when it isn't in the kept list (a folder
      // made in the webmail since). A shared folder (a mountpoint), a
      // calendar or a made-up id is refused before Zimbra is asked.
      const listed = (folders) => folders.some((entry) => entry.id === folder)
      let folders = await withZimbraContext(session, (context) => readZimbraMailFolders(context))
      if (!listed(folders)) {
        folders = await withZimbraContext(session, (context) => readZimbraMailFolders(context, { fresh: true }))
      }
      if (!listed(folders)) {
        return res.status(400).json({ error: 'Invalid folder.' })
      }
      await withZimbraContext(session, (context) => zimbraSoapRequest(context, 'FolderActionRequest', {
        // Emptying the trash takes the folders deleted into it along, as the
        // webmail's « Vider la corbeille » does; the junk folder keeps any
        // sub-folder a filter made there.
        action: action === 'empty'
          ? { op: 'empty', id: folder, recursive: folder === '3' }
          : { op: 'read', id: folder },
      }))
      // The cached first page would show the folder as it was.
      runtimeMailCache.delete(session.id)
    }
    setSessionCookie(res, session)
    return res.status(200).json({ ok: true })
  } catch (error) {
    return sendMailRouteError(res, 'folder-action', error)
  }
})

// 6h. The account's webmail preferences the mail page follows:
// zimbraPrefMarkMsgRead (parseZimbraMarkReadPref), how many seconds an open
// mail waits before it's marked read, -1 never, 0 at once; and the
// composer's attachment limits (readZimbraAttachmentLimits), for it to
// refuse a file too large before a byte of it is sent. Read once per
// webmail sign-in (kept on its context, which goes with the session); the
// demo account marks at once and has the fallback limits.
//   200 { markRead: number, attachments: { maxFileBytes, maxTotalBytes } },
//   401 no session.
app.get('/__ent_auth/mail/prefs', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const session = getMailMessageSession(req, res)
  if (!session) return undefined
  try {
    const { markRead, limits } = isDemoSession(session)
      ? { markRead: 0, limits: deriveAttachmentLimits(null) }
      : await withZimbraContext(session, async (context) => {
        const [markReadDelay, attachmentLimits] = await Promise.all([
          context.markReadDelay === undefined
            ? zimbraSoapRequest(context, 'GetPrefsRequest', { pref: [{ name: 'zimbraPrefMarkMsgRead' }] }, 'urn:zimbraAccount').then(parseZimbraMarkReadPref)
            : context.markReadDelay,
          readZimbraAttachmentLimits(context),
        ])
        context.markReadDelay = markReadDelay
        return { markRead: markReadDelay, limits: attachmentLimits }
      })
    setSessionCookie(res, session)
    return res.status(200).json({
      markRead,
      attachments: { maxFileBytes: limits.maxFileBytes, maxTotalBytes: limits.maxTotalBytes },
    })
  } catch (error) {
    return sendMailRouteError(res, 'prefs', error)
  }
})

// 6i. Recipient suggestions for the composer's À, Cc and Cci
// (server/mailAutocomplete.js): the student's contacts, past correspondents
// and the institution's directory, as Zimbra's AutoCompleteRequest finds
// them. The text searched is the only thing taken from the request, cleaned
// first (normalizeRecipientQuery: letters, digits and @ . _ + ' -, 64
// characters at most); too short, nothing is asked. Same-origin only. Under
// the mail routes' per-session limit like the others (the composer waits for
// a pause in the typing and drops what it no longer needs). The query is
// never logged, nor the answer kept.
//   GET ?q=… → 200 { suggestions: [{ name, email, kind }] } (12 at most),
//   401 no session, 403 cross-site, 429 too many, 500 { error }.
const MAIL_AUTOCOMPLETE_TIMEOUT_MS = 6000

app.get('/__ent_auth/mail/autocomplete', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin') {
    return res.status(403).json({ error: 'Cross-site request.' })
  }
  const session = getMailMessageSession(req, res)
  if (!session) return undefined
  const query = normalizeRecipientQuery(req.query.q)
  if (query.length < RECIPIENT_QUERY_MIN_LENGTH) {
    return res.status(200).json({ suggestions: [] })
  }

  try {
    const suggestions = isDemoSession(session)
      ? searchDemoMailContacts(query)
      : await withZimbraContext(session, async (context) => normalizeZimbraAutoComplete(
        await zimbraSoapRequest(context, 'AutoCompleteRequest', buildZimbraAutoCompleteRequest(query), 'urn:zimbraMail', { timeoutMs: MAIL_AUTOCOMPLETE_TIMEOUT_MS }),
      ))
    setSessionCookie(res, session)
    return res.status(200).json({ suggestions })
  } catch (error) {
    return sendMailRouteError(res, 'autocomplete', error)
  }
})

app.get('/__ent_auth/mail/recent', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    const session = getSessionFromRequest(req)
    const offset = Math.min(Math.max(Number.parseInt(String(req.query.offset ?? ''), 10) || 0, 0), MAIL_MAX_OFFSET)
    // The mail page's search (`q`) and folder (`folder`, an id: Envoyé,
    // Corbeille…). Only the inbox's first page is cached.
    const words = parseMailSearchWords(req.query.q)
    const folder = isValidMailFolderId(String(req.query.folder ?? '')) ? String(req.query.folder) : MAIL_INBOX_FOLDER

    if (!session) {
      return res.status(200).json({ authenticated: false, mail: null })
    }

    if (folder !== MAIL_INBOX_FOLDER) {
      // The demo account has nothing but its inbox.
      const mail = isDemoSession(session)
        ? { ...buildDemoMailPayload(), unreadCount: 0, messages: [], hasMore: false }
        : await fetchRecentMail(session, { offset, words, folder })
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        mail: words.length ? { ...mail, unreadCount: null } : mail,
      })
    }

    if (words.length) {
      const mail = isDemoSession(session)
        ? searchDemoMail(buildDemoMailPayload(), words, offset)
        : await fetchRecentMail(session, { offset, words })
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        mail: { ...mail, unreadCount: null },
      })
    }

    if (isDemoSession(session)) {
      setSessionCookie(res, session)
      const demoMail = buildDemoMailPayload()
      return res.status(200).json({
        authenticated: true,
        sessionMode: DEMO_SESSION_MODE,
        mail: offset === 0 ? demoMail : { ...demoMail, unreadCount: null, messages: [], hasMore: false },
      })
    }

    if (offset > 0) {
      const mail = await fetchRecentMail(session, { offset })
      setSessionCookie(res, session)
      return res.status(200).json({
        authenticated: true,
        sessionMode: session.mode ?? null,
        mail,
      })
    }

    // `fresh=1`: the mail page's refresh (its button, a new mail seen), past
    // the cache.
    const cachedMail = req.query.fresh === '1' ? null : getCachedMail(session.id)
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
    // The details go to the server log only (sendMailRouteError).
    return sendMailRouteError(res, 'recent', error)
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
  const loginUrl = MOODLE_CAS_LOGIN_URL ?? MOODLE_SHIBBOLETH_LOGIN_URL
  if (!loginUrl) {
    throw new Error('Moodle is not configured for this university.')
  }

  if (!getSessionLaunchCapabilities(session).canUseServerLaunch) {
    throw new MoodleAuthError('CAS session unavailable for Moodle; please sign in again.')
  }

  const jar = CookieJar.fromSerialized(session.jar.serialize())
  let currentUrl = loginUrl
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

  return {
    id: String(event.id ?? `${event.modulename ?? 'event'}-${event.instance ?? ''}-${timestamp}`),
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

async function fetchMoodleDeadlines(session) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let context = attempt === 0 ? runtimeMoodleContexts.get(session.id) : null
    if (context && Date.now() - context.createdAt > MOODLE_CONTEXT_TTL_MS) {
      context = null
    }

    if (!context) {
      context = await establishMoodleContext(session)
      runtimeMoodleContexts.set(session.id, context)
    }

    try {
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
    // Messages are built from status codes, error codes and hostnames only —
    // never from cookies, the sesskey or upstream bodies.
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
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
        api: PLANNING_API,
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
          api: PLANNING_API,
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

// 9. ADE VET Tree
app.get('/__ent_auth/ade/tree', async (req, res) => {
  try {
    const entSession = getSessionFromRequest(req)
    if (!entSession) return res.status(200).json({ authenticated: false, tree: null })

    const requestedTreeId = String(req.query.etabsVets ?? '')

    if (isDemoSession(entSession)) {
      // A personal timetable (TEMPO) has no group to pick: the demo adopts
      // its single group, as a real account does (no network call).
      const tree = PLANNING_API === 'tempo'
        ? await fetchPortalTree(entSession.jar, {})
        : buildDemoAdeTreePayload(requestedTreeId)
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
      const tree = await fetchPortalTree(entSession.jar, {
        requestedResourceId: requestedTreeId,
        fallbackResourceId: String(req.query.fallback ?? ''),
        cacheScope: getPlanningCacheScope(entSession),
      })

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
          api: PLANNING_API,
          projectId: tree.projectId,
          cache: tree.cache,
          authCache: tree.authCache,
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
          api: PLANNING_API,
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
          api: PLANNING_API,
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
          // TEMPO: the account has no timetable there (tempoApi.js).
          noTimetable: portalResult.noTimetable === true,
          resourceIds: portalResult.resourceIds,
          selectionLabels,
          events: portalResult.events,
          nextEvent,
        },
        debug: {
          source: PLANNING_HOST,
          api: PLANNING_API,
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
          api: PLANNING_API,
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
// short timeout) so the TGC that travelled in the cookie is dead upstream,
// and the webmail session if one was opened (endZimbraSession).
app.post('/__ent_auth/logout', async (req, res) => {
  const session = getSessionFromRequest(req)
  if (session?.id) {
    // Read before the runtime state goes: the webmail session it signs.
    const mailContext = runtimeMailContexts.get(session.id) ?? null
    dropRuntimeSession(session.id)
    clearSensitiveSessionCaches(session)

    if (!isDemoSession(session)) {
      await Promise.all([terminateCasSession(session.jar), endZimbraSession(mailContext)])
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

// Drupal portal: no uPortal APIs. The applications grid asks the proxy for the
// layout, layoutDoc and marketplace: the layout is built from the catalogue
// page (catalog.path), the other two are empty.
async function fetchDrupalCatalogPage(session) {
  const page = await followRedirectChain(PORTAL_CATALOG_URL, session.jar, {
    headers: { Accept: HTML_ACCEPT_HEADER },
  })
  const html = await page.response.text()
  const signedIn = getHostnameFromUrl(page.finalUrl) === ENT_HOST && isDrupalSignedInPage(page.response.status, html)
  return signedIn ? html : null
}

if (PORTAL_KIND === 'drupal') {
  app.get('/__ent_proxy/api/v4-3/dlm/layout.json', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const session = getSessionFromRequest(req)
      if (!session || isDemoSession(session)) {
        return res.status(401).json({ error: 'Not signed in.' })
      }

      let html = PORTAL_CATALOG_URL ? await fetchDrupalCatalogPage(session) : ''
      // Portal session lapsed: sign in again silently with the CAS TGC.
      if (html === null && await reestablishEntSessionOnce(session)) {
        html = await fetchDrupalCatalogPage(session)
      }
      if (html === null) {
        return res.status(401).json({ error: 'The portal session has expired.' })
      }

      setSessionCookie(res, session)
      res.json(buildDrupalLayout(parseDrupalToolCatalogue(html, ENT_ORIGIN), session.user ?? null))
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get(['/__ent_proxy/api/layoutDoc', '/__ent_proxy/api/marketplace/entries.json'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json([])
  })
}

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
