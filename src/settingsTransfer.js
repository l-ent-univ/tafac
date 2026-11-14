// Brings settings over from the old l'ent address. Local storage is separate
// for every address, so the old site links to `https://tafac.fr/#import=…`
// with its settings in the fragment, which browsers never send to a server.
//
// Anyone can write such a link, so it is only followed when the page was
// reached from the old address (isOldAddress), only known settings keys are
// taken, each only in the shape its reader expects (TRANSFER_RULES), and a
// key already set here is kept.

export const TRANSFER_PREFIX = '#import='
const MAX_PAYLOAD_LENGTH = 100_000
const MAX_VALUE_LENGTH = 20_000

// The old site's domain (lent.tomthings.fr): the address the browser says
// the visit came from (document.referrer), which a page elsewhere can't set.
const OLD_ADDRESS_DOMAIN = 'tomthings.fr'

export function isOldAddress(referrer) {
  try {
    const { protocol, hostname } = new URL(String(referrer ?? ''))
    return protocol === 'https:' && (hostname === OLD_ADDRESS_DOMAIN || hostname.endsWith(`.${OLD_ADDRESS_DOMAIN}`))
  } catch {
    return false
  }
}

function currentReferrer() {
  return typeof document === 'undefined' ? '' : document.referrer
}

// A development build takes the link from anywhere (the old site run locally).
function isTrustedArrival(referrer) {
  return isOldAddress(referrer) || import.meta.env?.DEV === true
}

// Whether this page load is the arrival from the old address, settings or not.
export function isSettingsTransferArrival({ location = window.location, referrer = currentReferrer() } = {}) {
  return location.hash.startsWith(TRANSFER_PREFIX) && isTrustedArrival(referrer)
}

function parseJson(value) {
  try {
    return { parsed: JSON.parse(value) }
  } catch {
    return null
  }
}

// eslint-disable-next-line no-control-regex
const isPlainText = (value) => value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// Strings, numbers, booleans and null, in lists and objects a few levels deep:
// what the app's own settings are made of.
function isSettingData(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.length <= 500
  if (depth >= 4) return false
  if (Array.isArray(value)) return value.length <= 200 && value.every((item) => isSettingData(item, depth + 1))
  return isPlainObject(value)
    && Object.keys(value).length <= 50
    && Object.values(value).every((item) => isSettingData(item, depth + 1))
}

// A setting of src/profileStorage.js: { user, value } or, from older
// versions, the bare value (text included, which isn't JSON).
function isProfileSetting(value) {
  const json = parseJson(value)
  if (!json) return isPlainText(value)
  return json.parsed !== null && isSettingData(json.parsed)
}

// A list of application keys.
function isKeyList(value) {
  const list = parseJson(value)?.parsed
  return Array.isArray(list) && list.length <= 500 && list.every((key) => typeof key === 'string' && key.length <= 200)
}

const COLOR = /^(?:#[0-9a-f]{3,8}|hsla?\([\d.,%\s]{1,40}\))$/i

// Colours by course or resource code.
function isColorMap(value) {
  const colors = parseJson(value)?.parsed
  return isPlainObject(colors)
    && Object.keys(colors).length <= 1000
    && Object.values(colors).every((color) => typeof color === 'string' && COLOR.test(color))
}

// Settings only: caches rebuild themselves, the session cookie can't move,
// and the custom background and profile photo are whole images, too big
// for a link. Each with the shape its reader takes, anything else is left
// out: a list where a reader expects a list, never `null` or an object.
const TRANSFER_RULES = {
  'l-ent:establishment': isProfileSetting,
  'l-ent:student-tp': isProfileSetting,
  'l-ent:ade-lookahead-days': isProfileSetting,
  'l-ent:greeting-hidden': isProfileSetting,
  'l-ent:hidden-widgets': isProfileSetting,
  'l-ent:show-app-descriptions': isProfileSetting,
  'l-ent:planning-weekend': isProfileSetting,
  'l-ent:show-university-logo': isProfileSetting,
  'l-ent:logo-source': isProfileSetting,
  'l-ent:anonymous-analytics': isProfileSetting,
  'l-ent:favorites-order': isKeyList,
  'l-ent:local-pins': isKeyList,
  'l-ent:local-favorites': isKeyList,
  'l-ent:weather-city': isPlainText,
  'l-ent:grade-colors': isColorMap,
  'l-ent:class-colors': isColorMap,
}

export const TRANSFERABLE_KEYS = Object.keys(TRANSFER_RULES)

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
  referrer = currentReferrer(),
} = {}) {
  if (!location.hash.startsWith(TRANSFER_PREFIX)) return 0
  const trusted = isTrustedArrival(referrer)

  // Read before replaceState: the real `location` drops its hash right away.
  const encoded = location.hash.slice(TRANSFER_PREFIX.length)
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  } catch {
    // Leaving the fragment in place is harmless
  }

  // The fragment is gone from the address bar either way; a link from
  // anywhere else brings nothing.
  if (!trusted || !encoded || encoded.length > MAX_PAYLOAD_LENGTH) return 0

  let settings
  try {
    settings = JSON.parse(fromBase64Url(encoded))
  } catch {
    return 0
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 0

  let imported = 0
  for (const [key, isValid] of Object.entries(TRANSFER_RULES)) {
    const value = settings[key]
    if (typeof value !== 'string' || !value || value.length > MAX_VALUE_LENGTH || !isValid(value)) continue
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
