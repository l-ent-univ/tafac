// ============================================================================
// Session cookie codec: encrypted payloads (AES-256-GCM), key derivation and
// rotation, the legacy HMAC-signed format (read-only, for the migration), the
// size budget that keeps the Set-Cookie header below what browsers accept,
// and the cookie lifetime policy.
//
// Free of Express and university config so tests can exercise it without
// booting the app (tests/sessionCookie.test.js). Wired in by
// server/entAuthApp.js.
// ============================================================================
import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

// Bumped when the payload or the encryption scheme changes; old cookies then
// simply stop decoding (the user signs in again).
export const SESSION_COOKIE_FORMAT_VERSION = 'v1'
// Name used before the encrypted format (HMAC-signed payload). Still read so
// the switch doesn't sign everyone out, cleared once a new cookie is issued.
// Remove along with the legacy branch in decode() once no such cookie can be
// alive anymore (they expired after 8 hours).
export const LEGACY_SESSION_COOKIE_NAME = 'ent_front_session'
export const SESSION_COOKIE_NAME = 'lent_session'
// `__Host-` makes the browser refuse the cookie unless it is Secure, Path=/
// and has no Domain: it can only come from this exact host over HTTPS, so a
// tenant subdomain can never read or plant another tenant's session. Needs
// HTTPS, hence production only (http://localhost in dev).
export const HOST_PREFIXED_SESSION_COOKIE_NAME = `__Host-${SESSION_COOKIE_NAME}`
// Rolling cookie lifetime (refreshed on every request)…
export const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
// …capped by an absolute lifetime counted from the login (stored encrypted
// in the payload, so it can't be pushed back). The effective bound is shorter
// in practice: the university's CAS ticket-granting ticket lifetime, which we
// never extend artificially.
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MIN_SESSION_SECRET_BYTES = 32
// Browsers silently drop a cookie whose name + value exceed 4096 bytes; the
// attributes (Path, Expires, SameSite…) add ~110 bytes to the header. The
// rest is headroom.
export const MAX_SESSION_COOKIE_VALUE_BYTES = 3800
// Upstream cookie values longer than this are kept in memory only.
export const MAX_PERSISTED_COOKIE_VALUE_LENGTH = 1024

const SECRET_GENERATION_HINT = 'Generate one with: openssl rand -base64 32'
const HKDF_INFO = 'l-ent session cookie v1'
const KEY_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16
// Binds the ciphertext to the format version (a v1 blob can't be replayed as
// a future v2 one, and vice versa).
const ADDITIONAL_DATA = Buffer.from(`l-ent session ${SESSION_COOKIE_FORMAT_VERSION}`)

function parseSecretList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
  }

  return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

// Picks the encryption secrets from the environment.
// - production: SESSION_SECRET is required and must be at least 32 bytes —
//   this is an open-source app, a built-in fallback would be a public key.
// - development: SESSION_SECRET is used when set (so sessions survive dev
//   restarts); otherwise a random per-process key is generated, with a
//   one-line warning.
// SESSION_SECRET_PREVIOUS (comma-separated) lists older secrets that are still
// accepted for reading during a rotation; cookies are re-issued with the
// current one. Rotating SESSION_SECRET without it signs everyone out.
export function resolveSessionSecrets({
  secret = process.env.SESSION_SECRET,
  previousSecrets = process.env.SESSION_SECRET_PREVIOUS,
  production = false,
  warn = (message) => console.warn(message),
} = {}) {
  let current = String(secret ?? '').trim()
  const currentBytes = Buffer.byteLength(current, 'utf8')
  let ephemeral = false

  if (production && !current) {
    throw new Error(
      `SESSION_SECRET is required in production: it encrypts the session cookies. ${SECRET_GENERATION_HINT}`,
    )
  }

  if (production && currentBytes < MIN_SESSION_SECRET_BYTES) {
    throw new Error(
      `SESSION_SECRET is too short (${currentBytes} bytes, ${MIN_SESSION_SECRET_BYTES} required). `
      + `${SECRET_GENERATION_HINT} — to keep existing sessions alive, move the old value to SESSION_SECRET_PREVIOUS.`,
    )
  }

  if (!current) {
    current = randomBytes(KEY_BYTES).toString('base64')
    ephemeral = true
    warn('SESSION_SECRET is not set: using a random per-process key (sessions will not survive a restart).')
  } else if (currentBytes < MIN_SESSION_SECRET_BYTES) {
    warn(`SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_BYTES} bytes; production will refuse it. ${SECRET_GENERATION_HINT}`)
  }

  const previous = parseSecretList(previousSecrets).filter((entry, index, list) => (
    entry !== current && list.indexOf(entry) === index
  ))

  return { current, previous, ephemeral }
}

