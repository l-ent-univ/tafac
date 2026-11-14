import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { buildSettingsTransferUrl, importTransferredSettings, isOldAddress, isSettingsTransferArrival, TRANSFERABLE_KEYS } from '../src/settingsTransfer.js'

// Where a real transfer comes from.
const OLD_SITE = 'https://lent.tomthings.fr/'

function createStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    entries: () => Object.fromEntries(map),
  }
}

function openLink(url, storage, referrer = OLD_SITE) {
  // Behaves like window.location: replaceState drops the hash at once.
  const location = new URL(url)
  const replaced = []
  const imported = importTransferredSettings({
    location,
    history: {
      state: null,
      replaceState: (_state, _title, next) => {
        replaced.push(next)
        location.hash = ''
      },
    },
    storage,
    referrer,
  })
  return { imported, replaced }
}

test('settings survive the trip from the old address', () => {
  const oldSite = createStorage({
    'l-ent:establishment': '{"user":"jdupont","value":"iutlan"}',
    'l-ent:weather-city': 'Lannion — Côtes-d’Armor',
    'l-ent:next-class-cache': '{"events":[]}',
    'l-ent:custom-background': 'data:image/webp;base64,AAAA',
  })
  const url = buildSettingsTransferUrl('https://tafac.fr/', oldSite)
  assert.match(url, /^https:\/\/tafac\.fr\/#import=[\w-]+$/)

  const newSite = createStorage()
  const { imported, replaced } = openLink(url, newSite)
  assert.equal(imported, 2)
  assert.deepEqual(newSite.entries(), {
    'l-ent:establishment': '{"user":"jdupont","value":"iutlan"}',
    'l-ent:weather-city': 'Lannion — Côtes-d’Armor',
  })
  assert.deepEqual(replaced, ['/'])
})

test('settings already set on Tafac are kept', () => {
  const url = buildSettingsTransferUrl('https://tafac.fr', createStorage({ 'l-ent:weather-city': 'Brest' }))
  const newSite = createStorage({ 'l-ent:weather-city': 'Rennes' })
  assert.equal(openLink(url, newSite).imported, 0)
  assert.equal(newSite.getItem('l-ent:weather-city'), 'Rennes')
})

test('unknown keys and broken links are ignored', () => {
  const payload = Buffer.from(JSON.stringify({ 'l-ent:session-cache': 'x', other: 'y' })).toString('base64url')
  const storage = createStorage()
  assert.equal(openLink(`https://tafac.fr/#import=${payload}`, storage).imported, 0)
  assert.equal(openLink('https://tafac.fr/#import=%%%', storage).imported, 0)
  assert.equal(openLink('https://tafac.fr/#import=', storage).imported, 0)
  assert.deepEqual(storage.entries(), {})

  const untouched = openLink('https://tafac.fr/#about', storage)
  assert.deepEqual(untouched, { imported: 0, replaced: [] })
})

function linkWith(settings) {
  return `https://tafac.fr/#import=${Buffer.from(JSON.stringify(settings)).toString('base64url')}`
}

test('a link is only followed from the old address', () => {
  assert.equal(isOldAddress('https://lent.tomthings.fr/'), true)
  assert.equal(isOldAddress('https://tomthings.fr/lent'), true)
  for (const elsewhere of ['', undefined, 'https://evil.example/', 'https://tomthings.fr.evil.example/', 'https://eviltomthings.fr/', 'http://lent.tomthings.fr/', 'https://tafac.fr/', 'not a url']) {
    assert.equal(isOldAddress(elsewhere), false, String(elsewhere))
  }

  const url = linkWith({ 'l-ent:weather-city': 'Brest', 'l-ent:anonymous-analytics': 'false' })
  for (const referrer of ['', 'https://evil.example/', 'https://partage.univ-rennes.fr/']) {
    const storage = createStorage()
    // Nothing is stored; the link still leaves the address bar.
    assert.deepEqual(openLink(url, storage, referrer), { imported: 0, replaced: ['/'] })
    assert.deepEqual(storage.entries(), {})
    assert.equal(isSettingsTransferArrival({ location: new URL(url), referrer }), false)
  }

  assert.equal(isSettingsTransferArrival({ location: new URL(url), referrer: OLD_SITE }), true)
  assert.equal(isSettingsTransferArrival({ location: new URL('https://tafac.fr/#about'), referrer: OLD_SITE }), false)
  assert.equal(openLink(url, createStorage()).imported, 2)
})

test('a setting only comes in the shape its reader takes', () => {
  const refused = {
    // A reader that expects a list would break on these.
    'l-ent:favorites-order': ['{"length":1}', 'null', '"abc"', '[1,2]', '[["a"]]', 'not json'],
    'l-ent:local-pins': ['null', '{}', '[null]'],
    'l-ent:local-favorites': ['{"0":"a"}'],
    // Settings are plain data, a few levels deep.
    'l-ent:student-tp': ['null', `{"value":${'['.repeat(8)}${']'.repeat(8)}}`, 'line\nbreak'],
    'l-ent:weather-city': ['x'.repeat(201), 'Brest\u0000'],
    // A colour is a colour, not CSS that loads something.
    'l-ent:grade-colors': ['{"R1.01":"url(https://evil.example/x)"}', '{"R1.01":"red;background:url(x)"}', '[]', 'null', '{"R1.01":12}'],
  }
  for (const [key, values] of Object.entries(refused)) {
    for (const value of values) {
      const storage = createStorage()
      assert.equal(openLink(linkWith({ [key]: value }), storage).imported, 0, `${key}: ${value}`)
      assert.deepEqual(storage.entries(), {})
    }
  }

  const accepted = {
    'l-ent:favorites-order': '["notes-iut","mail"]',
    'l-ent:local-pins': '[]',
    'l-ent:student-tp': '{"user":"jdupont","value":{"version":4,"tpResourceId":"1234","path":["BUT","TP A"]}}',
    'l-ent:establishment': 'iutlan',
    'l-ent:hidden-widgets': '{"user":"jdupont","value":["weather","mail"]}',
    'l-ent:greeting-hidden': 'true',
    // An older version's bare value.
    'l-ent:show-app-descriptions': '["a","b"]',
    'l-ent:anonymous-analytics': '{"user":null,"value":false}',
    'l-ent:weather-city': 'Lannion — Côtes-d’Armor',
    'l-ent:grade-colors': '{"R1.01":"hsl(212, 60%, 42%)","R1.02":"#0073d1"}',
  }
  const storage = createStorage()
  assert.equal(openLink(linkWith(accepted), storage).imported, Object.keys(accepted).length)
  assert.deepEqual(storage.entries(), accepted)
})

test('every transferable key has its rule', () => {
  assert.equal(TRANSFERABLE_KEYS.length, 16)
  assert.equal(new Set(TRANSFERABLE_KEYS).size, 16)
})
