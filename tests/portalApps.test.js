import assert from 'node:assert/strict'
import test from 'node:test'
import { getApplicationKey, orderApplications, placeInUsualOrder, resolveFavoriteKeys, toApplications } from '../src/portalApps.js'

const app = (id, title, more = {}) => ({
  id,
  title,
  description: null,
  url: `https://${id}.example.fr/`,
  iconUrl: null,
  category: null,
  favorite: false,
  ...more,
})

test('a listed application becomes a tile that opens in a new tab', () => {
  const [planning] = toApplications([
    app('webapp-ade', 'Mon emploi du temps', { description: ' Le planning ', url: 'https://planning.example.fr/portal/', favorite: true }),
  ])
  assert.deepEqual(planning, {
    id: 'webapp-ade',
    listed: true,
    relay: false,
    title: 'Mon emploi du temps',
    description: 'Le planning',
    href: 'https://planning.example.fr/portal/',
    target: '_blank',
    starred: true,
  })
  assert.equal(getApplicationKey(planning), 'webapp-ade')
})

test('the university names, sorts and leaves out applications by their title', () => {
  const applications = toApplications([
    // Accents decomposed, as a portal may send them.
    app('loxya', 'Prêt de matériel'.normalize('NFD')),
    app('notes', 'Portail de notes'),
    app('old', 'Ancien service'),
  ], {
    titleOverrides: { 'prêt de matériel': 'Loxya' },
    getCategory: (title) => (title.includes('notes') ? 'Scolarité' : null),
    isUnavailable: (application) => application.id === 'old',
    launchRelay: true,
  })
  assert.deepEqual(applications.map((application) => [application.id, application.title, application.category, application.relay]), [
    ['loxya', 'Loxya', undefined, true],
    ['notes', 'Portail de notes', 'Scolarité', true],
  ])
})

test('what is no application is no tile', () => {
  const applications = toApplications([
    app('one', 'Une'),
    app('one', 'Une, listed twice'),
    app('', 'No id'),
    app('no-title', '  '),
    app('relative', 'Relative', { url: '/p/relative' }),
    app('script', 'Script', { url: 'javascript:alert(1)' }),
    app('no-url', 'No url', { url: null }),
    null,
    'text',
  ])
  assert.deepEqual(applications.map((application) => application.id), ['one'])
  assert.deepEqual(toApplications(null), [])
  assert.deepEqual(toApplications({ apps: [] }), [])
})

const tiles = (...entries) => toApplications(entries.map(([id, title, favorite = false]) => app(id, title, { favorite })))

test('apps the portal moved to its favourites go back among the others', () => {
  // uPortal lists a starred app in its favourites folder only: the server's
  // list ends with them.
  const applications = tiles(['dossier', 'Dossier'], ['stages', 'Stages'], ['wifi', 'Wifi'], ['planning', 'Planning', true], ['annuaire', 'Annuaire', true])
  // Never seen before: each at its alphabetical place.
  assert.deepEqual(orderApplications(applications).map(getApplicationKey), ['annuaire', 'dossier', 'planning', 'stages', 'wifi'])
  // Seen before: where it sat, right after the app that preceded it.
  const remembered = ['dossier', 'stages', 'planning', 'wifi']
  assert.deepEqual(orderApplications(applications, remembered).map(getApplicationKey), ['annuaire', 'dossier', 'stages', 'planning', 'wifi'])
})

test('a starred app the portal still lists among the others keeps its place', () => {
  const applications = tiles(['b', 'B', true], ['a', 'A'], ['c', 'C'])
  assert.deepEqual(orderApplications(applications).map(getApplicationKey), ['b', 'a', 'c'])
  // All starred, or none listed: the server's order.
  assert.deepEqual(orderApplications(tiles(['b', 'B', true], ['a', 'A', true])).map(getApplicationKey), ['b', 'a'])
  assert.deepEqual(orderApplications([]), [])
})

test('an app remembered first goes first', () => {
  const [a, b, c] = tiles(['a', 'A'], ['b', 'B'], ['c', 'C'])
  assert.deepEqual(placeInUsualOrder([a, b], [c], ['c', 'a', 'b']).map(getApplicationKey), ['c', 'a', 'b'])
})

test('the favourites start from the portal\'s once, then are the browser\'s', () => {
  const applications = tiles(['mail', 'Messagerie', true], ['notes', 'Notes'], ['planning', 'Planning', true])
  // Nothing stored yet: the apps starred on the portal, to be stored.
  assert.deepEqual(resolveFavoriteKeys(null, applications), { keys: ['mail', 'planning'], seeded: true })
  // Stored, even empty: the student's own choice, whatever the portal says.
  assert.deepEqual(resolveFavoriteKeys([], applications), { keys: [], seeded: false })
  assert.deepEqual(resolveFavoriteKeys(['notes', 7, 'gone'], applications), { keys: ['notes', 'gone'], seeded: false })
  // A portal that stars nothing starts with none.
  assert.deepEqual(resolveFavoriteKeys(null, tiles(['a', 'A'])), { keys: [], seeded: true })
})
