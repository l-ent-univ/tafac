import { noteBackendAnswer } from './dev/backendTrace.js'
import universityConfig from '@university'
import { GRADES_UNAVAILABLE_MESSAGE } from './gradeFeatureState'
import { evaluationTypeLabel, listGradesSemesters, summarizeAverage } from './gradesReport'
import { readDistributionCounts } from './evaluationDistribution'
import { findTpUnderYear, pickAdeGroupForAlias } from './adeGroupMatch'
import { adeTreeRoot, buildDirectory, findTreePath, focusAdeTree, followedGroups } from './planningTree'
import { buildParcoursTpAliases } from './scodocParcoursGroups'
import { getDefaultUniversityId, getLoadedUniversityId, getUniversityRequestHeaders } from './universityRuntime'
import { buildUploadDisposition, normalizeAttachmentType, readAttachmentLimits, sanitizeAttachmentName } from './mailAttachments'
import { isValidAddress, sanitizeDisplayName } from './mailCompose'
import { readMailSignatures } from './mailSignatureChoice'
import { r } from './register.js'
import { createSessionSignal, logoutHeaders } from './sessionSignal'
import { isNativeApp } from './desktopApp'
import { DEMO_ACCOUNT, DEMO_SESSION_MODE, isDemoCredentials } from './demoAccount'
import { answerDemoRequest, isDemoSignedIn, signInToDemo, signOutOfDemo, uploadDemoFile } from './demoRuntime'

// Null on the neutral page (no university picked yet).
export const ENT_ORIGIN = universityConfig.origins.ent
const ENT_HOST = ENT_ORIGIN ? new URL(ENT_ORIGIN).hostname : ''
const APP_BASE_URL = (() => {
  const rawBaseUrl = String(import.meta.env?.BASE_URL || '/').trim()

  if (!rawBaseUrl || rawBaseUrl === '/') {
    return ''
  }

  return rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl
})()

export const ENT_PROXY_PREFIX = `${APP_BASE_URL}/__ent_proxy`
export const ENT_AUTH_PREFIX = `${APP_BASE_URL}/__ent_auth`
export const DEFAULT_REFERER = `${ENT_ORIGIN}${universityConfig.auth?.portalEntryPath ?? '/'}`
// Public entry point of the grade service (ScoDoc/Notes9), opened through the
// server-side launch relay so the CAS session is reused. Null when the
// university has no grade service configured.
const GRADES_SERVICE_URL = universityConfig.grades?.serviceUrl ?? null
export const GRADES_LAUNCH_HREF = GRADES_SERVICE_URL
  ? `${ENT_AUTH_PREFIX}/launch?url=${encodeURIComponent(GRADES_SERVICE_URL)}`
  : null
const DEFAULT_ACCEPT = 'application/json, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5'
const RECENT_LOGIN_SESSION_KEY = 'l-ent:recent-login-at'
// Whether the session is still valid, as the server's answers say
// (src/sessionSignal.js).
const sessionSignal = createSessionSignal()

export const onSessionExpired = sessionSignal.subscribe
// The server said so to the desktop app (its Moodle view's 'expired').
export const reportSessionExpired = () => sessionSignal.expire()

// Whether the page shows the demo account, as its last session check said.
let showsDemo = false

// fetch() for this app's server, its answer checked for the session (also
// for src/appIcons.js and the applications' launch preview). The demo
// account's requests are answered by the page itself (src/demoRuntime.js):
// nothing of it is sent.
export async function serverFetch(url, init) {
  if (!isDemoSignedIn()) {
    // The demo the page shows is over without a sign-out here (its thirty
    // days ran out): said as a session that expired, as the cookie's end
    // was, rather than left with a server that knows nobody.
    if (showsDemo) {
      showsDemo = false
      signOutOfDemo()
      sessionSignal.expire()
    }
    return sendToServer(url, init)
  }
  const startedAt = import.meta.env.DEV ? performance.now() : 0
  const response = await answerDemoRequest(url, init)
  if (import.meta.env.DEV) noteBackendAnswer(url, response, performance.now() - startedAt, 'page')
  return response
}

async function sendToServer(url, init) {
  const sentUnder = sessionSignal.current
  const startedAt = import.meta.env.DEV ? performance.now() : 0
  const response = await fetch(url, init)
  // Development: which side answered (the Rust gateway or the Node server),
  // for src/dev/BackendMarks.jsx.
  if (import.meta.env.DEV) noteBackendAnswer(url, response, performance.now() - startedAt)
  sessionSignal.note(sentUnder, (name) => response.headers.get(name))
  return response
}

function setRecentLoginMarker() {
  try {
    sessionStorage.setItem(RECENT_LOGIN_SESSION_KEY, String(Date.now()))
  } catch {
    // Ignore unavailable session storage.
  }
}

function clearRecentLoginMarker() {
  try {
    sessionStorage.removeItem(RECENT_LOGIN_SESSION_KEY)
  } catch {
    // Ignore unavailable session storage.
  }
}

export function getRecentEntLoginAgeMs() {
  try {
    const rawValue = sessionStorage.getItem(RECENT_LOGIN_SESSION_KEY)
    const timestamp = Number(rawValue ?? 0)

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return Infinity
    }

    return Math.max(0, Date.now() - timestamp)
  } catch {
    return Infinity
  }
}

export function isRecentEntLogin(windowMs) {
  return getRecentEntLoginAgeMs() <= Math.max(0, Number(windowMs) || 0)
}

function normalizeProxyPath(input) {
  if (!input) {
    return '/'
  }

  if (input.startsWith(ENT_ORIGIN)) {
    const url = new URL(input)
    return `${url.pathname}${url.search}`
  }

  if (input.startsWith('http://') || input.startsWith('https://')) {
    throw new Error(`Only ${ENT_HOST} URLs are supported by the local proxy.`)
  }

  return input.startsWith('/') ? input : `/${input}`
}

export function buildEntProxyHref(input) {
  return `${ENT_PROXY_PREFIX}${normalizeProxyPath(input)}`
}

function normalizeExtraHeaders(extraHeaders = {}) {
  const headers = {}

  for (const [name, value] of Object.entries(extraHeaders)) {
    if (value === undefined || value === null || value === '') {
      continue
    }

    const lowerName = name.toLowerCase()
    if (lowerName === 'cookie' || lowerName === 'referer') {
      continue
    }

    headers[name] = String(value)
  }

  return headers
}

function buildFetchHeaders(auth = {}, extraHeaders = {}) {
  const headers = new Headers()
  const mergedExtraHeaders = normalizeExtraHeaders({
    Accept: DEFAULT_ACCEPT,
    ...(auth.extraHeaders ?? {}),
    ...extraHeaders,
  })

  if (auth.cookie?.trim()) {
    headers.set('x-ent-cookie', auth.cookie.trim())
  }

  if (auth.referer?.trim()) {
    headers.set('x-ent-referer', auth.referer.trim())
  }

  if (Object.keys(mergedExtraHeaders).length > 0) {
    headers.set('x-ent-extra-headers', JSON.stringify(mergedExtraHeaders))
  }

  return headers
}

async function parseResponse(response) {
  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  let data = text

  if (contentType.includes('application/json')) {
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    contentType,
    headers: Object.fromEntries(response.headers.entries()),
    text,
    data,
  }
}

// Coarse failure kind for anonymous analytics (widget_loaded.error_kind).
// Errors thrown below carry the HTTP status in `status` when there was a
// response; a fetch that never got one rejects with a TypeError.
export function getRequestErrorKind(error) {
  const status = Number(error?.status)
  if (status >= 500) return 'http_5xx'
  if (status >= 400) return 'http_4xx'
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'timeout'
  if (error instanceof TypeError) return 'network'
  return 'other'
}

function createHttpError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

async function parseJsonPayload(response) {
  const text = await response.text()
  let data = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = text
  }

  if (!response.ok) {
    // `error`: the server's words; `detail`: tonAPI's, on a refusal of its
    // own (a problem: the planning's routes).
    const errorMessage = typeof data === 'object' && (data?.error || data?.detail)
      ? data.error || data.detail
      : typeof data === 'string' && data
        ? data
        : `Request failed with status ${response.status}.`

    const error = createHttpError(errorMessage, response.status)
    // What the server says the failure is, when it names it (the login's
    // 'mfa_required', 'mfa_invalid'…), and what the code step offers
    // (`mfa`: { methods, sent }).
    if (typeof data === 'object' && typeof data?.code === 'string') {
      error.code = data.code
    }
    if (typeof data === 'object' && data?.mfa && typeof data.mfa === 'object') {
      error.mfa = data.mfa
    }
    // Seconds until the login rate limit lifts (429), for the message.
    const retryAfterSeconds = Number(response.headers.get('Retry-After'))
    if (retryAfterSeconds > 0) {
      error.retryAfterSeconds = retryAfterSeconds
    }
    throw error
  }

  return data
}

