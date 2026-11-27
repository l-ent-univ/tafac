// The demo account's sign-in, kept by the page. The demo never reaches a
// university, and no server either: its login is checked here
// (src/demoAccount.js: isDemoCredentials) and sent nowhere, and while this
// marker is there the page answers its own requests (src/demoServer.js).
//
// In localStorage, as the session cookie it stands in for was the
// browser's: every tab is in the demo, a reload or the browser (or the
// app) started again keeps it, a sign-out ends it in every tab, and it
// lasts thirty days at most, the cookie's own lifetime. It says nothing of
// a person: when it started, the university the page ran for, and whether
// that server measures its audience (Réglages then shows the same
// sections; nothing is measured in the demo, src/analytics.js). What a
// visitor does in the demo's mailbox is kept apart, for the tab only
// (src/demoMail.js).
//
// Pure but for the storage and the clock passed in:
// tests/demoSession.test.js.

export const DEMO_SESSION_KEY = 'l-ent:demo-session'
export const DEMO_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Where storage is blocked (some private windows), the demo lasts until a
// reload.
let memorySession = null

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isCurrent(session, now) {
  return Boolean(session)
    && Number.isFinite(session.startedAt)
    && session.startedAt <= now
    && now - session.startedAt <= DEMO_SESSION_TTL_MS
}

function readStored(storage) {
  const stored = JSON.parse(storage.getItem(DEMO_SESSION_KEY) ?? 'null')
  if (!stored || typeof stored !== 'object') return null
  return {
    startedAt: Number(stored.startedAt),
    university: typeof stored.university === 'string' && stored.university ? stored.university : null,
    analyticsEnabled: stored.analyticsEnabled === true,
  }
}

// The demo's sign-in, or null: none, one past its lifetime, one unreadable.
export function readDemoSession({ storage = defaultStorage(), now = Date.now() } = {}) {
  let session = memorySession
  if (storage) {
    try {
      session = readStored(storage)
    } catch {
      // Storage blocked, or what it holds isn't ours: this page's own.
    }
  }
  return isCurrent(session, now) ? session : null
}

// Signed in to the demo, for the university the page runs for.
export function startDemoSession({ university = null, analyticsEnabled = false } = {}, { storage = defaultStorage(), now = Date.now() } = {}) {
  const session = { startedAt: now, university: university || null, analyticsEnabled: analyticsEnabled === true }
  memorySession = session
  try {
    storage?.setItem(DEMO_SESSION_KEY, JSON.stringify(session))
  } catch {
    // Storage full or blocked: kept in memory.
  }
  return session
}

// Signed out of the demo, or signed in for real: every tab leaves it.
export function endDemoSession({ storage = defaultStorage() } = {}) {
  memorySession = null
  try {
    storage?.removeItem(DEMO_SESSION_KEY)
  } catch {
    // Nothing was kept there.
  }
}

// Another tab started or ended the demo (a `storage` event of this key).
// → unsubscribe.
export function onDemoSessionChange(listener, target = globalThis.window) {
  const onStorage = (event) => {
    if (event.key === DEMO_SESSION_KEY || event.key === null) listener()
  }
  target?.addEventListener?.('storage', onStorage)
  return () => target?.removeEventListener?.('storage', onStorage)
}
