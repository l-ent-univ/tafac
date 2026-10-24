import assert from 'node:assert/strict'
import test from 'node:test'
import { pickBootUniversity, readEntryPath } from '../src/universityRuntime.js'
import {
  STORAGE_UNIVERSITY_KEY,
  UNIVERSITY_SETTINGS_PREFIX,
  switchUniversityStorage,
} from '../src/universityStorage.js'

const UNIVERSITIES = [
  { id: 'univ-rennes', slug: 'rennes', listed: true },
  { id: 'univ-exemple', slug: 'exemple', listed: false },
]

const multi = (overrides = {}) => ({
  mode: 'multi',
  defaultUniversity: 'univ-rennes',
  session: null,
  host: null,
  universities: UNIVERSITIES,
  ...overrides,
})

test('readEntryPath: /<slug>, its id, the picker, nothing else', () => {
  assert.deepEqual(readEntryPath('/rennes', UNIVERSITIES), { kind: 'university', id: 'univ-rennes' })
  assert.deepEqual(readEntryPath('/Rennes/', UNIVERSITIES), { kind: 'university', id: 'univ-rennes' })
  assert.deepEqual(readEntryPath('/exemple', UNIVERSITIES), { kind: 'university', id: 'univ-exemple' })
  assert.deepEqual(readEntryPath('/univexemple', UNIVERSITIES), { kind: 'university', id: 'univ-exemple' })
  assert.deepEqual(readEntryPath('/univ-rennes', UNIVERSITIES), { kind: 'university', id: 'univ-rennes' })
  assert.deepEqual(readEntryPath('/universites', UNIVERSITIES), { kind: 'picker' })
  assert.equal(readEntryPath('/', UNIVERSITIES), null)
  assert.equal(readEntryPath('/lille', UNIVERSITIES), null)
  assert.equal(readEntryPath('/rennes/notes', UNIVERSITIES), null)
})

test('pickBootUniversity: signed in, the session wins', () => {
  const info = multi({ session: 'univ-exemple', host: 'univ-rennes' })
  assert.equal(pickBootUniversity({ info, entry: { kind: 'university', id: 'univ-rennes' }, storedChoice: 'univ-rennes' }), 'univ-exemple')
  assert.equal(pickBootUniversity({ info, entry: { kind: 'picker' } }), 'univ-exemple')
})

test('pickBootUniversity: signed out, the address, then the choice, then the old address', () => {
  assert.equal(pickBootUniversity({ info: multi(), entry: { kind: 'university', id: 'univ-exemple' }, storedChoice: 'univ-rennes' }), 'univ-exemple')
  assert.equal(pickBootUniversity({ info: multi(), storedChoice: 'univ-rennes' }), 'univ-rennes')
  assert.equal(pickBootUniversity({ info: multi(), entry: { kind: 'picker' }, storedChoice: 'univ-rennes' }), null)
  assert.equal(pickBootUniversity({ info: multi({ host: 'univ-exemple' }) }), 'univ-exemple')
  assert.equal(pickBootUniversity({ info: multi({ host: 'univ-exemple' }), storedChoice: 'univ-rennes' }), 'univ-rennes')
})

test('pickBootUniversity: nothing picked yet is the neutral page', () => {
  assert.equal(pickBootUniversity({ info: multi() }), null)
  // A choice of a university this server no longer has is ignored.
  assert.equal(pickBootUniversity({ info: multi(), storedChoice: 'univ-lille' }), null)
})

test('pickBootUniversity: one university on the server is always that one', () => {
  const info = { mode: 'single', defaultUniversity: 'univ-exemple', universities: [{ id: 'univ-exemple', slug: 'exemple' }] }
  assert.equal(pickBootUniversity({ info }), 'univ-exemple')
  assert.equal(pickBootUniversity({ info, entry: { kind: 'picker' }, storedChoice: 'univ-rennes' }), 'univ-exemple')
})

test('pickBootUniversity: offline, the last one picked', () => {
  assert.equal(pickBootUniversity({ info: null, storedChoice: 'univ-rennes' }), 'univ-rennes')
  assert.equal(pickBootUniversity({ info: null }), null)
})

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  }
}

test('switchUniversityStorage: data from before belongs to the old address, nothing moves', () => {
  const storage = memoryStorage({ 'l-ent:student-tp': 'tp-rennes', 'l-ent:theme': 'dark' })
  assert.equal(switchUniversityStorage('univ-rennes', { legacyUniversityId: 'univ-rennes', storage }), false)
  assert.deepEqual(storage.dump(), {
    'l-ent:student-tp': 'tp-rennes',
    'l-ent:theme': 'dark',
    [STORAGE_UNIVERSITY_KEY]: 'univ-rennes',
  })
})

test('switchUniversityStorage: another university sets the settings aside, and back', () => {
  const storage = memoryStorage({
    'l-ent:student-tp': 'tp-rennes',
    'l-ent:establishment': 'iutlan',
    'l-ent:grades-cache': '{}',
    'l-ent:theme': 'dark',
  })

  assert.equal(switchUniversityStorage('univ-exemple', { legacyUniversityId: 'univ-rennes', storage }), true)
  assert.equal(storage.getItem('l-ent:student-tp'), null)
  assert.equal(storage.getItem('l-ent:grades-cache'), null)
  assert.equal(storage.getItem('l-ent:theme'), 'dark')
  assert.equal(storage.getItem(STORAGE_UNIVERSITY_KEY), 'univ-exemple')
  assert.deepEqual(JSON.parse(storage.getItem(`${UNIVERSITY_SETTINGS_PREFIX}univ-rennes`)), {
    'l-ent:establishment': 'iutlan',
    'l-ent:student-tp': 'tp-rennes',
  })

  storage.setItem('l-ent:student-tp', 'tp-demo')
  assert.equal(switchUniversityStorage('univ-rennes', { legacyUniversityId: 'univ-rennes', storage }), true)
  assert.equal(storage.getItem('l-ent:student-tp'), 'tp-rennes')
  assert.equal(storage.getItem('l-ent:establishment'), 'iutlan')
  assert.equal(storage.getItem(`${UNIVERSITY_SETTINGS_PREFIX}univ-rennes`), null)
  assert.deepEqual(JSON.parse(storage.getItem(`${UNIVERSITY_SETTINGS_PREFIX}univ-exemple`)), { 'l-ent:student-tp': 'tp-demo' })
})

test('switchUniversityStorage: no known owner keeps the data', () => {
  const storage = memoryStorage({ 'l-ent:student-tp': 'tp' })
  assert.equal(switchUniversityStorage('univ-exemple', { storage }), false)
  assert.equal(storage.getItem('l-ent:student-tp'), 'tp')
})