export async function requestEnt(path, options = {}) {
  const {
    auth = {},
    method = 'GET',
    body = '',
    headers = {},
  } = options
  const normalizedPath = normalizeProxyPath(path)
  const upperMethod = method.toUpperCase()
  const hasBody = body !== '' && body !== undefined && body !== null && !['GET', 'HEAD'].includes(upperMethod)

  const response = await serverFetch(`${ENT_PROXY_PREFIX}${normalizedPath}`, {
    method: upperMethod,
    credentials: 'same-origin',
    headers: buildFetchHeaders(auth, headers),
    body: hasBody ? body : undefined,
  })

  return parseResponse(response)
}

// Whether the server measures its audience, as its last answer said: the
// demo's sign-in keeps it (src/demoSession.js).
let serverMeasuresAudience = false

export async function getAuthSession() {
  // The check itself says who is signed in now: the demo, or what the
  // server knows.
  showsDemo = false
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/session`, {
    credentials: 'same-origin',
    headers: getUniversityRequestHeaders(),
  })

  const payload = await parseJsonPayload(response)
  sessionSignal.mark(Boolean(payload?.authenticated))
  showsDemo = payload?.sessionMode === DEMO_SESSION_MODE
  if (!showsDemo) serverMeasuresAudience = payload?.analyticsEnabled === true

  if (!payload?.authenticated) {
    clearRecentLoginMarker()
  }

  return payload
}

// How long the demo's sign-in waits for the server to end a session left
// open (endServerSession).
const DEMO_SIGN_IN_PATIENCE_MS = 3000

// One sign-in at a time: a session still open in this browser (another
// tab's) ends when the demo starts, as a new login's cookie replaced the
// one before, and the desktop app forgets the login it kept
// (src-tauri/src/signin.rs). The server is told nothing of the demo;
// without an answer, the demo starts all the same.
async function endServerSession() {
  try {
    await fetch(`${ENT_AUTH_PREFIX}/logout`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: logoutHeaders({ desktop: isNativeApp() }),
      signal: AbortSignal.timeout(DEMO_SIGN_IN_PATIENCE_MS),
    })
  } catch {
    // No server, or a slow one.
  }
}

// `otp`: the one-time code, once the server asked for it ('mfa_required').
// `sendCode` ('sms', 'mail'): have a code sent instead; the answer is
// 'mfa_required' again, with `mfa.sent`.
export async function loginToEnt({ username, password, otp, sendCode }) {
  clearGradesCache()
  localStorage.removeItem(ADE_TIMETABLE_CACHE_KEY)

  // Signed out, the server routes the login to the university picked on the
  // login page (none on the neutral page: the default one).
  const university = getLoadedUniversityId()

  // The demo account never reaches a university, nor a server: its login is
  // checked here and sent nowhere, and the page signs in to it by itself
  // (src/demoRuntime.js), for the university it runs for.
  const demoUniversity = university ?? getDefaultUniversityId()
  if (universityConfig.features?.demo !== false && demoUniversity && isDemoCredentials(username, password)) {
    await endServerSession()
    signInToDemo({ university: demoUniversity, analyticsEnabled: serverMeasuresAudience })
    sessionSignal.restart(true)
    setRecentLoginMarker()
    return { authenticated: true, user: DEMO_ACCOUNT.preferred_username, sessionMode: DEMO_SESSION_MODE, university: demoUniversity }
  }

  // A login is the server's to answer, whatever another tab is signed in to.
  const response = await sendToServer(`${ENT_AUTH_PREFIX}/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...getUniversityRequestHeaders(),
    },
    body: JSON.stringify({ username, password, ...(otp ? { otp } : {}), ...(sendCode ? { sendCode } : {}), ...(university ? { university } : {}) }),
  })

  const payload = await parseJsonPayload(response)
  sessionSignal.restart(Boolean(payload?.authenticated))

  if (payload?.authenticated) {
    // Signed in for real: the demo ends, in every tab.
    signOutOfDemo()
    setRecentLoginMarker()
  } else {
    clearRecentLoginMarker()
  }

  return payload
}

// `expired`: signed out because the session expired, not by the student.
// The desktop app forgets the login it keeps only on the student's own
// sign-out (src-tauri/src/signin.rs).
export async function logoutFromEnt({ expired = false } = {}) {
  sessionSignal.mark(false)
  clearGradesCache()
  // Another account may sign in on this page.
  forgetSchoolCertificateStatus()
  localStorage.removeItem(ADE_TIMETABLE_CACHE_KEY)
  clearRecentLoginMarker()

  // The demo's sign-in is the page's: ended here, with what the visitor did
  // in it (src/demoRuntime.js).
  if (isDemoSignedIn()) {
    showsDemo = false
    signOutOfDemo()
    return { authenticated: false }
  }

  const response = await serverFetch(`${ENT_AUTH_PREFIX}/logout`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: logoutHeaders({ expired, desktop: isNativeApp() }),
  })

  const payload = await parseJsonPayload(response)
  return payload
}

// The home page's answers (the applications, Moodle's deadlines, the
// grades) take the university several seconds each. The server keeps the
// last one it got for the student and, past its freshness, gives it at
// once, marked with this header, while it asks the university again
// (back/crates/tafac-gateway, gateway/behind.rs). The page shows that old
// answer and asks once more with `?fresh=1`: that request waits for the
// answer that comes. Nothing of it rests in the browser.
const REFRESHING_HEADER = 'X-Tafac-Refreshing'
const FRESH_QUERY = '?fresh=1'

function isOldAnswer(response) {
  return response.headers.get(REFRESHING_HEADER) === '1'
}

