import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildZimbraAutoCompleteRequest,
  normalizeZimbraAutoComplete,
  searchDemoMailContacts,
} from '../server/mailAutocomplete.js'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { loadServerConfig } from '../universities/index.js'

// An AutoCompleteResponse as Zimbra gives it in JSON (attributes as keys),
// trimmed: a contact, a past correspondent, the directory, a mailing list,
// a contact group (no address of its own) and some junk.
const response = {
  canBeCached: true,
  match: [
    { email: '"Camille Martin" <camille.martin@etudiant.univ-rennes.fr>', type: 'contact', ranking: '14', isGroup: false, id: '1203', l: '7', first: 'Camille', last: 'Martin', fileas: '8:Martin Camille' },
    { email: '<thomas.lemoine@univ-rennes.fr>', type: 'rankingTable', ranking: '9', isGroup: false },
    { email: '"Scolarité IUT" <scolarite-iut-lannion@univ-rennes.fr>', type: 'gal', ranking: '0', isGroup: false, full: 'Scolarité IUT de Lannion' },
    { email: '"MMI 2" <mmi2-lannion@listes.univ-rennes.fr>', type: 'gal', isGroup: '1', exp: true },
    { type: 'contact', isGroup: true, display: 'Mon groupe TD', id: '1300' },
    // The same address again, in another case: once.
    { email: 'CAMILLE.MARTIN@etudiant.univ-rennes.fr', type: 'gal' },
    { email: '"Injected\r\nBcc: x@y.fr" <evil@x.fr>', type: 'gal' },
    { email: 'pas une adresse', type: 'contact' },
    { email: 'a@b.fr, c@d.fr', type: 'contact' },
    { email: `${'x'.repeat(600)}@b.fr`, type: 'gal' },
    { email: '"boss@univ-rennes.fr" <someone@else.fr>', type: 'gal' },
    { email: '"Odd" <odd@univ-rennes.fr>', type: 'somethingNew' },
  ],
}

test('the request is fixed but for the text searched', () => {
  assert.deepEqual(buildZimbraAutoCompleteRequest('cam'), { name: 'cam', t: 'account', includeGal: 1 })
})

test('Zimbra\'s matches become { name, email, kind }, nothing else', () => {
  assert.deepEqual(normalizeZimbraAutoComplete(response), [
    { name: 'Camille Martin', email: 'camille.martin@etudiant.univ-rennes.fr', kind: 'contact' },
    { name: '', email: 'thomas.lemoine@univ-rennes.fr', kind: 'recent' },
    { name: 'Scolarité IUT', email: 'scolarite-iut-lannion@univ-rennes.fr', kind: 'directory' },
    { name: 'MMI 2', email: 'mmi2-lannion@listes.univ-rennes.fr', kind: 'group' },
    // A line break in it (never one address then), a list, junk, an
    // oversized entry and a contact group are left out; a name that is an
    // address is dropped.
    { name: '', email: 'someone@else.fr', kind: 'directory' },
    { name: 'Odd', email: 'odd@univ-rennes.fr', kind: 'contact' },
  ])
})

test('a name falls back to the full one, then first and last', () => {
  assert.deepEqual(normalizeZimbraAutoComplete({ match: { email: 'lea@univ.fr', type: 'gal', full: 'Léa Moreau' } }), [
    { name: 'Léa Moreau', email: 'lea@univ.fr', kind: 'directory' },
  ])
  assert.deepEqual(normalizeZimbraAutoComplete({ match: [{ email: 'lea@univ.fr', type: 'contact', first: 'Léa', last: 'Moreau' }] }), [
    { name: 'Léa Moreau', email: 'lea@univ.fr', kind: 'contact' },
  ])
})

test('an empty, odd or oversized answer gives a short list', () => {
  assert.deepEqual(normalizeZimbraAutoComplete({}), [])
  assert.deepEqual(normalizeZimbraAutoComplete(null), [])
  assert.deepEqual(normalizeZimbraAutoComplete({ match: 'x' }), [])
  const many = { match: Array.from({ length: 500 }, (_, index) => ({ email: `etu${index}@univ.fr`, type: 'gal' })) }
  assert.equal(normalizeZimbraAutoComplete(many).length, 12)
  assert.equal(normalizeZimbraAutoComplete(many, 5).length, 5)
})

test('the demo address book is searched as Zimbra would', () => {
  assert.deepEqual(searchDemoMailContacts('lann').map((contact) => contact.email), [
    'scolarite-iut-lannion@univ-rennes.fr',
    'bu-lannion@univ-rennes.fr',
    'bde.infocom.lannion@gmail.com',
    'secretariat-infocom-lannion@univ-rennes.fr',
    'infocom3-lannion@listes.univ-rennes.fr',
  ])
  assert.deepEqual(searchDemoMailContacts('lea mo').map((contact) => contact.name), ['Léa Moreau'])
  assert.deepEqual(searchDemoMailContacts('zzz'), [])
})

async function withApp(run) {
  const config = await loadServerConfig('univ-rennes')
  const app = createEntAuthApp(config, {
    analytics: {},
    session: { secret: 'b'.repeat(44), production: false },
  })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const signIn = async () => {
    const response = await fetch(`${base}/__ent_auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
    })
    assert.equal(response.status, 200)
    return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  }
  try {
    await run({ base, signIn })
  } finally {
    server.close()
  }
}

test('the route: signed in only, same-origin, no-store, short queries asked nothing', () => withApp(async ({ base, signIn }) => {
  const anonymous = await fetch(`${base}/__ent_auth/mail/autocomplete?q=cam`)
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.headers.get('cache-control'), 'no-store')

  const cookie = await signIn()
  const ask = (query, headers = {}) => fetch(`${base}/__ent_auth/mail/autocomplete?${query}`, { headers: { cookie, ...headers } })

  const found = await ask('q=thom')
  assert.equal(found.status, 200)
  assert.equal(found.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await found.json(), { suggestions: [{ name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr', kind: 'recent' }] })

  assert.deepEqual(await (await ask('q=t')).json(), { suggestions: [] })
  assert.deepEqual(await (await ask('q=***')).json(), { suggestions: [] })
  // An array or an object for `q` is no query at all.
  assert.deepEqual(await (await ask('q=thom&q=as')).json(), { suggestions: [] })
  assert.deepEqual(await (await ask('q[a]=thom')).json(), { suggestions: [] })

  const crossSite = await ask('q=thom', { 'sec-fetch-site': 'cross-site' })
  assert.equal(crossSite.status, 403)
}))
