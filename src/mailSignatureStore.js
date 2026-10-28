import { useEffect, useSyncExternalStore } from 'react'
import { getMailSignatures, saveMailSignature } from './entApi'
import { isSignatureKind } from './mailSignatureChoice'

// The signature's choices, shared by Réglages › Messagerie and the
// composer (both follow a change made in the other), and the student's
// signatures as the server last gave them.
//
// The choices are the device's (a preference, not a mail's content), in
// localStorage: on or off in SIGNATURE_KEY (the composer's, from before
// the kinds: 'none' off, else on), the kind in SIGNATURE_KIND_KEY (absent:
// the automatic one). Another tab's change comes through `storage`.
const SIGNATURE_KEY = 'l-ent:mail-signature'
const SIGNATURE_KIND_KEY = 'l-ent:mail-signature-kind'

function readPrefs() {
  try {
    const kind = localStorage.getItem(SIGNATURE_KIND_KEY)
    return { enabled: localStorage.getItem(SIGNATURE_KEY) !== 'none', kind: isSignatureKind(kind) ? kind : 'auto' }
  } catch {
    return { enabled: true, kind: 'auto' }
  }
}

let prefs = readPrefs()
const prefsListeners = new Set()

function setPrefs(next) {
  prefs = { ...prefs, ...next }
  try {
    if (prefs.enabled) localStorage.removeItem(SIGNATURE_KEY)
    else localStorage.setItem(SIGNATURE_KEY, 'none')
    if (prefs.kind === 'auto') localStorage.removeItem(SIGNATURE_KIND_KEY)
    else localStorage.setItem(SIGNATURE_KIND_KEY, prefs.kind)
  } catch {
    // Storage unavailable: the choice lasts until the page reloads.
  }
  for (const listener of prefsListeners) listener()
}

function subscribePrefs(listener) {
  prefsListeners.add(listener)
  const onStorage = (event) => {
    if (event.key !== SIGNATURE_KEY && event.key !== SIGNATURE_KIND_KEY && event.key !== null) return
    prefs = readPrefs()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    prefsListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export const setMailSignatureEnabled = (enabled) => setPrefs({ enabled: Boolean(enabled) })
export const setMailSignatureKind = (kind) => setPrefs({ kind: isSignatureKind(kind) ? kind : 'auto' })

// { enabled, kind }.
export function useMailSignaturePrefs() {
  return useSyncExternalStore(subscribePrefs, () => prefs, () => prefs)
}

// ── The student's signatures (GET /mail/signatures) ──

// { status: 'idle' | 'loading' | 'ready' | 'error', data }: the last answer
// kept while the next one comes (each Réglages page and each composer asks
// again: a signature changed in the webmail meanwhile shows).
let remote = { status: 'idle', data: null }
let pending = null
const remoteListeners = new Set()

function setRemote(next) {
  remote = next
  for (const listener of remoteListeners) listener()
}

function subscribeRemote(listener) {
  remoteListeners.add(listener)
  return () => remoteListeners.delete(listener)
}

export function refreshMailSignatures({ fresh = false } = {}) {
  if (pending) return pending
  if (!remote.data) setRemote({ status: 'loading', data: null })
  pending = getMailSignatures({ fresh }).then((result) => {
    pending = null
    setRemote(result.status === 'ok' ? { status: 'ready', data: result.data } : { status: remote.data ? 'ready' : 'error', data: remote.data })
  })
  return pending
}

// The signatures, asked for again when the caller mounts (`enabled`).
export function useMailSignatures({ enabled = true, fresh = false } = {}) {
  useEffect(() => {
    if (enabled) void refreshMailSignatures({ fresh })
  }, [enabled, fresh])
  return useSyncExternalStore(subscribeRemote, () => remote, () => remote)
}

// The custom signature written: the list as the server has it afterwards.
// → saveMailSignature's result.
export async function writeCustomMailSignature(text) {
  const result = await saveMailSignature(text)
  if (result.status === 'ok') setRemote({ status: 'ready', data: result.data })
  return result
}
