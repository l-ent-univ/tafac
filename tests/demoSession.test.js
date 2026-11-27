import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEMO_SESSION_KEY,
  DEMO_SESSION_TTL_MS,
  endDemoSession,
  onDemoSessionChange,
  readDemoSession,
  startDemoSession,
} from '../src/demoSession.js'

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  }
}

const blockedStorage = {
  getItem() { throw new Error('blocked') },
  setItem() { throw new Error('blocked') },
  removeItem() { throw new Error('blocked') },
}

const NOW = Date.UTC(2026, 10, 26, 9, 0)
const DAY = 24 * 60 * 60 * 1000

test('nobody is in the demo until its sign-in', () => {
  const storage = createStorage()
  assert.equal(readDemoSession({ storage, now: NOW }), null)
  const session = startDemoSession({ university: 'univ-rennes', analyticsEnabled: true }, { storage, now: NOW })
  assert.deepEqual(session, { startedAt: NOW, university: 'univ-rennes', analyticsEnabled: true })
  // Kept by the browser: another tab, a reload, read the same.
  assert.deepEqual(readDemoSession({ storage, now: NOW + 1000 }), session)
  assert.deepEqual(JSON.parse(storage.getItem(DEMO_SESSION_KEY)), session)
})

test('the sign-in holds nothing but when, where and the server\'s switch', () => {
  const storage = createStorage()
  startDemoSession({ university: 'univ-rennes', analyticsEnabled: 'yes', user: 'someone', password: 'tafac-demo' }, { storage, now: NOW })
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(DEMO_SESSION_KEY))).sort(), ['analyticsEnabled', 'startedAt', 'university'])
  assert.equal(readDemoSession({ storage, now: NOW }).analyticsEnabled, false)
  startDemoSession({}, { storage, now: NOW })
  assert.deepEqual(readDemoSession({ storage, now: NOW }), { startedAt: NOW, university: null, analyticsEnabled: false })
})

test('it lasts thirty days, as the session cookie did', () => {
  const storage = createStorage()
  startDemoSession({ university: 'univ-rennes' }, { storage, now: NOW })
  assert.equal(DEMO_SESSION_TTL_MS, 30 * DAY)
  assert.ok(readDemoSession({ storage, now: NOW + 30 * DAY }))
  assert.equal(readDemoSession({ storage, now: NOW + 30 * DAY + 1 }), null)
  // A clock set back since doesn't make it last longer.
  assert.equal(readDemoSession({ storage, now: NOW - 1 }), null)
})

test('a sign-out ends it for every tab', () => {
  const storage = createStorage()
  startDemoSession({ university: 'univ-rennes' }, { storage, now: NOW })
  endDemoSession({ storage })
  assert.equal(readDemoSession({ storage, now: NOW }), null)
  assert.equal(storage.getItem(DEMO_SESSION_KEY), null)
  // Ended already: nothing to do.
  endDemoSession({ storage })
})

test('what the storage holds is read with care', () => {
  for (const stored of ['', 'null', 'not json', '[]', '"demo"', '{}', '{"startedAt":"yesterday"}', `{"startedAt":${NOW + DAY}}`]) {
    assert.equal(readDemoSession({ storage: createStorage({ [DEMO_SESSION_KEY]: stored }), now: NOW }), null, stored)
  }
  const odd = createStorage({ [DEMO_SESSION_KEY]: JSON.stringify({ startedAt: NOW, university: 42, analyticsEnabled: 1 }) })
  assert.deepEqual(readDemoSession({ storage: odd, now: NOW }), { startedAt: NOW, university: null, analyticsEnabled: false })
})

test('without storage, the demo lasts for the page', () => {
  endDemoSession({ storage: blockedStorage })
  assert.equal(readDemoSession({ storage: blockedStorage, now: NOW }), null)
  startDemoSession({ university: 'univ-rennes-2' }, { storage: blockedStorage, now: NOW })
  assert.equal(readDemoSession({ storage: blockedStorage, now: NOW }).university, 'univ-rennes-2')
  assert.equal(readDemoSession({ storage: null, now: NOW }).university, 'univ-rennes-2')
  // A storage that works says what is so, whatever this page remembers.
  assert.equal(readDemoSession({ storage: createStorage(), now: NOW }), null)
  endDemoSession({ storage: blockedStorage })
  assert.equal(readDemoSession({ storage: null, now: NOW }), null)
})

test('another tab\'s sign-in or sign-out is heard', () => {
  const listeners = new Set()
  const target = {
    addEventListener: (type, listener) => type === 'storage' && listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
  }
  let heard = 0
  const stop = onDemoSessionChange(() => {
    heard += 1
  }, target)
  const fire = (key) => listeners.forEach((listener) => listener({ key }))
  fire('l-ent:theme')
  assert.equal(heard, 0)
  fire(DEMO_SESSION_KEY)
  // The whole storage cleared.
  fire(null)
  assert.equal(heard, 2)
  stop()
  fire(DEMO_SESSION_KEY)
  assert.equal(heard, 2)
})