// The applications the portal lists for the student, one list whatever the
// portal: { authenticated, sessionMode, apps: [{ id, title, description,
// url, iconUrl, category, favorite }] } (src/portalApps.js makes the tiles).
// `refreshing` on an old list: ask again with `fresh` for the one that comes.
export async function getApps({ fresh = false } = {}) {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/apps${fresh ? FRESH_QUERY : ''}`, {
    credentials: 'same-origin',
  })

  const payload = await parseJsonPayload(response)
  return isOldAnswer(response) && payload && typeof payload === 'object' ? { ...payload, refreshing: true } : payload
}

// Recent inbox messages for the "Mails récents" widget and the mail page.
// Server contract (GET /__ent_auth/mail/recent[?offset=N], N: the page start,
// newest first):
//   200 { authenticated: true, sessionMode, mail: {
//          unreadCount: number | null,   (null past the first page)
//          webmailHref: string | null,
//          messages: [{ id, from: { name, email }, subject, snippet,
//                       receivedAt (ISO 8601), unread: boolean, href: string | null }],
//          hasMore: boolean,             (older messages follow)
//        } }
//   200 { authenticated: false, mail: null }   no session
//   404 { ok: false, disabled: true, feature: 'mail' }   feature off for this university
//   500 { error }
// Normalized here to { status: 'ok' | 'disabled' | 'unauthenticated' | 'error', ... }.
// Certificat de scolarité (features.schoolCertificate). Kept for the page's
// lifetime: the server checks MonDossierWeb, which takes a moment. Asked
// once after sign-in (preloadSchoolCertificateStatus) so Réglages shows it at
// once; asks under way are shared.
let schoolCertificateStatus = null
let schoolCertificateRequest = null

export function getCachedSchoolCertificateStatus() {
  return schoolCertificateStatus
}

// { available: boolean, schoolYear?: '2026-2027' }. Never throws.
export function getSchoolCertificateStatus() {
  if (!universityConfig.features?.schoolCertificate) {
    return Promise.resolve({ available: false })
  }

  schoolCertificateRequest ??= (async () => {
    try {
      const response = await serverFetch(`${ENT_AUTH_PREFIX}/documents/school-certificate/status`, { credentials: 'same-origin' })
      const payload = await response.json().catch(() => null)
      schoolCertificateStatus = response.ok && payload?.available
        ? { available: true, schoolYear: payload.schoolYear ?? null }
        : { available: false }
    } catch {
      schoolCertificateStatus = { available: false }
    }
    return schoolCertificateStatus
  })().finally(() => {
    schoolCertificateRequest = null
  })
  return schoolCertificateRequest
}

// Right after sign-in, in the background: the status is ready when Réglages
// opens. Once per page (a known status isn't asked again).
export function preloadSchoolCertificateStatus() {
  if (schoolCertificateStatus || !universityConfig.features?.schoolCertificate) {
    return
  }
  void getSchoolCertificateStatus()
}

function forgetSchoolCertificateStatus() {
  schoolCertificateStatus = null
}

function getAttachmentFilename(contentDisposition, fallback) {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // Fall through to the plain name
    }
  }
  return contentDisposition?.match(/filename="([^"]+)"/i)?.[1] ?? fallback
}

// Saves the PDF under its real name. Throws an Error with a French,
// user-facing message.
export async function downloadSchoolCertificate() {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/documents/school-certificate`, { credentials: 'same-origin' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Certificat indisponible pour le moment.')
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = getAttachmentFilename(response.headers.get('content-disposition'), 'Certificat_de_scolarite.pdf')
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// A mail route's answer to a request without a valid session (401: the
// app's own session gone, or the CAS sign-in behind the webmail, found
// expired by the server). The app signs out on it (serverFetch); the calls
// below only tell it from a failure in what they answer.
function isSessionRefused(response) {
  return response.status === 401
}

// `query`: the mail page's search, the server's matches over the whole
// folder instead of its newest mails (no unread count then). `folder`: a
// folder id (getMailFolders), the inbox by default. `fresh`: past the
// server's short cache of the inbox (a refresh asked for).
// `signal`: an AbortSignal, for a search the typing has made pointless; an
// aborted request answers { status: 'aborted' }, for the caller to ignore.
export async function getRecentMail({ offset = 0, query = '', folder = null, fresh = false, signal } = {}) {
  if (!universityConfig.features?.mail) {
    return { status: 'disabled', unreadCount: null, webmailHref: null, messages: [] }
  }

  try {
    const params = new URLSearchParams()
    if (offset > 0) params.set('offset', String(offset))
    if (query) params.set('q', query)
    if (folder) params.set('folder', folder)
    if (fresh) params.set('fresh', '1')
    const search = params.toString()
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/recent${search ? `?${search}` : ''}`, {
      credentials: 'same-origin',
      signal,
    })
    const payload = await response.json().catch(() => null)

    if (payload?.disabled) {
      return { status: 'disabled', unreadCount: null, webmailHref: null, messages: [] }
    }

    if (isSessionRefused(response) || (response.ok && payload && !payload.authenticated)) {
      return { status: 'unauthenticated', unreadCount: null, webmailHref: null, messages: [] }
    }

    if (!response.ok || !payload?.mail) {
      throw createHttpError(payload?.error || `Mail request failed (${response.status}).`, response.status)
    }

    return {
      status: 'ok',
      unreadCount: Number.isFinite(payload.mail.unreadCount) ? payload.mail.unreadCount : null,
      webmailHref: payload.mail.webmailHref ?? null,
      messages: Array.isArray(payload.mail.messages) ? payload.mail.messages : [],
      hasMore: payload.mail.hasMore === true,
    }
  } catch (error) {
    // Aborted mid-answer too (its body unread, then « failed »): not an error.
    if (signal?.aborted) {
      return { status: 'aborted', unreadCount: null, webmailHref: null, messages: [] }
    }
    return {
      status: 'error',
      unreadCount: null,
      webmailHref: null,
      messages: [],
      error: error instanceof Error ? error.message : String(error),
      errorKind: getRequestErrorKind(error),
    }
  }
}

// One message for the mail page's reader (GET /__ent_auth/mail/message?id=…):
//   200 { message: { id, subject, from, replyTo, to, cc, receivedAt, unread,
//                    format: 'html' | 'text', html (already cleaned),
//                    remoteImages: number, truncated: boolean,
//                    attachments: [{ part, name, type, size, href }] } }
//   404 no such message, 401 no session, 500 { error }
// Throws an Error with `status` on any failure.
export async function getMailMessage(id) {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/message?id=${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.message) {
    throw createHttpError(payload?.error || `Message request failed (${response.status}).`, response.status)
  }
  return payload.message
}

// One thread for the mail page's reader (GET /__ent_auth/mail/thread):
// its mails, oldest first, as list rows ({ id, from, to, subject, snippet,
// receivedAt, unread, flagged, folder }). `folder`: the one it's read from
// (its trash or junk mails shown only there). Throws on a failure.
export async function getMailThread(id, { folder = null } = {}) {
  const params = new URLSearchParams({ id })
  if (folder) params.set('folder', folder)
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/thread?${params}`, { credentials: 'same-origin' })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(payload?.messages)) {
    throw createHttpError(payload?.error || `Thread request failed (${response.status}).`, response.status)
  }
  return payload.messages
}

// The mailbox's folders (GET /__ent_auth/mail/folders): [{ id, kind
// ('inbox', 'sent', 'drafts', 'junk', 'trash' or 'folder'), name, unread,
// count, parentId, path, depth }], the whole tree with parents before their
// children, the system ones first. `parentId` null and `depth` 0 at the
// top; `path` the webmail's names from the top (« Inbox/Moodle »). Null
// when they can't be read.
export async function getMailFolders() {
  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/folders`, { credentials: 'same-origin' })
    const payload = await response.json().catch(() => null)
    return response.ok && Array.isArray(payload?.folders) ? payload.folders : null
  } catch {
    return null
  }
}

// Acts on a whole folder (POST /__ent_auth/mail/folder-action { folder,
// action }): `read` marks all its mails read, `empty` deletes them for good
// (the trash, 3, and the junk folder, 4, only: the server refuses any
// other). Never throws: false when the webmail didn't take it.
export async function mailFolderAction(folder, action) {
  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/folder-action`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, action }),
    })
    return response.ok
  } catch {
    return false
  }
}

// The webmail preferences the mail page follows (GET /__ent_auth/mail/prefs):
// { markRead, attachments } — the seconds an open mail waits before it's
// marked read, -1 never, 0 at once; the composer's attachment limits
// ({ maxFileBytes, maxTotalBytes }, readAttachmentLimits). The webmail's
// default (at once) and the fallback limits when they can't be read.
export async function getMailPrefs() {
  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/prefs`, { credentials: 'same-origin' })
    const payload = await response.json().catch(() => null)
    const markRead = Number(payload?.markRead)
    return {
      markRead: response.ok && Number.isFinite(markRead) ? markRead : 0,
      attachments: readAttachmentLimits(response.ok ? payload?.attachments : null),
      identities: response.ok ? readMailIdentities(payload?.identities) : [],
    }
  } catch {
    return { markRead: 0, attachments: readAttachmentLimits(null), identities: [] }
  }
}

// The addresses « De : » offers ({ id, name, email }, the default first),
// checked: an id, a valid address.
function readMailIdentities(list) {
  return (Array.isArray(list) ? list : [])
    .filter((entry) => typeof entry?.id === 'string' && entry.id.length <= 64 && isValidAddress(entry.email))
    .slice(0, 20)
    .map((entry) => ({ id: entry.id, name: sanitizeDisplayName(typeof entry.name === 'string' ? entry.name : '', entry.email), email: entry.email }))
}

// The student's signatures (GET /__ent_auth/mail/signatures: the webmail's,
// which each identity takes, the custom one), for Réglages › Messagerie and
// the composer to show. `fresh`: the identities read again (Réglages).
// Never throws: { status: 'ok', data (readMailSignatures') } or { status:
// 'error' }.
export async function getMailSignatures({ fresh = false } = {}) {
  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/signatures${fresh ? '?fresh=1' : ''}`, { credentials: 'same-origin' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      return { status: 'error' }
    }
    return { status: 'ok', data: readMailSignatures(payload) }
  } catch {
    return { status: 'error' }
  }
}

// The custom signature written (POST /__ent_auth/mail/signature: kept in
// the webmail as its « Tafac » signature; '' removes it). Never throws: {
// status: 'ok', data } (the signatures as they are now) or { status:
// 'error', code: 'too-long' | 'limit' | 'rate' | 'expired' | 'failed' }.
const MAIL_SIGNATURE_CODES = {
  mail_signature_too_long: 'too-long',
  mail_signature_limit: 'limit',
  mail_signature_rate_limited: 'rate',
  mail_rate_limited: 'rate',
}

