import assert from 'node:assert/strict'
import test from 'node:test'
import { SESSION_COOKIE_NAME, createSessionCookieCodec } from '../server/sessionCookie.js'
import { createUniversitiesApp } from '../server/universitiesApp.js'

const SECRET = 'd'.repeat(44)
const codec = createSessionCookieCodec({ secret: SECRET })

async function withUniversitiesApp(options, run) {
  const app = await createUniversitiesApp({
    universityIds: ['univ-rennes', 'univ-exemple'],
    defaultUniversityId: 'univ-rennes',
    production: false,
    session: { secret: SECRET },
    analytics: {},
    ...options,
  })
  const server = app.listen(0)
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.close()
  }
}

function cookieValue(response) {
  const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`))
  return cookie ? cookie.split(';')[0].slice(SESSION_COOKIE_NAME.length + 1) : null
}

async function loginDemo(base, { header, university } = {}) {
  const response = await fetch(`${base}/__ent_auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(header ? { 'X-Tafac-University': header } : {}),
    },
    body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo', ...(university ? { university } : {}) }),
  })
  assert.equal(response.status, 200)
  return { payload: await response.json(), value: cookieValue(response) }
}

function getSession(base, { value, header, host } = {}) {
  return fetch(`${base}/__ent_auth/session`, {
    headers: {
      ...(value ? { cookie: `${SESSION_COOKIE_NAME}=${value}` } : {}),
      ...(header ? { 'X-Tafac-University': header } : {}),
      ...(host ? { 'X-Forwarded-Host': host } : {}),
    },
  }).then((response) => response.json())
}

function legacyDemoCookie() {
  return codec.encode({ id: 'legacy', user: 'demo@tafac.fr', mode: 'demo', demoState: null, createdAt: Date.now(), jar: [] })
}

test('the list of universities, public fields only', () => withUniversitiesApp({}, async (base) => {
  const response = await fetch(`${base}/__ent_auth/universities`)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const payload = await response.json()

  assert.equal(payload.mode, 'multi')
  assert.equal(payload.defaultUniversity, 'univ-rennes')
  assert.equal(payload.session, null)
  assert.deepEqual(payload.universities.map((entry) => [entry.id, entry.slug, entry.listed]), [
    ['univ-rennes', 'rennes', true],
    ['univ-exemple', 'exemple', true],
  ])
  assert.deepEqual(Object.keys(payload.universities[0]).sort(), ['id', 'listed', 'logoShape', 'logoUrl', 'name', 'shortName', 'slug'])

  // Versioned by the file's date, so a new logo isn't kept from the cache.
  assert.match(payload.universities[0].logoUrl, /\/logo\?v=[0-9a-z]+$/)
  assert.equal(payload.universities[0].logoShape, 'wide')
  const logo = await fetch(`${base}${payload.universities[0].logoUrl}`)
  assert.equal(logo.status, 200)
  assert.match(logo.headers.get('content-type'), /svg/)
  assert.equal((await fetch(`${base}/__ent_auth/universities/../logo`)).status, 404)
  assert.equal((await fetch(`${base}/__ent_auth/universities/univ-inconnue/logo`)).status, 404)
}))

test('in production, dev-only universities are served but not listed', () => withUniversitiesApp({ listDevOnly: false }, async (base) => {
  const payload = await fetch(`${base}/__ent_auth/universities`).then((response) => response.json())
  assert.deepEqual(payload.universities.map((entry) => [entry.id, entry.listed]), [['univ-rennes', true], ['univ-exemple', false]])

  const { payload: login } = await loginDemo(base, { header: 'univ-exemple' })
  assert.equal(login.university, 'univ-exemple')
}))

test('signed out: the chosen university, else the default one', () => withUniversitiesApp({}, async (base) => {
  assert.equal((await getSession(base)).university, 'univ-rennes')
  assert.equal((await getSession(base, { header: 'univ-exemple' })).university, 'univ-exemple')
  assert.equal((await getSession(base, { header: 'exemple' })).university, 'univ-exemple')
  assert.equal((await getSession(base, { header: 'univ-nope' })).university, 'univ-rennes')

  assert.equal((await loginDemo(base)).payload.university, 'univ-rennes')
  assert.equal((await loginDemo(base, { header: 'univ-exemple' })).payload.university, 'univ-exemple')
  assert.equal((await loginDemo(base, { university: 'exemple' })).payload.university, 'univ-exemple')
}))

test('signed in: the session decides, whatever the header says', () => withUniversitiesApp({}, async (base) => {
  const { value } = await loginDemo(base, { header: 'univ-exemple' })
  assert.equal(codec.decode(value).data.uni, 'univ-exemple')

  const session = await getSession(base, { value, header: 'univ-rennes' })
  assert.equal(session.authenticated, true)
  assert.equal(session.university, 'univ-exemple')

  const payload = await fetch(`${base}/__ent_auth/universities`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${value}` },
  }).then((response) => response.json())
  assert.equal(payload.session, 'univ-exemple')
}))

test('a session from before goes to the university of its address', () => withUniversitiesApp({}, async (base) => {
  const value = legacyDemoCookie()

  const onRoot = await getSession(base, { value, header: 'univ-exemple' })
  assert.equal(onRoot.authenticated, true)
  assert.equal(onRoot.university, 'univ-rennes')

  const onOldAddress = await getSession(base, { value, host: 'univexemple.tafac.fr' })
  assert.equal(onOldAddress.authenticated, true)
  assert.equal(onOldAddress.university, 'univ-exemple')
}))

test('the old per-university addresses still route signed-out requests', () => withUniversitiesApp({}, async (base) => {
  assert.equal((await getSession(base, { host: 'univexemple.tafac.fr' })).university, 'univ-exemple')
  assert.equal((await getSession(base, { host: 'univrennes.tafac.fr' })).university, 'univ-rennes')
  assert.equal((await getSession(base, { host: 'tafac.fr' })).university, 'univ-rennes')
}))

test('single-university mode ignores choices and addresses', () => withUniversitiesApp({ multi: false, defaultUniversityId: 'univ-exemple' }, async (base) => {
  const payload = await fetch(`${base}/__ent_auth/universities`).then((response) => response.json())
  assert.equal(payload.mode, 'single')
  assert.deepEqual(payload.universities.map((entry) => entry.id), ['univ-exemple'])

  assert.equal((await getSession(base, { header: 'univ-rennes', host: 'univrennes.tafac.fr' })).university, 'univ-exemple')
  assert.equal((await loginDemo(base, { university: 'univ-rennes' })).payload.university, 'univ-exemple')

  // A cookie without a university is this instance's.
  assert.equal((await getSession(base, { value: legacyDemoCookie() })).authenticated, true)
}))

test('requests outside the API fall through', () => withUniversitiesApp({}, async (base) => {
  assert.equal((await fetch(`${base}/some/page`)).status, 404)
}))