function deriveKey(secret) {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), HKDF_INFO, KEY_BYTES))
}

function base64urlLength(byteLength) {
  return Math.ceil((byteLength * 4) / 3)
}

// Strict base64url: the alphabet only, and canonical (re-encoding gives the
// same string back, so trailing padding bits can't be toyed with). Anything
// else is a tampered or foreign cookie.
function decodeBase64url(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    return null
  }

  const buffer = Buffer.from(value, 'base64url')
  return buffer.toString('base64url') === value ? buffer : null
}

function parseJsonObject(buffer) {
  try {
    const data = JSON.parse(buffer.toString('utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

// encode(data) → cookie value; decode(value) → { data, format, needsReissue }
// or null. `needsReissue` is true when the cookie was readable only with a
// previous secret or in the legacy format: the caller re-issues it.
export function createSessionCookieCodec({ secret, previousSecrets = [] } = {}) {
  if (typeof secret !== 'string' || !secret) {
    throw new TypeError('createSessionCookieCodec requires a non-empty secret.')
  }

  const secrets = [secret, ...parseSecretList(previousSecrets).filter((entry) => entry !== secret)]
  const keys = secrets.map(deriveKey)

  function encode(data) {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', keys[0], iv)
    cipher.setAAD(ADDITIONAL_DATA)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])

    return [
      SESSION_COOKIE_FORMAT_VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.')
  }

  // Exact length encode(data) will produce: GCM keeps the plaintext length and
  // the IV/tag are fixed, so the budget logic can measure without encrypting.
  function encodedLength(data) {
    return SESSION_COOKIE_FORMAT_VERSION.length + 3
      + base64urlLength(IV_BYTES)
      + base64urlLength(Buffer.byteLength(JSON.stringify(data), 'utf8'))
      + base64urlLength(AUTH_TAG_BYTES)
  }

  function decryptCurrentFormat(value) {
    const parts = value.split('.')
    if (parts.length !== 4) {
      return null
    }

    const iv = decodeBase64url(parts[1])
    const ciphertext = decodeBase64url(parts[2])
    const authTag = decodeBase64url(parts[3])
    if (!iv || !ciphertext || !authTag || iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      return null
    }

    for (let index = 0; index < keys.length; index += 1) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', keys[index], iv)
        decipher.setAAD(ADDITIONAL_DATA)
        decipher.setAuthTag(authTag)
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
        const data = parseJsonObject(plaintext)

        return data ? { data, format: SESSION_COOKIE_FORMAT_VERSION, needsReissue: index > 0 } : null
      } catch {
        // Wrong key or tampered: try the next accepted secret.
      }
    }

    return null
  }

  // Legacy format: base64url(JSON) + "." + base64url(HMAC-SHA256). Signed,
  // not encrypted. Verified in constant time against every accepted secret.
  function verifyLegacyFormat(value) {
    const lastDot = value.lastIndexOf('.')
    if (lastDot === -1) {
      return null
    }

    const payload = value.slice(0, lastDot)
    const signature = decodeBase64url(value.slice(lastDot + 1))
    if (!signature || !/^[A-Za-z0-9_-]+$/.test(payload)) {
      return null
    }

    for (const candidate of secrets) {
      const expected = createHmac('sha256', candidate).update(payload).digest()
      if (signature.length === expected.length && timingSafeEqual(signature, expected)) {
        const data = parseJsonObject(Buffer.from(payload, 'base64url'))
        return data ? { data, format: 'legacy', needsReissue: true } : null
      }
    }

    return null
  }

  function decode(value) {
    if (typeof value !== 'string' || !value) {
      return null
    }

    return value.startsWith(`${SESSION_COOKIE_FORMAT_VERSION}.`)
      ? decryptCurrentFormat(value)
      : verifyLegacyFormat(value)
  }

  return { encode, decode, encodedLength }
}

// Compact jar entry for the cookie: the jar key (domain|path|name) is
// rebuilt on the way back, and booleans become 0/1.
export function packJarCookies(cookies) {
  return cookies.map((cookie) => [
    cookie.name,
    cookie.value,
    cookie.domain,
    cookie.path,
    cookie.hostOnly ? 1 : 0,
    cookie.secure ? 1 : 0,
    Number.isFinite(cookie.expiresAt) ? cookie.expiresAt : null,
  ])
}

// Returns [key, cookie] pairs for CookieJar.fromSerialized(). Accepts the
// packed tuples above and the legacy [key, cookie] pairs.
export function unpackJarCookies(entries) {
  const pairs = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!Array.isArray(entry)) {
      continue
    }

    if (entry.length === 2 && entry[1] && typeof entry[1] === 'object') {
      const cookie = entry[1]
      if (typeof cookie.name === 'string' && typeof cookie.value === 'string') {
        pairs.push([String(entry[0]), cookie])
      }
      continue
    }

    const [name, value, domain, path, hostOnly, secure, expiresAt] = entry
    if (typeof name !== 'string' || typeof value !== 'string' || typeof domain !== 'string') {
      continue
    }

    const cookie = {
      name,
      value,
      domain,
      path: typeof path === 'string' && path ? path : '/',
      hostOnly: Boolean(hostOnly),
      secure: Boolean(secure),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    }
    pairs.push([`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie])
  }

  return pairs
}

// Builds the cookie payload within the size budget. `required` cookies always
// ship (the CAS TGC: without it nothing can be re-established after a server
// restart); `optional` ones, given most valuable first, are added while the
// encoded cookie still fits. Each candidate is measured against the real
// encoded length, so JSON quoting and base64 expansion are accounted for.
export function fitSessionPayload({
  data,
  required = [],
  optional = [],
  codec,
  budget = MAX_SESSION_COOKIE_VALUE_BYTES,
}) {
  const kept = [...required]
  let dropped = 0

  for (const cookie of optional) {
    const candidate = { ...data, jar: packJarCookies([...kept, cookie]) }
    if (codec.encodedLength(candidate) <= budget) {
      kept.push(cookie)
    } else {
      dropped += 1
    }
  }

  const payload = { ...data, jar: packJarCookies(kept) }
  const size = codec.encodedLength(payload)

  return { payload, kept: kept.length, dropped, size, overBudget: size > budget }
}

// The session carried by a request's cookies (parsed by cookie-parser): the
// encrypted cookie wins, the legacy signed one is only read when no readable
// encrypted one is present. → { data, legacyCookie } or null.
export function readSessionCookies(cookies, { codec, cookieName }) {
  const current = codec.decode(cookies?.[cookieName])
  if (current) {
    return { ...current, legacyCookie: false }
  }

  const legacy = codec.decode(cookies?.[LEGACY_SESSION_COOKIE_NAME])
  return legacy ? { ...legacy, legacyCookie: true } : null
}

// University a session belongs to. Sessions issued before the field existed
// carry no `uni`: they belong to `legacyUniversityId`, the university the
// address served then (the default one on the root domain).
export function getSessionUniversityId(data, legacyUniversityId = null) {
  const uni = typeof data?.uni === 'string' && data.uni ? data.uni : null
  return uni ?? legacyUniversityId ?? null
}

// Absolute cap: a session older than SESSION_ABSOLUTE_TTL_MS is gone whatever
// the cookie's rolling expiry says (and so is a payload without a login time).
export function isSessionDataExpired(data, now = Date.now()) {
  const createdAt = Number(data?.createdAt)
  return !Number.isFinite(createdAt) || now - createdAt > SESSION_ABSOLUTE_TTL_MS
}

export function getSessionCookieName(production) {
  return production ? HOST_PREFIXED_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME
}

// Secure is unconditional in production (the __Host- prefix requires it);
// dev runs over http://localhost.
export function buildSessionCookieOptions(production) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: Boolean(production),
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  }
}