export async function saveMailSignature(text) {
  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/signature`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const payload = await response.json().catch(() => null)
    if (response.ok) return { status: 'ok', data: readMailSignatures(payload) }
    if (isSessionRefused(response)) {
      return { status: 'error', code: 'expired' }
    }
    return { status: 'error', code: MAIL_SIGNATURE_CODES[payload?.error] ?? 'failed' }
  } catch {
    return { status: 'error', code: 'failed' }
  }
}

// The send and draft routes' error codes, as the composer names them.
const MAIL_SEND_CODES = {
  mail_send_invalid_recipients: 'invalid-recipients',
  mail_send_no_recipient: 'no-recipient',
  mail_send_too_many_recipients: 'too-many-recipients',
  mail_send_upload_expired: 'upload-expired',
  mail_send_missing_reference: 'missing-reference',
  mail_send_too_large: 'too-large',
  mail_send_quota: 'quota',
  mail_send_rate_limited: 'rate',
  mail_rate_limited: 'rate',
  mail_send_invalid_identity: 'identity',
}

async function postMailCompose(path, body, { signal } = {}) {
  let response
  try {
    response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    // Nothing came back: sent or not, unknown (a send tries again with the
    // same uid, which Zimbra won't send twice).
    return { status: 'error', code: signal?.aborted ? 'aborted' : 'network' }
  }
  const payload = await response.json().catch(() => null)
  if (response.ok) return { status: 'ok', payload }
  if (isSessionRefused(response)) {
    return { status: 'error', code: 'expired' }
  }
  return {
    status: 'error',
    code: MAIL_SEND_CODES[payload?.error] ?? 'failed',
    retryAfter: Number(response.headers.get('Retry-After')) || null,
    invalid: Array.isArray(payload?.invalid) ? payload.invalid.filter((entry) => typeof entry === 'string').slice(0, 100) : [],
    aids: Array.isArray(payload?.aids) ? payload.aids.filter((entry) => typeof entry === 'string').slice(0, 50) : [],
  }
}

// Sends the composer's mail (POST /__ent_auth/mail/send, its body built by
// buildComposePayload, src/mailSendPayload.js). Never throws: { status:
// 'ok', partial, invalid } (partial: sent, but `invalid` refused) or {
// status: 'error', code ('invalid-recipients', 'no-recipient',
// 'too-many-recipients', 'upload-expired', 'missing-reference', 'too-large',
// 'quota', 'rate', 'identity', 'expired', 'network', 'failed'), retryAfter,
// invalid (addresses), aids (uploads to do again) }.
export async function sendMail(body) {
  const result = await postMailCompose('send', body)
  if (result.status !== 'ok') return result
  return { status: 'ok', partial: result.payload?.partial === true, invalid: Array.isArray(result.payload?.invalid) ? result.payload.invalid : [] }
}

// Saves the composer's draft (POST /__ent_auth/mail/draft): { status: 'ok',
// draft: { id, attachments: [{ messageId, part } | null], inlineImages: [{
// cid, messageId, part } | null] } } or a send's errors.
export async function saveMailDraft(body, { signal } = {}) {
  const result = await postMailCompose('draft', body, { signal })
  if (result.status !== 'ok') return result
  const draft = result.payload?.draft
  if (typeof draft?.id !== 'string' || !draft.id) return { status: 'error', code: 'failed' }
  return {
    status: 'ok',
    draft: {
      id: draft.id,
      attachments: Array.isArray(draft.attachments)
        ? draft.attachments.map((entry) => (typeof entry?.messageId === 'string' && typeof entry?.part === 'string' ? { messageId: entry.messageId, part: entry.part } : null))
        : [],
      inlineImages: Array.isArray(draft.inlineImages)
        ? draft.inlineImages.map((entry) => (typeof entry?.cid === 'string' && typeof entry?.messageId === 'string' && typeof entry?.part === 'string' ? { cid: entry.cid, messageId: entry.messageId, part: entry.part } : null))
        : [],
    },
  }
}

// A draft to resume in the composer (GET /__ent_auth/mail/draft?id=…):
// { id, to, cc, bcc, subject, html (cleaned by the server to what the
// editor holds), attachments: [{ part, name, size, contentType }],
// inlineImages: [{ cid, part, name, size, contentType, width, height,
// href }], droppedImages, identityId, origin: { kind, messageId } | null }.
// Throws on a failure.
export async function getMailDraft(id) {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/draft?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.draft) {
    throw createHttpError(payload?.error || `Draft request failed (${response.status}).`, response.status)
  }
  return payload.draft
}

// One file for the composer (POST /__ent_auth/mail/upload), sent as it is
// (the raw body, its name in Content-Disposition), relayed by the server to
// the webmail as it comes. An XMLHttpRequest, for its upload progress
// (fetch has none). `onProgress(sent, total)` as it goes. → { promise,
// abort }: the promise never rejects, it resolves to { status: 'ok',
// attachment: { aid, name, size, contentType } }, { status: 'aborted' }, or
// { status: 'error', code, retryAfter, maxBytes } (code: 'too-large',
// 'rate', 'retry' — the webmail session was renewed, try once more —,
// 'expired', 'failed').
export function uploadMailAttachment(file, { name, onProgress } = {}) {
  if (isDemoSignedIn()) return uploadDemoAttachment(file, { name, onProgress })

  const xhr = new XMLHttpRequest()
  const sentUnder = sessionSignal.current
  let settled = false
  const promise = new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    xhr.open('POST', `${ENT_AUTH_PREFIX}/mail/upload`)
    xhr.withCredentials = true
    xhr.responseType = 'text'
    xhr.setRequestHeader('Content-Type', normalizeAttachmentType(file.type))
    xhr.setRequestHeader('Content-Disposition', buildUploadDisposition(name ?? file.name))
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    })
    xhr.addEventListener('abort', () => finish({ status: 'aborted' }))
    xhr.addEventListener('error', () => finish({ status: 'error', code: 'failed' }))
    xhr.addEventListener('timeout', () => finish({ status: 'error', code: 'failed' }))
    xhr.addEventListener('load', () => {
      sessionSignal.note(sentUnder, (name) => xhr.getResponseHeader(name))
      let payload = null
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        payload = null
      }
      finish(readUploadAnswer(xhr.status, payload, { file, name, retryAfter: Number(xhr.getResponseHeader('Retry-After')) || null }))
    })
    xhr.send(file)
  })
  return {
    promise,
    abort: () => {
      if (!settled) xhr.abort()
    },
  }
}

// The upload route's answer, as uploadMailAttachment gives it.
function readUploadAnswer(status, payload, { file, name, retryAfter = null }) {
  const attachment = payload?.attachment
  if (status === 200 && typeof attachment?.aid === 'string' && attachment.aid) {
    return {
      status: 'ok',
      attachment: {
        aid: attachment.aid,
        name: sanitizeAttachmentName(attachment.name ?? name ?? file.name),
        size: Number.isSafeInteger(attachment.size) ? attachment.size : file.size,
        contentType: normalizeAttachmentType(attachment.contentType ?? file.type),
      },
    }
  }
  if (isSessionRefused({ status })) {
    return { status: 'error', code: 'expired' }
  }
  const code = status === 413 ? 'too-large'
    : status === 429 ? 'rate'
      : payload?.error === 'mail_upload_retry' ? 'retry'
        : 'failed'
  return { status: 'error', code, retryAfter, maxBytes: Number.isSafeInteger(payload?.maxBytes) ? payload.maxBytes : null }
}

// The demo account's file: read by the page and kept or dropped there
// (src/demoServer.js), nothing sent, the same answers.
function uploadDemoAttachment(file, { name, onProgress }) {
  let aborted = false
  const promise = uploadDemoFile(file, { name }).then(({ status, body }) => {
    if (aborted) return { status: 'aborted' }
    if (status === 200) onProgress?.(file.size, file.size)
    return readUploadAnswer(status, body, { file, name })
  }, () => ({ status: 'error', code: 'failed' }))
  return {
    promise,
    abort: () => {
      aborted = true
    },
  }
}

// Recipient suggestions for the composer's fields (GET
// /__ent_auth/mail/autocomplete?q=…): [{ name, email, kind ('contact',
// 'recent', 'directory' or 'group') }], best first. `query`: the text typed,
// normalizeRecipientQuery's (src/mailCompose.js). `signal`: an AbortSignal,
// for a query the typing has moved past. Never throws: { status: 'ok' |
// 'error' | 'aborted' | 'disabled', suggestions }. Not kept anywhere: the
// composer holds them in memory for as long as it's open.
export async function getMailRecipientSuggestions(query, { signal } = {}) {
  if (!universityConfig.features?.mail) return { status: 'disabled', suggestions: [] }
  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/autocomplete?${new URLSearchParams({ q: query })}`, {
      credentials: 'same-origin',
      signal,
    })
    const payload = await response.json().catch(() => null)
    if (signal?.aborted) return { status: 'aborted', suggestions: [] }
    if (!response.ok || !Array.isArray(payload?.suggestions)) return { status: 'error', suggestions: [] }
    return { status: 'ok', suggestions: payload.suggestions }
  } catch {
    return { status: signal?.aborted ? 'aborted' : 'error', suggestions: [] }
  }
}

