import assert from 'node:assert/strict'
import test from 'node:test'
import { CookieJar, cookieMatchesHost } from '../server/cookieJar/index.ts'
import { domainMatches, pathMatches } from '../server/cookieJar/cookie.ts'
import { parseSetCookie } from '../server/cookieJar/setCookie.ts'

const CAS = 'https://sso-cas.example.fr/cas/login'

test('a host matches its domain and its subdomains', () => {
  assert.equal(domainMatches('ent.example.fr', 'example.fr'), true)
  assert.equal(domainMatches('example.fr', 'example.fr'), true)
  assert.equal(domainMatches('notexample.fr', 'example.fr'), false)
  assert.equal(domainMatches('example.fr', 'ent.example.fr'), false)
  assert.equal(domainMatches('127.0.0.1', '0.0.1'), false)
  assert.equal(domainMatches('127.0.0.1', '127.0.0.1'), true)
})

test('a path matches itself and what is under it', () => {
  assert.equal(pathMatches('/cas/login', '/cas'), true)
  assert.equal(pathMatches('/cas/login', '/cas/'), true)
  assert.equal(pathMatches('/cas', '/cas'), true)
  assert.equal(pathMatches('/anything', '/'), true)
  assert.equal(pathMatches('/casino', '/cas'), false)
  assert.equal(pathMatches('/cas', '/cas/'), false)
  assert.equal(pathMatches('/', '/cas'), false)
})

test('a Set-Cookie is read as a browser reads it', () => {
  assert.deepEqual(parseSetCookie('TGC=TGT-1; Path=/cas; Secure; HttpOnly', CAS), {
    name: 'TGC',
    value: 'TGT-1',
    domain: 'sso-cas.example.fr',
    path: '/cas',
    hostOnly: true,
    secure: true,
    expiresAt: null,
  })
  assert.equal(parseSetCookie('lang=fr; Max-Age=60', CAS, 1000)?.expiresAt, 61_000)
  assert.equal(parseSetCookie('a=b=c', CAS)?.value, 'b=c')
  assert.equal(parseSetCookie('no-value', CAS), null)
  // A path that isn't one: the whole host.
  assert.equal(parseSetCookie('a=1; Path=cas', CAS)?.path, '/')
})

test('a host only sets cookies for a domain it belongs to', () => {
  const shared = parseSetCookie('sso=1; Domain=.example.fr', CAS)
  assert.equal(shared?.domain, 'example.fr')
  assert.equal(shared?.hostOnly, false)
  assert.equal(parseSetCookie('sso=1; Domain=sso-cas.example.fr', CAS)?.hostOnly, false)

  // Another host's, a sibling's, a parent that isn't one, a whole TLD.
  assert.equal(parseSetCookie('TGC=TGT-attacker; Domain=sso-cas.example.fr; Path=/cas', 'https://app.partner.example/'), null)
  assert.equal(parseSetCookie('TGC=TGT-attacker; Domain=sso-cas.example.fr', 'https://perso.example.fr/~student/'), null)
  assert.equal(parseSetCookie('a=1; Domain=le.fr', 'https://example.fr/'), null)
  assert.equal(parseSetCookie('a=1; Domain=fr', CAS), null)
  assert.equal(parseSetCookie('a=1; Domain=0.0.1', 'http://127.0.0.1:3000/'), null)
})

test('the jar sends each service its own cookies', () => {
  const jar = new CookieJar()
  jar.setCookie('TGC=TGT-1; Path=/cas; Secure', CAS)
  jar.setCookie('JSESSIONID=portal; Path=/', 'https://ent.example.fr/f/accueil')
  jar.setCookie('theme=dark; Domain=example.fr', 'https://ent.example.fr/')
  // Planted by another service for the CAS: never kept.
  jar.setCookie('TGC=TGT-attacker; Domain=sso-cas.example.fr; Path=/cas', 'https://moodle.example.fr/')

  assert.equal(jar.getCookieHeader(CAS), 'TGC=TGT-1; theme=dark')
  assert.equal(jar.getCookieHeader('https://sso-cas.example.fr/casino'), 'theme=dark')
  assert.equal(jar.getCookieHeader('http://sso-cas.example.fr/cas/login'), 'theme=dark')
  assert.equal(jar.getCookieHeader('https://ent.example.fr/api/layoutDoc'), 'JSESSIONID=portal; theme=dark')
  assert.equal(jar.getCookieHeader('https://evil.example/'), '')

  assert.equal(jar.hasCookie('sso-cas.example.fr', 'TGC'), true)
  assert.equal(jar.getCookieValue('sso-cas.example.fr', 'TGC'), 'TGT-1')
  assert.deepEqual(jar.getCookieNamesForHost('ent.example.fr'), ['JSESSIONID', 'theme'])
})

test('a service deletes its cookie with a past date', () => {
  const jar = new CookieJar()
  jar.setCookie('TGC=TGT-1; Path=/cas', CAS)
  jar.setCookie('TGC=; Path=/cas; Expires=Thu, 01 Jan 1970 00:00:00 GMT', CAS)
  assert.equal(jar.hasCookie('sso-cas.example.fr', 'TGC'), false)
})

test('the jar goes to the session cookie and back', () => {
  const jar = new CookieJar()
  jar.setCookie('TGC=TGT-1; Path=/cas', CAS)
  jar.setCookie('JSESSIONID=portal', 'https://ent.example.fr/')

  const copy = CookieJar.fromSerialized(jar.serialize())
  assert.equal(copy.getCookieHeader(CAS), 'TGC=TGT-1')
  jar.deleteCookiesForHost('ent.example.fr')
  assert.equal(jar.getCookieHeader('https://ent.example.fr/'), '')
  assert.equal(copy.getCookieHeader('https://ent.example.fr/'), 'JSESSIONID=portal')

  const [[, cookie]] = copy.serialize()
  assert.equal(cookieMatchesHost(cookie, 'sso-cas.example.fr'), true)
  assert.equal(cookieMatchesHost(cookie, 'sub.sso-cas.example.fr'), false)
  assert.equal(cookieMatchesHost(cookie, null), false)
})
