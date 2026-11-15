// A mail kept when the session expired (App's sign-out): the one being
// written in the composer, and the one waiting to go or that failed going.
// The session is already gone then, so it can't reach Brouillons: it waits
// in this tab's memory only (never stored), for the same student once
// signed in again, and is dropped for anyone else and on a sign-out of
// their own. The mail page opens it again (MailPage), where it saves to
// Brouillons as any change does.

// { user, snapshots }: the composer snapshots (MailComposer's snapshot(),
// onSend's shape), the first opened again, the others saved to Brouillons.
let kept = null
// The open composer's snapshot, while the mail page is there: null when
// none is open or nothing was changed in it.
let readOpenComposer = null

// The mail page, while mounted. → unregister.
export function registerOpenComposer(read) {
  readOpenComposer = read
  return () => {
    if (readOpenComposer === read) readOpenComposer = null
  }
}

export function snapshotOpenComposer() {
  try {
    return readOpenComposer?.() ?? null
  } catch {
    return null
  }
}

// → whether anything is kept.
export function keepMail(user, snapshots) {
  const list = snapshots.filter(Boolean)
  kept = user && list.length ? { user, snapshots: list } : null
  return Boolean(kept)
}

// Signed in: kept only for the student it was kept for.
export function keepMailFor(user) {
  if (kept && kept.user !== user) kept = null
}

export function hasKeptMail(user) {
  return Boolean(kept) && kept.user === user
}

// The mail page takes it, once.
export function takeKeptMail() {
  const snapshots = kept?.snapshots ?? []
  kept = null
  return snapshots
}

export function dropKeptMail() {
  kept = null
}