// Acts on messages (POST /__ent_auth/mail/action { ids, action }): read,
// unread, flag, unflag, trash, spam, inbox (back from the trash or the junk
// folder, a trashed mail restored), move (to `folder`), delete (for good,
// mails in the trash or the junk folder only). `ids`: one id or a list.
// Never throws: false when the webmail didn't take it.
export async function mailAction(ids, action, { folder = null } = {}) {
  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/mail/action`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [].concat(ids), action, ...(folder ? { folder } : null) }),
    })
    return response.ok
  } catch {
    return false
  }
}

const GRADES_CACHE_KEY = 'l-ent:grades-cache'

// Upcoming Moodle deadlines for the "Échéances Moodle" widget.
// Server contract (GET /__ent_auth/moodle/deadlines):
//   200 { authenticated: true, sessionMode, deadlines: {
//          moodleHref: string | null,          // opens Moodle (dashboard/calendar)
//          items: [{ id, title, courseName, dueAt (ISO 8601),
//                    type: 'assign' | 'quiz' | 'forum' | 'other',
//                    overdue: boolean, submitted: boolean | null,
//                    href: string | null }],    // soonest first, ~6 max
//        } }
//   200 { authenticated: false, deadlines: null }   no session
//   404 { ok: false, disabled: true, feature: 'moodleDeadlines' }
//   500 { error }
// Normalized here to { status: 'ok' | 'disabled' | 'unauthenticated' | 'error', ... }.
// `refreshing` on an old list (above): ask again with `fresh` for the one
// that comes.
export async function getMoodleDeadlines({ fresh = false } = {}) {
  const empty = { moodleHref: null, items: [] }

  if (!universityConfig.features?.moodleDeadlines) {
    return { status: 'disabled', ...empty }
  }

  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/moodle/deadlines${fresh ? FRESH_QUERY : ''}`, {
      credentials: 'same-origin',
    })
    const payload = await response.json().catch(() => null)

    if (payload?.disabled) {
      return { status: 'disabled', ...empty }
    }

    if (!response.ok || !payload) {
      throw createHttpError(payload?.error || `Moodle request failed (${response.status}).`, response.status)
    }

    if (!payload.authenticated || !payload.deadlines) {
      return { status: 'unauthenticated', ...empty }
    }

    return {
      status: 'ok',
      moodleHref: payload.deadlines.moodleHref ?? null,
      items: Array.isArray(payload.deadlines.items) ? payload.deadlines.items : [],
      ...(isOldAnswer(response) ? { refreshing: true } : {}),
    }
  } catch (error) {
    return {
      status: 'error',
      ...empty,
      error: error instanceof Error ? error.message : String(error),
      errorKind: getRequestErrorKind(error),
    }
  }
}

// App bootstrap, the latest-grade widget and the sidebar pockets all ask for
// grades on load: share one in-flight request instead of hitting ScoDoc N times.
let gradesInflight = null

// Grades answers kept in memory for a few minutes, so dashboard ↔ "Mes notes"
// round trips and semester switches are instant. Memory only: grades are
// sensitive, nothing goes to storage (legacy storage caches are purged at
// boot). Cleared on login/logout by clearGradesCache().
const GRADES_MEMORY_TTL_MS = 5 * 60 * 1000
let gradesMemory = null
// semesterId → { at, promise, data? }
const semesterGradesMemory = new Map()

function isFreshGradesEntry(entry) {
  return Boolean(entry) && Date.now() - entry.at < GRADES_MEMORY_TTL_MS
}

function isUsableGradesAnswer(data) {
  return Boolean(data?.authenticated && data.grades && !data.error)
}

// The cached answer when there is a fresh one, without waiting.
export function peekGrades() {
  return isFreshGradesEntry(gradesMemory) ? gradesMemory.data : null
}

export function getGrades({ force = false } = {}) {
  if (!force && isFreshGradesEntry(gradesMemory)) {
    return Promise.resolve(gradesMemory.data)
  }

  if (!force && gradesInflight) {
    return gradesInflight
  }

  // Asked again past the cache: past the server's old answer too.
  gradesInflight = requestGrades({ fresh: force })
    .then(({ data, old }) => {
      gradesMemory = isUsableGradesAnswer(data) ? { at: Date.now(), data } : null
      if (old) void refreshGrades()
      return data
    })
    .finally(() => {
      gradesInflight = null
    })
  return gradesInflight
}

// The answer, and whether it is an old one the server gave while it asks
// ScoDoc again (`old`, above).
async function requestGrades({ fresh = false } = {}) {
  if (!universityConfig.features?.grades) {
    return { data: { authenticated: false, grades: null, disabled: true }, old: false }
  }

  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/grades${fresh ? FRESH_QUERY : ''}`, {
      credentials: 'same-origin',
    })

    return { data: await parseJsonPayload(response), old: isOldAnswer(response) }
  } catch (error) {
    return {
      data: {
        authenticated: false,
        grades: null,
        error: error instanceof Error ? error.message : String(error),
        errorKind: getRequestErrorKind(error),
      },
      old: false,
    }
  }
}

const gradesRefreshListeners = new Set()

// `listener(data)`: the grades that came after an old answer was shown.
// Returns what stops it.
export function onGradesRefreshed(listener) {
  gradesRefreshListeners.add(listener)
  return () => gradesRefreshListeners.delete(listener)
}

// The server gave the report it kept and asks ScoDoc meanwhile: the report
// that comes replaces it, for whoever shows grades. Without one (ScoDoc
// down, signed out since), what is shown stays.
async function refreshGrades() {
  const { data } = await requestGrades({ fresh: true })
  if (!isUsableGradesAnswer(data)) return
  gradesMemory = { at: Date.now(), data }
  for (const listener of gradesRefreshListeners) listener(data)
}

export async function getStudentProfilePictureMeta() {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/student-pic?meta=1&ts=${Date.now()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  })

  return parseJsonPayload(response)
}

export function clearGradesCache() {
  gradesMemory = null
  semesterGradesMemory.clear()
  distributionMemory.clear()
  localStorage.removeItem(GRADES_CACHE_KEY)
}

export function openGradesService() {
  if (!GRADES_LAUNCH_HREF || typeof window === 'undefined') {
    return
  }

  // The demo account has no session for the launch relay to sign in with:
  // the service's own address.
  window.open(isDemoSignedIn() ? GRADES_SERVICE_URL : GRADES_LAUNCH_HREF, '_blank', 'noopener,noreferrer')
}

async function requestSemesterGrades(semesterId) {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/grades/semester/${encodeURIComponent(semesterId)}`, {
    credentials: 'same-origin',
  })

  return parseJsonPayload(response)
}

// Relevé of one semester for the "Mes notes" page. Same answer as getGrades()
// ({ authenticated, grades }), grades being { relevé, absences, … }.
// Concurrent calls share one request; good answers stay in memory.
export function getSemesterGrades(semesterId) {
  const id = String(semesterId)
  const cached = semesterGradesMemory.get(id)
  if (isFreshGradesEntry(cached)) {
    return cached.promise
  }

  const entry = { at: Date.now(), promise: null, data: null }
  entry.promise = requestSemesterGrades(id).then((data) => {
    if (isUsableGradesAnswer(data)) {
      entry.data = data
    } else if (semesterGradesMemory.get(id) === entry) {
      semesterGradesMemory.delete(id)
    }
    return data
  }, (error) => {
    if (semesterGradesMemory.get(id) === entry) {
      semesterGradesMemory.delete(id)
    }
    throw error
  })
  semesterGradesMemory.set(id, entry)
  return entry.promise
}

export function peekSemesterGrades(semesterId) {
  const cached = semesterGradesMemory.get(String(semesterId))
  return isFreshGradesEntry(cached) ? cached.data : null
}

// Loads the other semesters in the background, one at a time so ScoDoc isn't
// hit in a burst. Already cached ones are skipped.
export async function prefetchSemesterGrades(semesterIds) {
  for (const id of semesterIds) {
    if (isFreshGradesEntry(semesterGradesMemory.get(String(id)))) continue
    await getSemesterGrades(id).catch(() => {})
  }
}

