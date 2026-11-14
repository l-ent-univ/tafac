import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import {
  HOST_PREFIXED_SESSION_COOKIE_NAME,
  MAX_SESSION_COOKIE_VALUE_BYTES,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  createSessionCookieCodec,
  fitSessionPayload,
  getSessionCookieName,
  isSessionDataExpired,
  packJarCookies,
  resolveSessionSecrets,
  unpackJarCookies,
} from '../server/sessionCookie.js'

const SECRET_A = 'a'.repeat(44)
const SECRET_B = 'b'.repeat(44)
const CAS_HOST = 'sso-cas.univ-rennes.fr'
const ENT_HOST = 'services-numeriques.univ-rennes.fr'

function cookie(name, value, domain, overrides = {}) {
  return {
    name,
    value,
    domain,
    path: '/',
    hostOnly: true,
    secure: true,
    expiresAt: null,
    ...overrides,
  }
}

// Base64-ish filler of a given length, like real session identifiers.
function token(length) {
  return 'x'.repeat(length).replace(/x/g, (_, index) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[index % 64])
}

// What a Rennes jar looks like right after login + a dashboard load (the mail
// and Moodle chains run on jar copies, so their cookies never land here).
// Apereo CAS encrypts+signs its TGC cookie, hence the long JWT-like value.
function representativeJar({ tgcLength = 800 } = {}) {
  return {
    tgc: cookie('TGC', `eyJhbGciOiJIUzUxMiJ9.${token(tgcLength - 22)}`, CAS_HOST, { path: '/' }),
    optional: [
      cookie('JSESSIONID', `${token(32)}.node1`, ENT_HOST),
      cookie('BIGipServer~ENT~pool', token(44), ENT_HOST, { secure: false }),
      cookie('PHPSESSID', token(26), 'notes9.iutlan.univ-rennes1.fr'),
      cookie('JSESSIONID', token(32), 'planning.univ-rennes.fr'),
      cookie('BIGipServer~planning', token(44), 'planning.univ-rennes.fr', { secure: false }),
      cookie('JSESSIONID', token(32), 'campus-app.univ-rennes.fr'),
      cookie('JSESSIONID', token(32), CAS_HOST),
    ],
  }
}

function sessionData() {
  return {
    id: 'c0ffee00-1234-4567-89ab-cdef01234567',
    user: 'prenom.nom',
    mode: null,
    demoState: null,
    createdAt: Date.parse('2026-10-10T08:00:00Z'),
  }
}

// The format this codec replaced: base64url(JSON) + "." + HMAC-SHA256.
function legacyCookieValue(data, secret) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

test('encrypted cookie round-trips and is opaque', () => {
  const codec = createSessionCookieCodec({ secret: SECRET_A })
  const data = { ...sessionData(), jar: packJarCookies([representativeJar().tgc]) }
  const value = codec.encode(data)

  assert.match(value, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/)
  assert.ok(!value.includes('prenom.nom'))
  assert.ok(!value.includes(Buffer.from('prenom.nom').toString('base64url')))
  assert.ok(!value.includes('TGC'))

  const decoded = codec.decode(value)
  assert.deepEqual(decoded, { data, format: 'v1', needsReissue: false })
  // Two encodings of the same payload never look alike (random IV).
  assert.notEqual(codec.encode(data), value)
})

test('encodedLength predicts the real cookie size exactly', () => {
  const codec = createSessionCookieCodec({ secret: SECRET_A })
  const { tgc, optional } = representativeJar()

  for (const jar of [[], [tgc], [tgc, ...optional]]) {
    const data = { ...sessionData(), jar: packJarCookies(jar) }
    assert.equal(codec.encode(data).length, codec.encodedLength(data))
  }
})

test('any single-character change is rejected', () => {
  const codec = createSessionCookieCodec({ secret: SECRET_A })
  const value = codec.encode({ ...sessionData(), jar: [] })

  for (let index = 0; index < value.length; index += 1) {
    const replacement = value[index] === 'A' ? 'B' : 'A'
    const tampered = `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`
    assert.equal(codec.decode(tampered), null, `position ${index}`)
  }

  assert.equal(codec.decode(`${value}A`), null)
  assert.equal(codec.decode(value.slice(0, -1)), null)
  assert.equal(codec.decode(''), null)
  assert.equal(codec.decode(null), null)
  assert.equal(codec.decode('v1.not.a.cookie'), null)
})

