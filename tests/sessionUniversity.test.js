import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import {
  SESSION_COOKIE_NAME,
  createSessionCookieCodec,
  getSessionUniversityId,
} from '../server/sessionCookie.js'
import { loadServerConfig } from '../universities/index.js'

const SECRET = 'c'.repeat(44)
const codec = createSessionCookieCodec({ secret: SECRET })

async function startApp(universityId, sessionOptions = {}) {
  const app = createEntAuthApp(await loadServerConfig(universityId), {
    analytics: {},
    session: { secret: SECRET, production: false, ...sessionOptions },
  })
  const server = app.listen(0)
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  }
}

async function loginDemo(base) {
  const response = await fetch(`${base}/__ent_auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`))
  return { payload, value: cookie.split(';')[0].slice(SESSION_COOKIE_NAME.length + 1) }
}

async function getSession(base, value) {
  const response = await fetch(`${base}/__ent_auth/session`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${value}` },
  })
  return response.json()
}

// A demo session as issued before sessions said which university they are.
function legacyDemoCookie() {
  return codec.encode({
    id: 'legacy-session',
    user: 'demo@tafac.fr',
    mode: 'demo',
    demoState: null,
    createdAt: Date.now(),
    jar: [],
  })
}

test('getSessionUniversityId: the payload, else the legacy university', () => {
  assert.equal(getSessionUniversityId({ uni: 'univ-exemple' }, 'univ-rennes'), 'univ-exemple')
  assert.equal(getSessionUniversityId({}, 'univ-rennes'), 'univ-rennes')
  assert.equal(getSessionUniversityId({ uni: '' }, 'univ-rennes'), 'univ-rennes')
  assert.equal(getSessionUniversityId({ uni: 42 }, null), null)
})

test('a new session carries its university, and says it', async () => {
  const exemple = await startApp('univ-exemple')
  try {
    const { payload, value } = await loginDemo(exemple.base)
    assert.equal(payload.university, 'univ-exemple')
    assert.equal(codec.decode(value).data.uni, 'univ-exemple')

    const session = await getSession(exemple.base, value)
    assert.equal(session.authenticated, true)
    assert.equal(session.university, 'univ-exemple')
  } finally {
    exemple.close()
  }
})

test("another university's app refuses the session", async () => {
  const exemple = await startApp('univ-exemple')
  const rennes = await startApp('univ-rennes')
  try {
    const { value } = await loginDemo(exemple.base)
    const session = await getSession(rennes.base, value)
    assert.equal(session.authenticated, false)
  } finally {
    exemple.close()
    rennes.close()
  }
})

test('a session from before the field belongs to the legacy university', async () => {
  const rennes = await startApp('univ-rennes')
  const exempleAsLegacyRennes = await startApp('univ-exemple', { legacyUniversityId: 'univ-rennes' })
  const exempleAsLegacyItself = await startApp('univ-exemple', { legacyUniversityId: () => 'univ-exemple' })
  try {
    const value = legacyDemoCookie()
    assert.equal((await getSession(rennes.base, value)).authenticated, true)
    assert.equal((await getSession(exempleAsLegacyRennes.base, value)).authenticated, false)
    assert.equal((await getSession(exempleAsLegacyItself.base, value)).authenticated, true)
  } finally {
    rennes.close()
    exempleAsLegacyRennes.close()
    exempleAsLegacyItself.close()
  }
})

test('a reissued legacy session gets its university', async () => {
  const rennes = await startApp('univ-rennes')
  try {
    const response = await fetch(`${rennes.base}/__ent_auth/session`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${legacyDemoCookie()}` },
    })
    const reissued = response.headers.getSetCookie().find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`))
    const value = reissued.split(';')[0].slice(SESSION_COOKIE_NAME.length + 1)
    assert.equal(codec.decode(value).data.uni, 'univ-rennes')
  } finally {
    rennes.close()
  }
})