// Warms everything the "Mes notes" page needs (sidebar hover, tab press).
export function prefetchGradesPage() {
  if (!universityConfig.features?.grades) {
    return
  }

  getGrades()
    .then((data) => {
      const semesters = Array.isArray(data?.grades?.semestres) ? data.grades.semestres : []
      // The first answer already holds the newest semester; ScoDoc lists oldest first.
      const otherIds = semesters.slice(0, -1).map((semester) => semester.formsemestre_id).filter((id) => id != null).reverse()
      return prefetchSemesterGrades(otherIds)
    })
    .catch(() => {})
}

// { message: html | null }: the department notice ScoDoc shows above the relevé.
export async function getGradesDepartmentMessage(department) {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/grades/department-message?dep=${encodeURIComponent(department)}`, {
    credentials: 'same-origin',
  })

  return parseJsonPayload(response)
}

// `semesterId:evaluationId` → { at, promise }. Memory only, like the grades.
const distributionMemory = new Map()
const SCODOC_ID_PATTERN = /^\d{1,10}$/

async function requestEvaluationDistribution(semesterId, evaluationId) {
  try {
    const response = await serverFetch(
      `${ENT_AUTH_PREFIX}/grades/evaluation-distribution?semestre=${semesterId}&eval=${evaluationId}`,
      { credentials: 'same-origin' },
    )
    const data = await parseJsonPayload(response)
    if (!data?.authenticated) {
      return { status: 'error', reason: 'signed-out' }
    }
    if (data.status === 'unavailable') {
      return { status: 'unavailable', reason: typeof data.reason === 'string' ? data.reason : undefined }
    }
    const distribution = data.status === 'ok' ? readDistributionCounts(data) : null
    return distribution ? { status: 'ok', ...distribution } : { status: 'error', reason: 'invalid-answer' }
  } catch (error) {
    // 404: not an evaluation of this relevé (or of the demo).
    return error?.status === 404
      ? { status: 'unavailable', reason: 'unknown-evaluation' }
      : { status: 'error', reason: getRequestErrorKind(error) }
  }
}

// How the promo's grades spread on one evaluation, the passerelle's
// histogram. Never rejects; resolves to
//   { status: 'ok', counts: number[21] (bucket i = grades in [i, i+1), 20/20
//     in 20, see bucketOfGrade), total }
//   { status: 'unavailable', reason: 'disabled' (passerelle option off) |
//     'too-few' (under 6 grades) | 'hidden' (relevé unpublished or grades
//     hidden by the department) | 'unknown-evaluation' | 'invalid' }
//   { status: 'error', reason } (network, ScoDoc down, signed out).
// `semesterId` is a formsemestre id, anything else means the newest semester.
// Answers stay in memory as long as the grades do; errors are asked again.
export function getEvaluationDistribution({ semesterId, evaluationId } = {}) {
  if (!universityConfig.features?.grades) {
    return Promise.resolve({ status: 'unavailable', reason: 'disabled' })
  }

  const evaluation = String(evaluationId ?? '')
  if (!SCODOC_ID_PATTERN.test(evaluation)) {
    return Promise.resolve({ status: 'unavailable', reason: 'invalid' })
  }

  const semester = SCODOC_ID_PATTERN.test(String(semesterId ?? '')) ? String(semesterId) : 'current'
  const key = `${semester}:${evaluation}`
  const cached = distributionMemory.get(key)
  if (isFreshGradesEntry(cached)) {
    return cached.promise
  }

  const entry = { at: Date.now(), promise: null }
  entry.promise = requestEvaluationDistribution(semester, evaluation).then((result) => {
    if (result.status === 'error' && distributionMemory.get(key) === entry) {
      distributionMemory.delete(key)
    }
    return result
  })
  distributionMemory.set(key, entry)
  return entry.promise
}

export function getGradesReportPdfHref(semesterId, type = 'BUT') {
  return `${ENT_AUTH_PREFIX}/grades/report.pdf?semestre=${encodeURIComponent(semesterId)}&type=${type === 'DUT' ? 'DUT' : 'BUT'}`
}

// Downloads ScoDoc's PDF relevé as `fileName`. Fetched first so a failure
// (ScoDoc down, demo) throws instead of saving an error page as a ".pdf".
export async function downloadGradesReportPdf(semesterId, type, fileName) {
  const response = await serverFetch(getGradesReportPdfHref(semesterId, type), { credentials: 'same-origin' })
  if (!response.ok || !String(response.headers.get('content-type')).includes('application/pdf')) {
    throw new Error(`PDF request failed (${response.status})`)
  }

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Let the download start before the blob goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function parseGradeValue(val) {
  if (val == null || val === '~' || val === 'abs' || val === 'EXC' || val === '') return null
  const n = parseFloat(String(val).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function getCurrentGradesReleve(gradesData = null) {
  const semestres = Array.isArray(gradesData?.semestres) ? gradesData.semestres : []

  for (let index = semestres.length - 1; index >= 0; index -= 1) {
    const releve = semestres[index]?.['relevé']
    if (releve && typeof releve === 'object') {
      return releve
    }
  }

  return gradesData?.['relevé'] && typeof gradesData['relevé'] === 'object'
    ? gradesData['relevé']
    : null
}

function normalizeScodocGroupLabel(label) {
  return String(label ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeScodocPartitionLabel(label) {
  return normalizeScodocGroupLabel(label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function getScodocGroupKindFromText(label) {
  const normalizedLabel = normalizeScodocPartitionLabel(label)

  if (!normalizedLabel) {
    return null
  }

  if (/\btp\b/.test(normalizedLabel) || normalizedLabel.includes('travaux pratiques')) {
    return 'tp'
  }

  if (/\btd\b/.test(normalizedLabel) || normalizedLabel.includes('travaux diriges')) {
    return 'td'
  }

  return null
}

function inferScodocGroupKind(source, inheritedKind = null) {
  if (!source || typeof source !== 'object') {
    return inheritedKind
  }

  const candidates = [
    source.partition_name,
    source.partition?.partition_name,
    source.partition?.name,
    source.type,
    source.kind,
    source.category,
    source.name,
    source.label,
  ]

  for (const candidate of candidates) {
    const kind = getScodocGroupKindFromText(candidate)
    if (kind) {
      return kind
    }
  }

  return inheritedKind
}

function addScodocGroupCandidate(collector, label, kind = null) {
  const normalizedLabel = normalizeScodocGroupLabel(label)

  if (!normalizedLabel) {
    return
  }

  collector.push({
    label: normalizedLabel,
    kind,
  })
}

function collectScodocGroupCandidates(source, collector, inheritedKind = null) {
  if (!source) {
    return
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      if (typeof item === 'string') {
        addScodocGroupCandidate(collector, item, inheritedKind)
        continue
      }

      if (item && typeof item === 'object') {
        const itemKind = inferScodocGroupKind(item, inheritedKind)
        const namedValue = [
          item.group_name,
          item.nom,
          item.name,
          item.label,
          item.groupe,
        ].find((value) => typeof value === 'string' && value.trim())

        if (namedValue) {
          addScodocGroupCandidate(collector, namedValue, itemKind)
        }

        collectScodocGroupCandidates(item.children, collector, itemKind)
        collectScodocGroupCandidates(item.groups, collector, itemKind)
        collectScodocGroupCandidates(item.groupes, collector, itemKind)
      }
    }
    return
  }

  if (typeof source === 'object') {
    const sourceKind = inferScodocGroupKind(source, inheritedKind)

    if (typeof source.group_name === 'string' || typeof source.groupe === 'string') {
      addScodocGroupCandidate(collector, source.group_name ?? source.groupe, sourceKind)
    }

    for (const value of Object.values(source)) {
      collectScodocGroupCandidates(value, collector, sourceKind)
    }
  }
}

function scoreScodocGroupCandidate(candidate, kind) {
  const normalizedLabel = normalizeScodocGroupLabel(candidate?.label)
  const compactLabel = normalizedLabel.replace(/\s+/g, '').toUpperCase()
  const prefix = kind === 'td' ? 'TD' : 'TP'
  let score = 0

  if (candidate?.kind === kind) {
    score += 10
  } else if (candidate?.kind) {
    return -1
  }

  if (compactLabel.includes(prefix)) {
    if (compactLabel.startsWith(prefix)) {
      score += 6
    } else {
      score += 2
    }
  }

  if (new RegExp(`\\b${prefix}\\b`, 'i').test(normalizedLabel)) {
    score += 2
  }

  if (/\d/.test(compactLabel)) {
    score += 1
  }

  if (kind === 'tp' && /^\d+[A-Z]\d+$/i.test(compactLabel)) {
    score += 4
  }

  return score > 0 ? score : -1
}

function addUniqueScodocAlias(aliases, value) {
  const normalizedValue = normalizeScodocGroupLabel(value)

  if (!normalizedValue) {
    return
  }

  if (!aliases.some((alias) => normalizeScodocGroupLabel(alias).toLowerCase() === normalizedValue.toLowerCase())) {
    aliases.push(normalizedValue)
  }
}

function buildScodocGroupAliases(label, kind) {
  const aliases = []
  const normalizedLabel = normalizeScodocGroupLabel(label)
  const compactLabel = normalizedLabel.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

  addUniqueScodocAlias(aliases, normalizedLabel)

  const yearLetterTpMatch = compactLabel.match(/^(\d+)([A-Z])(\d+)$/)
  if (yearLetterTpMatch) {
    const [, year, tdLetter, tpNumber] = yearLetterTpMatch

    if (kind === 'td') {
      addUniqueScodocAlias(aliases, `${year}${tdLetter}`)
      addUniqueScodocAlias(aliases, `TD ${tdLetter}`)
      addUniqueScodocAlias(aliases, tdLetter)
    } else {
      addUniqueScodocAlias(aliases, `${year}${tdLetter}${tpNumber}`)
      addUniqueScodocAlias(aliases, `${tdLetter}${tpNumber}`)
      addUniqueScodocAlias(aliases, `TP ${tpNumber}`)
    }

    return aliases
  }

  const tdTpTextMatch = normalizedLabel.match(/\bTD\s*([A-Z0-9]+).*?\bTP\s*([A-Z0-9]+)\b/i)
  if (tdTpTextMatch) {
    if (kind === 'td') {
      addUniqueScodocAlias(aliases, `TD ${tdTpTextMatch[1]}`)
      addUniqueScodocAlias(aliases, tdTpTextMatch[1])
    } else {
      addUniqueScodocAlias(aliases, `TP ${tdTpTextMatch[2]}`)
      addUniqueScodocAlias(aliases, tdTpTextMatch[2])
    }
  }

  if (kind === 'tp') {
    for (const alias of buildParcoursTpAliases(normalizedLabel)) {
      addUniqueScodocAlias(aliases, alias)
    }
  }

  return aliases
}

function buildScodocTdAliasesFromTpLabel(label) {
  const aliases = []
  const normalizedLabel = normalizeScodocGroupLabel(label)
  const compactLabel = normalizedLabel.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const yearLetterTpMatch = compactLabel.match(/^(\d+)([A-Z])(\d+)$/)

  if (yearLetterTpMatch) {
    const [, year, tdLetter] = yearLetterTpMatch
    addUniqueScodocAlias(aliases, `${year}${tdLetter}`)
    addUniqueScodocAlias(aliases, `TD ${tdLetter}`)
    addUniqueScodocAlias(aliases, tdLetter)
  }

  const tdTpTextMatch = normalizedLabel.match(/\bTD\s*([A-Z0-9]+).*?\bTP\s*[A-Z0-9]+\b/i)
  if (tdTpTextMatch) {
    addUniqueScodocAlias(aliases, `TD ${tdTpTextMatch[1]}`)
    addUniqueScodocAlias(aliases, tdTpTextMatch[1])
  }

  return aliases
}

export function detectScodocGroupSelection(gradesData = null) {
  const releve = getCurrentGradesReleve(gradesData)
  const rawCandidates = []

  collectScodocGroupCandidates(releve?.semestre?.groupes, rawCandidates)
  collectScodocGroupCandidates(releve?.groupes, rawCandidates)
  collectScodocGroupCandidates(releve?.rang_group, rawCandidates)

  const labels = rawCandidates
    .map((candidate) => candidate.label)
    .filter((value, index, values) => values.indexOf(value) === index)
  const candidates = rawCandidates.filter((candidate, index) => (
    rawCandidates.findIndex((other) => (
      other.label === candidate.label && other.kind === candidate.kind
    )) === index
  ))
  let bestTdCandidate = null
  let bestTdScore = -1
  let bestTpCandidate = null
  let bestTpScore = -1

  for (const candidate of candidates) {
    const tdScore = scoreScodocGroupCandidate(candidate, 'td')
    if (tdScore > bestTdScore) {
      bestTdScore = tdScore
      bestTdCandidate = candidate
    }

    const tpScore = scoreScodocGroupCandidate(candidate, 'tp')
    if (tpScore > bestTpScore) {
      bestTpScore = tpScore
      bestTpCandidate = candidate
    }
  }

  const tpAliases = bestTpScore >= 0 ? buildScodocGroupAliases(bestTpCandidate.label, 'tp') : []
  const tdAliases = bestTdScore >= 0
    ? buildScodocGroupAliases(bestTdCandidate.label, 'td')
    : buildScodocTdAliasesFromTpLabel(bestTpCandidate?.label)

  return {
    labels,
    candidates,
    tdLabel: tdAliases[0] ?? null,
    tpLabel: tpAliases[0] ?? null,
    tdAliases,
    tpAliases,
    // The student's programme ("BUT MMI", "MMI"), to tell one programme's
    // "3B3" from another's in the planning (findAdeGroupForScodoc).
    programHints: [releve?.formation?.acronyme, releve?.dept_acronym ?? releve?.etudiant?.dept_acronym]
      .filter((value) => typeof value === 'string' && value.trim()),
  }
}

// A planning account never set up has no group to start the onboarding
// from: its ScoDoc group (detectScodocGroupSelection), searched in the
// planning, stands in for it (getAdeTree's `fallback`). Null when it can't
// be told for sure.
export async function findAdeGroupForScodoc(selection) {
  for (const alias of selection?.tpAliases ?? []) {
    const { results } = await searchAde(alias)
    const match = pickAdeGroupForAlias(results, alias, selection.programHints)
    if (match) {
      return match
    }
  }

  return null
}

function resolveGradesReleve(data) {
  if (data?.error) {
    return { error: String(data.error), errorKind: data.errorKind ?? 'other' }
  }

  if (!data?.authenticated) {
    return { error: r('Connecte-toi pour accéder aux notes', 'Connectez-vous pour accéder aux notes') }
  }

  if (data?.disabled) {
    return {
      error: data.unavailableMessage || GRADES_UNAVAILABLE_MESSAGE,
      disabled: true,
    }
  }

  const releve = getCurrentGradesReleve(data.grades)
  if (!releve) {
    return { error: 'Aucun relevé disponible', empty: true }
  }

  return { releve }
}

// Whether the student's relevé is a BUT one ('BUT'), another formation's
// ('other': licence pro, DUT…, which Tafac doesn't read yet), or unknown
// (null: no relevé, signed out, grades off). A relevé without a type is
// taken as BUT, as buildGradesReport does.
export async function getGradesFormation() {
  const resolved = resolveGradesReleve(await getGrades())
  if (resolved.error || !resolved.releve) return null
  const { type } = resolved.releve
  return !type || type === 'BUT' ? 'BUT' : 'other'
}

export async function getAverageGrade() {
  const data = await getGrades()

  const resolved = resolveGradesReleve(data)
  if (resolved.error) {
    return resolved
  }

  const summary = summarizeAverage(resolved.releve)
  if (!summary) {
    return { error: 'Aucune note disponible pour calculer la moyenne' }
  }

  return {
    average: summary.average.toFixed(2),
    promoAverage: summary.promoAverage != null ? summary.promoAverage.toFixed(2) : null,
    estimated: summary.estimated,
    debug: { source: summary.source },
  }
}

export async function getLatestGrade() {
  return findLatestGrade(await getGrades())
}

// The latest graded evaluation of a getGrades() answer, or { error }.
export function findLatestGrade(data) {
  const grades = listGradedEvaluations(data)
  if (!Array.isArray(grades)) {
    return grades
  }

  return grades[0] ?? { error: 'Aucune note trouvée', empty: true }
}

// Every graded evaluation of a getGrades() answer as the latest grade card
// shows one, the most recent first (ties in relevé order), or { error }.
export function listGradedEvaluations(data) {
  const resolved = resolveGradesReleve(data)
  if (resolved.error) {
    return resolved
  }

  const releve = resolved.releve
  // The UEs' ScoDoc colours (the card's wash) and the semester the relevé
  // is ("Mes notes" keys its read grades by it).
  const ueColors = Object.fromEntries(Object.entries(releve.ues ?? {}).map(([code, ue]) => [code, ue?.color ?? null]))
  const semesterId = listGradesSemesters(data.grades?.semestres)[0]?.id ?? 'current'
  // Every subject's title by module code, as "Mes notes" lists them to give
  // each its icon (assignSubjectIcons): the card gets the same one.
  const subjectTitles = [...Object.entries(releve.ressources ?? {}), ...Object.entries(releve.saes ?? {})]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, module]) => module?.titre ?? code)

  const grades = []

  for (const sectionKey of ['ressources', 'saes']) {
    const section = releve[sectionKey]
    if (!section) continue
    for (const [code, resource] of Object.entries(section)) {
      for (const evaluation of resource.evaluations ?? []) {
        const val = evaluation.note?.value
        // `date` is ScoDoc's deprecated alias of date_debut.
        const date = evaluation.date_debut ?? evaluation.date
        if (!date || parseGradeValue(val) == null) continue
        // ScoDoc sends evaluation notes already on /20; note.max is the
        // best grade of the promo, not the scale.
        grades.push({
          id: evaluation.id ?? null,
          semesterId,
          subjectTitles,
          ueColors,
          // What the grade counts for in each UE (its wash, its accent).
          weights: Object.entries(evaluation.poids ?? {})
            .map(([ue, weight]) => ({ ue, weight: Number(weight) || 0 })),
          date,
          description: evaluation.description || resource.titre || code,
          // "Rattrapage", "Session 2": labelled on the card as on "Mes notes".
          typeLabel: evaluationTypeLabel(evaluation.evaluation_type),
          note: val,
          noteSur: '20',
          noteMoy: evaluation.note?.moy ?? null,
          resource: code,
          resourceTitle: resource.titre ?? code,
          coef: evaluation.coef ?? null,
        })
      }
    }
  }

  // Stable: equal dates keep the relevé's order.
  return grades.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0))
}

// ============================================================================
// The planning (tonAPI's model)
// ============================================================================
//
// The planning is answered by the Rust gateway with tonAPI's own answers, as
// tonAPI's server gives them on its /v1 routes of the same names (back/:
// gateway/planning.rs): { data, meta }, and a refusal as a problem
// ({ code, title, detail, link }, `error.code` here).
//
//   GET timetable?from=&to=&resources=   tonAPI's Course list
//   GET timetable/tree?kind=             its ResourceNode tree, `selected`
//                                        on the groups the student follows
//   GET timetable/resources?kind=&q=     its TimetableResource list
//
// What the page makes of them is its own: the group picker's tree and the
// rooms and staff (src/planningTree.js), a class as the page shows it
// (src/planningEvents.js: classOfCourse).

// The on-device timetable the planning's routes kept before (/ade/timetable),
// still cleared for the devices that have one.
const ADE_TIMETABLE_CACHE_KEY = 'l-ent:ade-timetable-cache'

function planningQuery(params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const written = Array.isArray(value) ? value.join(',') : value
    if (written != null && written !== '') query.set(key, String(written))
  }
  return query.size ? `?${query}` : ''
}

async function getPlanningAnswer(path, params = {}, { signal } = {}) {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/${path}${planningQuery(params)}`, {
    credentials: 'same-origin',
    signal,
  })
  return parseJsonPayload(response)
}

