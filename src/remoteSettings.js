// Remote settings (server/remoteSettings/, docs/REMOTE_SETTINGS.md): a
// university's settings as the app ships them, with what a signed file on
// tafac.fr says of them laid over. Pure data, read by the server and by the
// page.

// Never taken as a key: they reach an object's own machinery.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// `base` with `override` over it. Objects are merged key by key; anything
// else (a text, a number, a list, null) takes the place of what was there.
// Neither is changed: what differs is made anew.
export function mergeSettings(base, override) {
  if (!isPlainObject(override)) return override
  const merged = isPlainObject(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(override)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    merged[key] = isPlainObject(value) ? mergeSettings(merged[key], value) : value
  }
  return merged
}

export function hasForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKey)
  if (!isPlainObject(value)) return false
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.has(key) || hasForbiddenKey(child))
}