test('a cookie encrypted with another secret is rejected', () => {
  const value = createSessionCookieCodec({ secret: SECRET_A }).encode({ ...sessionData(), jar: [] })
  assert.equal(createSessionCookieCodec({ secret: SECRET_B }).decode(value), null)
})

test('rotation: previous secrets decrypt, the current one re-issues', () => {
  const oldCodec = createSessionCookieCodec({ secret: SECRET_A })
  const rotated = createSessionCookieCodec({ secret: SECRET_B, previousSecrets: `${SECRET_A}, ${SECRET_A}` })
  const data = { ...sessionData(), jar: [] }

  const fromOld = rotated.decode(oldCodec.encode(data))
  assert.deepEqual(fromOld, { data, format: 'v1', needsReissue: true })

  const reissued = rotated.encode(fromOld.data)
  assert.deepEqual(rotated.decode(reissued), { data, format: 'v1', needsReissue: false })
  // The old key can't read what the new one wrote: no downgrade.
  assert.equal(oldCodec.decode(reissued), null)
  // Without the previous secret, the old cookie is dead (kill switch).
  assert.equal(createSessionCookieCodec({ secret: SECRET_B }).decode(oldCodec.encode(data)), null)
})

test('the signed format from before the encryption is no longer read', () => {
  const codec = createSessionCookieCodec({ secret: SECRET_A, previousSecrets: [SECRET_B] })
  const data = { ...sessionData(), jar: [] }

  // Rightly signed with the current secret, or a previous one: not a session.
  assert.equal(codec.decode(legacyCookieValue(data, SECRET_A)), null)
  assert.equal(codec.decode(legacyCookieValue(data, SECRET_B)), null)
  assert.equal(codec.decode(Buffer.from(JSON.stringify(data)).toString('base64url')), null)
})

test('jar entries stored as [key, cookie] pairs restore like the compact tuples', () => {
  const pairs = [[`${ENT_HOST}|/|JSESSIONID`, cookie('JSESSIONID', token(32), ENT_HOST)]]
  assert.deepEqual(unpackJarCookies(pairs), pairs)
  assert.deepEqual(unpackJarCookies(packJarCookies([pairs[0][1]])), pairs)
})

test('production refuses a missing or short SESSION_SECRET', () => {
  assert.throws(
    () => resolveSessionSecrets({ secret: undefined, production: true }),
    /SESSION_SECRET is required in production.*openssl rand -base64 32/,
  )
  assert.throws(
    () => resolveSessionSecrets({ secret: '   ', production: true }),
    /SESSION_SECRET is required/,
  )
  assert.throws(
    () => resolveSessionSecrets({ secret: 'short-secret', production: true }),
    /too short \(12 bytes, 32 required\).*openssl rand -base64 32.*SESSION_SECRET_PREVIOUS/,
  )

  const warnings = []
  const resolved = resolveSessionSecrets({
    secret: SECRET_A,
    previousSecrets: ` ${SECRET_B},short, ${SECRET_A}`,
    production: true,
    warn: (message) => warnings.push(message),
  })
  assert.deepEqual(resolved, { current: SECRET_A, previous: [SECRET_B, 'short'], ephemeral: false })
  assert.deepEqual(warnings, [])
})

test('development falls back to a random per-process key with one warning', () => {
  const warnings = []
  const first = resolveSessionSecrets({ secret: '', production: false, warn: (message) => warnings.push(message) })
  const second = resolveSessionSecrets({ secret: undefined, production: false, warn: () => {} })

  assert.equal(first.ephemeral, true)
  assert.ok(Buffer.byteLength(first.current) >= 32)
  assert.notEqual(first.current, second.current)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /random per-process key/)

  const configured = resolveSessionSecrets({ secret: SECRET_A, production: false, warn: () => {} })
  assert.deepEqual(configured, { current: SECRET_A, previous: [], ephemeral: false })
})

test('codec requires a secret', () => {
  assert.throws(() => createSessionCookieCodec({ secret: '' }), TypeError)
})

