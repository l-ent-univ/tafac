// Brings settings over from the old l'ent address. Local storage is separate
// for every address, so the old site links to `https://tafac.fr/#import=…`
// with its settings in the fragment, which browsers never send to a server.
// Only known settings keys are taken, and a key already set here is kept.

export const TRANSFER_PREFIX = '#import='
const MAX_PAYLOAD_LENGTH = 100_000
const MAX_VALUE_LENGTH = 20_000

// Settings only: caches rebuild themselves, the session cookie can't move,
// and the custom background is a whole image, too big for a link.
export const TRANSFERABLE_KEYS = [
  'l-ent:establishment',
  'l-ent:student-tp',
  'l-ent:ade-lookahead-days',
  'l-ent:greeting-hidden',
  'l-ent:hidden-widgets',
  'l-ent:show-app-descriptions',
  'l-ent:planning-weekend',
  'l-ent:show-university-logo',
  'l-ent:logo-source',
  'l-ent:anonymous-analytics',
  'l-ent:favorites-order',
  'l-ent:local-pins',
  'l-ent:weather-city',
  'l-ent:grade-colors',
  'l-ent:class-colors',
]

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded) {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

// Link to `targetOrigin` carrying this browser's settings.
export function buildSettingsTransferUrl(targetOrigin, storage = localStorage) {
  const settings = {}
  for (const key of TRANSFERABLE_KEYS) {
    const value = storage.getItem(key)
    if (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH) settings[key] = value
  }
  return `${targetOrigin.replace(/\/$/, '')}/${TRANSFER_PREFIX}${toBase64Url(JSON.stringify(settings))}`
}

// Stores the settings carried by an `#import=` link, then removes it from the
// address bar. Called by settingsTransferBoot.js before the app loads.
// Returns how many settings were stored.
export function importTransferredSettings({
  location = window.location,
  history = window.history,
  storage = localStorage,
} = {}) {
  if (!location.hash.startsWith(TRANSFER_PREFIX)) return 0

  // Read before replaceState: the real `location` drops its hash right away.
  const encoded = location.hash.slice(TRANSFER_PREFIX.length)
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  } catch {
    // Leaving the fragment in place is harmless
  }

  if (!encoded || encoded.length > MAX_PAYLOAD_LENGTH) return 0

  let settings
  try {
    settings = JSON.parse(fromBase64Url(encoded))
  } catch {
    return 0
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 0

  let imported = 0
  for (const key of TRANSFERABLE_KEYS) {
    const value = settings[key]
    if (typeof value !== 'string' || !value || value.length > MAX_VALUE_LENGTH) continue
    try {
      if (storage.getItem(key) !== null) continue
      storage.setItem(key, value)
      imported += 1
    } catch {
      // Storage unavailable
    }
  }
  return imported
}
