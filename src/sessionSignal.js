// The server's word that the session is no longer valid (server/
// sessionExpiry): `X-Tafac-Session: expired` on an answer. Heard only from
// a request sent while signed in, under the sign-in still current, and
// once per sign-in: the requests failing together sign out once (App's
// onSessionExpired). A request without that header never signs out,
// whatever it failed with (a network error, a timeout, a 5xx). Used by
// src/entApi.js; pure, for tests/sessionSignal.test.js.

export const SESSION_HEADER = 'X-Tafac-Session'
export const SESSION_EXPIRED = 'expired'

export function createSessionSignal() {
  // The current sign-in, 0 signed out.
  let signInId = 0
  let lastSignInId = 0
  const listeners = new Set()

  function expire() {
    if (!signInId) return false
    signInId = 0
    for (const listener of listeners) listener()
    return true
  }

  return {
    // The sign-in a request leaves under, for note().
    get current() {
      return signInId
    },
    // Signed in (a session confirmed, kept if it already was) or out.
    mark(authenticated) {
      if (!authenticated) signInId = 0
      else if (!signInId) signInId = ++lastSignInId
    },
    // A sign-in that starts over: what was asked before it is heard no more.
    restart(authenticated) {
      signInId = 0
      if (authenticated) signInId = ++lastSignInId
    },
    // An answer to a request sent under `sentUnder`; `readHeader(name)`
    // reads its headers. → whether it signed out.
    note(sentUnder, readHeader) {
      if (!sentUnder || sentUnder !== signInId) return false
      if (readHeader(SESSION_HEADER) !== SESSION_EXPIRED) return false
      return expire()
    },
    // The server's answer heard elsewhere (the desktop app's Moodle view,
    // src/components/MoodlePage.jsx). → whether it signed out.
    expire,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// The sign-out's headers. The desktop app keeps the student's login to sign
// in again by itself (src-tauri/src/signin.rs) and forgets it on the
// student's own sign-out only: one the session's expiry made says so.
export const LOGOUT_REASON_HEADER = 'X-Tafac-Logout'

export function logoutHeaders({ expired = false, desktop = false } = {}) {
  return expired && desktop ? { [LOGOUT_REASON_HEADER]: 'expired' } : {}
}