test('representative jar with the TGC fits the cookie budget', () => {
  const codec = createSessionCookieCodec({ secret: SECRET_A })
  const { tgc, optional } = representativeJar()
  const result = fitSessionPayload({ data: sessionData(), required: [tgc], optional, codec })

  assert.equal(result.dropped, 0)
  assert.equal(result.kept, optional.length + 1)
  assert.equal(result.overBudget, false)
  assert.ok(result.size <= MAX_SESSION_COOKIE_VALUE_BYTES, `size ${result.size}`)
  // Whole Set-Cookie header (name, value, attributes) under what browsers keep.
  const header = `${HOST_PREFIXED_SESSION_COOKIE_NAME}=${codec.encode(result.payload)}; Max-Age=2592000; Path=/; Expires=Mon, 09 Nov 2026 08:00:00 GMT; HttpOnly; Secure; SameSite=Lax`
  assert.ok(header.length < 4000, `header ${header.length}`)

  // Still fits with a TGC at the per-cookie persistence limit (1024 chars).
  const worst = representativeJar({ tgcLength: 1024 })
  const worstResult = fitSessionPayload({ data: sessionData(), required: [worst.tgc], optional: worst.optional, codec })
  assert.equal(worstResult.dropped, 0)
  assert.ok(worstResult.size <= MAX_SESSION_COOKIE_VALUE_BYTES, `size ${worstResult.size}`)
})

test('budget drops the least important cookies first and never the TGC', () => {
  const codec = createSessionCookieCodec({ secret: SECRET_A })
  const { tgc, optional } = representativeJar()
  const bulky = Array.from({ length: 6 }, (_, index) => cookie(`BULK${index}`, token(1000), `svc${index}.univ-rennes.fr`))
  const result = fitSessionPayload({ data: sessionData(), required: [tgc], optional: [...optional, ...bulky], codec })

  assert.ok(result.dropped > 0)
  assert.ok(result.size <= MAX_SESSION_COOKIE_VALUE_BYTES)
  const names = result.payload.jar.map(([name]) => name)
  assert.equal(names[0], 'TGC')
  // Everything ranked before the bulky cookies survived.
  for (const entry of optional) {
    assert.ok(names.includes(entry.name), entry.name)
  }

  // A TGC alone above the budget still ships (the caller logs the overflow).
  const hugeTgc = cookie('TGC', token(4000), CAS_HOST)
  const forced = fitSessionPayload({ data: sessionData(), required: [hugeTgc], optional, codec })
  assert.equal(forced.payload.jar[0][0], 'TGC')
  assert.equal(forced.overBudget, true)
  assert.equal(forced.dropped, optional.length)
})

test('packed jar entries restore to the jar\'s [key, cookie] pairs', () => {
  const entries = [
    cookie('JSESSIONID', 'abc', ENT_HOST, { secure: false, expiresAt: 1760000000000 }),
    cookie('TGC', 'tgt', 'univ-rennes.fr', { hostOnly: false, path: '/cas' }),
  ]

  const packed = packJarCookies(entries)
  assert.deepEqual(packed[0], ['JSESSIONID', 'abc', ENT_HOST, '/', 1, 0, 1760000000000])
  assert.deepEqual(packed[1], ['TGC', 'tgt', 'univ-rennes.fr', '/cas', 0, 1, null])

  assert.deepEqual(unpackJarCookies(packed), [
    [`${ENT_HOST}|/|JSESSIONID`, entries[0]],
    ['univ-rennes.fr|/cas|TGC', entries[1]],
  ])
  // Garbage is skipped, not thrown on.
  assert.deepEqual(unpackJarCookies([null, 'x', [1, 2], ['a'], []]), [])
  assert.deepEqual(unpackJarCookies(undefined), [])
})

test('absolute cap: sessions older than 30 days are expired', () => {
  const now = Date.parse('2026-10-10T08:00:00Z')

  assert.equal(isSessionDataExpired({ createdAt: now }, now), false)
  assert.equal(isSessionDataExpired({ createdAt: now - SESSION_ABSOLUTE_TTL_MS }, now), false)
  assert.equal(isSessionDataExpired({ createdAt: now - SESSION_ABSOLUTE_TTL_MS - 1 }, now), true)
  assert.equal(isSessionDataExpired({ createdAt: now - 31 * 24 * 60 * 60 * 1000 }, now), true)
  assert.equal(isSessionDataExpired({}, now), true)
  assert.equal(isSessionDataExpired(null, now), true)
  assert.equal(isSessionDataExpired({ createdAt: 'yesterday' }, now), true)
})

test('cookie name and attributes follow the environment', () => {
  assert.equal(getSessionCookieName(true), '__Host-lent_session')
  assert.equal(getSessionCookieName(false), SESSION_COOKIE_NAME)

  const production = buildSessionCookieOptions(true)
  assert.deepEqual(production, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
  assert.equal(buildSessionCookieOptions(false).secure, false)
  assert.equal(buildSessionCookieOptions(false).httpOnly, true)
})
