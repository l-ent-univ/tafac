// Back and forward inside the app (browser buttons, trackpad swipes, mouse
// side buttons, Android's back gesture): each page switch, each UE opened
// full page and each mail opened in the reader is a history entry. What the entry shows lives in its state
// (`tafac`), the URL doesn't change (its fragment belongs to the settings
// transfer link). A reload keeps the entry's state, so it lands where it was.
const PAGES = new Set(['dashboard', 'grades', 'planning', 'mail'])

// A mail entry belongs to the sign-in that wrote it. Logging out doesn't
// reload the page, so the tab's history still holds the previous student's
// entries: back after someone else signs in must not reopen their mail (by
// id, from whatever is cached). Each sign-in gets a random marker, written
// into its mail entries; an entry with another marker (or none) opens the
// mail page without a mail. The marker lives in sessionStorage with the user
// it was made for, so a reload keeps the same sign-in's entries working, and
// a new marker is made whenever the user differs (logout, another account
// signing in after an expired session, a reload under another account).
// Before any sign-in is bound (signed out, tests) there's nothing to compare
// against: the mail page isn't shown then anyway.
const HISTORY_SESSION_KEY = 'l-ent:history-session'
let historySession = readStoredHistorySession()

function readStoredHistorySession() {
  try {
    const stored = JSON.parse(globalThis.sessionStorage?.getItem(HISTORY_SESSION_KEY) ?? 'null')
    if (typeof stored?.user === 'string' && typeof stored?.marker === 'string') return stored
  } catch {
    // Unreadable or no storage: unbound until the next sign-in.
  }
  return { user: null, marker: null }
}

function newHistoryMarker() {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// The signed-in user (null once signed out). True when that's a change: a
// new marker was made, and what belonged to the previous sign-in (the mail
// read cache) should go too. Idempotent, cheap: App calls it while rendering,
// before the mail page reads its entry.
export function bindHistorySession(user) {
  const owner = user ? String(user) : null
  if (historySession.user === owner && (owner === null || historySession.marker)) return false
  historySession = { user: owner, marker: owner ? newHistoryMarker() : null }
  try {
    if (owner) globalThis.sessionStorage?.setItem(HISTORY_SESSION_KEY, JSON.stringify(historySession))
    else globalThis.sessionStorage?.removeItem(HISTORY_SESSION_KEY)
  } catch {
    // No storage: the marker lasts until a reload, entries then stop opening their mail.
  }
  return true
}

function isCurrentSession(nav) {
  return historySession.marker === null || nav?.session === historySession.marker
}

export function readHistoryNav(state = globalThis.history?.state) {
  const nav = state?.tafac
  return {
    page: PAGES.has(nav?.page) ? nav.page : 'dashboard',
    ue: nav?.page === 'grades' && typeof nav?.ue === 'string' ? nav.ue : null,
    mail: nav?.page === 'mail' && typeof nav?.mail === 'string' && isCurrentSession(nav) ? nav.mail : null,
  }
}

// Other keys of the entry's state are kept. An entry with a mail carries the
// sign-in's marker (see bindHistorySession).
export function writeHistoryNav(nav, { replace = false, history = globalThis.history } = {}) {
  if (!history) return
  try {
    const tafac = { page: nav.page, ue: nav.ue ?? null, mail: nav.mail ?? null }
    if (tafac.mail) tafac.session = historySession.marker
    const state = { ...(history.state ?? {}), tafac }
    if (replace) history.replaceState(state, '')
    else history.pushState(state, '')
  } catch {
    // No history (sandboxed frame): back and forward just leave the app.
  }
}