// The classes of `from` to `to` (both included, YYYY-MM-DD): the student's
// own, or those of `resources` (ids of the tree: groups, a room, a teacher).
// → { data: Course[], meta }.
export function getTimetable({ from, to, resources = [], signal } = {}) {
  return getPlanningAnswer('timetable', { from, to, resources }, { signal })
}

// The tree of the university's resources of `kinds` ('group', 'teacher',
// 'room'; all without any). → { data: ResourceNode[], meta }.
export function getTimetableTree({ kinds = [] } = {}) {
  return getPlanningAnswer('timetable/tree', { kind: kinds })
}

// The resources whose name has the words of `q`, each with its path.
// → { data: TimetableResource[], meta }.
export function getTimetableResources({ kinds = [], q = '', limit } = {}) {
  return getPlanningAnswer('timetable/resources', { kind: kinds, q: q.trim(), limit })
}

// The trees asked this visit, by kind (the groups' a few hundred KB at
// Rennes, its rooms' and staff's more): asked once, each, for the account.
const planningTrees = new Map()

function loadTree(kind) {
  if (!planningTrees.has(kind)) {
    const promise = getTimetableTree({ kinds: [kind] }).then((answer) => (Array.isArray(answer?.data) ? answer.data : []))
    promise.catch(() => planningTrees.delete(kind))
    planningTrees.set(kind, promise)
  }
  return planningTrees.get(kind)
}

