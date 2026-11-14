import { useSyncExternalStore } from 'react'
import { isDesktopApp } from './desktopApp.js'

// Desktop app: its own updates (src-tauri/src/updater.rs, docs/DESKTOP.md).
// The app checks, downloads and installs; the page shows it and asks,
// through the app's own routes (src-tauri/src/desktop.rs).
//
// The state, { current, phase, version, required, downloaded, total, failed,
// download }:
// - current: the running version; version: the newer one announced.
// - phase: 'idle', 'downloading', 'ready' (downloaded and checked: installed
//   when the app quits, or on « Redémarrer »), 'installing'.
// - required: the running version can't sign in any more (below
//   latest.json's `minimum`): « Mise à jour nécessaire » takes the app's place
//   (DesktopUpdateLayer).
// - downloaded, total: bytes (total unknown: null).
// - failed: the install the student asked for didn't happen.
// - download: where to get the new version by hand (its installer), if
//   latest.json says; offered when the install failed.
// - enabled: this build looks for updates (a local 0.0.0 build doesn't).
// - checking: a check is under way; checked: when the last one got an
//   answer (ms since 1970, null before).
// It comes with the page's first request and then as `tafac:update` events;
// the answer to the menu's « Rechercher les mises à jour… » comes as a
// `tafac:update-note` event, its detail { kind, version }.

const HEADERS = { 'X-Tafac-Desktop': '1' }
const STATE_EVENT = 'tafac:update'
const NOTE_EVENT = 'tafac:update-note'
const PHASES = new Set(['idle', 'downloading', 'ready', 'installing'])
// The app answers the page's first request within a few seconds of its own
// launch; past this, the page starts without an answer.
const FIRST_ANSWER_TIMEOUT_MS = 6000
const MEGABYTE = 1024 * 1024

// What the app sent, in the shapes the page counts on; null if it isn't one.
export function parseUpdateState(value) {
  if (!value || typeof value !== 'object' || typeof value.current !== 'string' || !PHASES.has(value.phase)) return null
  const bytes = (count) => (Number.isFinite(count) && count >= 0 ? count : 0)
  return {
    current: value.current,
    phase: value.phase,
    version: typeof value.version === 'string' ? value.version : null,
    required: value.required === true,
    downloaded: bytes(value.downloaded),
    total: bytes(value.total) || null,
    failed: value.failed === true,
    download: typeof value.download === 'string' && value.download.startsWith('https://') ? value.download : null,
    // An app from before these fields looked for updates.
    enabled: value.enabled !== false,
    checking: value.checking === true,
    checked: Number.isFinite(value.checked) && value.checked > 0 ? value.checked : null,
  }
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

// When the last check got an answer: « à l’instant », « il y a 5 min »,
// « il y a 3 h », then the day. null before any.
export function describeChecked(checked, now = Date.now()) {
  if (!checked) return null
  const elapsed = Math.max(0, now - checked)
  if (elapsed < MINUTE) return 'à l’instant'
  if (elapsed < HOUR) return `il y a ${Math.floor(elapsed / MINUTE)}\u00a0min`
  if (elapsed < 24 * HOUR) return `il y a ${Math.floor(elapsed / HOUR)}\u00a0h`
  return `le ${new Date(checked).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
}

// « 81 Mo »: whole megabytes.
export function describeSize(bytes) {
  return `${Math.round(bytes / MEGABYTE)} Mo`
}

// « 34 Mo sur 81 Mo », or « 34 Mo » while the size isn't known.
export function describeDownload({ downloaded, total }) {
  return total ? `${describeSize(Math.min(downloaded, total))} sur ${describeSize(total)}` : describeSize(downloaded)
}

// How far the download is, from 0 to 1 (0 while the size isn't known).
export function downloadProgress({ downloaded, total }) {
  return total ? Math.min(1, downloaded / total) : 0
}

// The menu's answer in words; null for one the page doesn't know.
export function describeUpdateNote(note) {
  switch (note?.kind) {
    case 'current':
      return `Tafac est à jour · ${note.version}`
    case 'downloading':
      return `Téléchargement de Tafac ${note.version}`
    case 'ready':
      return `Mise à jour prête · ${note.version}`
    case 'unreachable':
      return 'Impossible de rechercher les mises à jour'
    default:
      return null
  }
}

let state = null
const listeners = new Set()

function setState(next) {
  if (!next) return
  state = next
  listeners.forEach((listener) => listener())
}

// `listener` is called on every change; read the state with
// getDesktopUpdate().
export function subscribeDesktopUpdate(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getDesktopUpdate() {
  return state
}

let listening = false
function listen(win) {
  if (listening) return
  listening = true
  win.addEventListener(STATE_EVENT, (event) => setState(parseUpdateState(event.detail)))
}

// The state as the page starts, null off the app. The app answers once its
// launch check has (a few seconds at most), so `required` is known before
// the page asks the university anything (main.jsx).
export async function loadDesktopUpdate(win = window) {
  if (!isDesktopApp()) return null
  listen(win)
  try {
    const response = await fetch('/__desktop/update/state', {
      method: 'POST',
      headers: HEADERS,
      signal: AbortSignal.timeout(FIRST_ANSWER_TIMEOUT_MS),
    })
    if (response.ok) setState(parseUpdateState(await response.json()))
  } catch {
    // No answer: the page goes on, the app's events will say.
  }
  return state
}

// null off the app, and until the app has said.
export function useDesktopUpdate() {
  return useSyncExternalStore(subscribeDesktopUpdate, getDesktopUpdate, () => null)
}

// « Redémarrer », « Mettre à jour »: the update now (downloaded first if it
// isn't yet), then the app again. Never throws; what happens comes back as
// the state.
export function installDesktopUpdate() {
  if (!isDesktopApp()) return
  // A new try: the last one's failure goes now, not with the app's answer.
  if (state?.failed) setState({ ...state, failed: false })
  void fetch('/__desktop/update/install', { method: 'POST', headers: HEADERS }).catch(() => {})
}

// Réglages › Mises à jour, « Rechercher »: checks now; the answer as the
// menu's note ({ kind, version }), { kind: 'unreachable' } without one.
export async function checkDesktopUpdates() {
  if (!isDesktopApp()) return null
  try {
    const response = await fetch('/__desktop/update/check', { method: 'POST', headers: HEADERS })
    if (response.ok) return await response.json()
  } catch {
    // Falls through: no answer.
  }
  return { kind: 'unreachable' }
}

export function onDesktopUpdateNote(handler, win = window) {
  const listener = (event) => handler(event.detail ?? {})
  win.addEventListener(NOTE_EVENT, listener)
  return () => win.removeEventListener(NOTE_EVENT, listener)
}