// A personal timetable (planning.personal: TEMPO) has no group to pick: the
// student's own, « Mon emploi du temps », which the page adopts as its group.
// Its id has no digit, so it is never asked as a resource.
const PERSONAL_PLANNING_SELECTION = Object.freeze({
  resourceId: 'personal',
  label: 'Mon emploi du temps',
  parentResourceId: null,
  parentLabel: null,
  contextLabel: 'Mon emploi du temps',
  programResourceId: null,
  programLabel: null,
  yearResourceId: null,
  yearLabel: null,
  tdResourceId: null,
  tdLabel: null,
  tpResourceId: null,
  tpLabel: null,
})

// The groups' tree as the group picker reads it (App.jsx), focused on
// `etabsVets` (a node of it), or on the student's own group; `fallback`:
// the group standing in for the student's own when they follow none
// (findAdeGroupForScodoc). → { authenticated, tree }.
export async function getAdeTree(etabsVets = '', { fallback = '' } = {}) {
  if (universityConfig.planning?.personal === true) {
    return {
      authenticated: true,
      tree: { root: adeTreeRoot([]), currentPathIds: [], selectionPathIds: [], selectionSchema: 'planning-personal', defaultSelection: { ...PERSONAL_PLANNING_SELECTION } },
    }
  }
  const groups = await loadTree('group')
  const tree = focusAdeTree(adeTreeRoot(groups), {
    requestedResourceId: etabsVets,
    fallbackResourceId: fallback,
    ownResources: followedGroups(groups),
  })
  return { authenticated: true, tree }
}

// ScoDoc's TP group under a year of the groups' tree (`yearResourceId`),
// with its TD: adeGroupMatch's findTpUnderYear. → { tp, td } | null.
export async function findScodocTpInYear(yearResourceId, tpAliases, options = {}) {
  const year = findTreePath(adeTreeRoot(await loadTree('group')), yearResourceId)?.at(-1)
  return year ? findTpUnderYear(year, tpAliases, options) : null
}

// « Salles et personnels »: the rooms, staff and groups of the tree, those
// of `kinds` ('room', 'person', 'group'), as { groups, items }
// (src/planningTree.js's buildDirectory). `supported`: false where the
// planning service has no tree to give.
const DIRECTORY_TREE_KINDS = { room: 'room', person: 'teacher', group: 'group' }

export async function getAdeDirectory(kinds = Object.keys(DIRECTORY_TREE_KINDS)) {
  try {
    const trees = await Promise.all(kinds.map((kind) => DIRECTORY_TREE_KINDS[kind]).filter(Boolean).map(loadTree))
    return { authenticated: true, supported: true, directory: buildDirectory(trees.flat()) }
  } catch (error) {
    if (['not_implemented', 'service_absent'].includes(error?.code)) {
      return { authenticated: true, supported: false, directory: null }
    }
    throw error
  }
}

// The student groups whose name has `query`, as the planning's search gives
// them ({ id, name, path }: the path from « Ressources », dot-separated):
// the groups' tree searched here, a hundred at most.
export async function searchAde(query) {
  const needle = String(query ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr')
  if (!needle) {
    return { results: [] }
  }
  const results = []
  const walk = (node) => {
    if (results.length >= 100) return
    if (node.children.length === 0 && node.name.toLocaleLowerCase('fr').includes(needle)) {
      results.push({ id: node.id, name: node.name, path: node.path, family: 'trainee' })
    }
    node.children.forEach(walk)
  }
  walk(adeTreeRoot(await loadTree('group')))
  return { results }
}

// The legacy on-device timetable, kept by the planning's routes before
// (signed out, or the student's group changed).
export function clearAdeTimetableCache() {
  localStorage.removeItem(ADE_TIMETABLE_CACHE_KEY)
}

// The trees asked this visit: another student's are not theirs (signed out,
// or the signed-in student changed).
export function forgetPlanningTrees() {
  planningTrees.clear()
}

// ============================================================================
// ENT Portal API
// ============================================================================

export async function getAccountInfo() {
  const response = await serverFetch(`${ENT_AUTH_PREFIX}/account`, {
    credentials: 'same-origin',
  })

  return parseJsonPayload(response)
}
