import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTempoRange,
  buildTempoYearWindow,
  createTempoApiClient,
  getTempoAcademicYears,
  normalizeTempoEvent,
  parseTempoDateTime,
} from '../tempoApi.js'

test('TEMPO times are Paris clock times, across the clock changes', () => {
  assert.equal(parseTempoDateTime('2026-11-02 10:45').toISOString(), '2026-11-02T09:45:00.000Z')
  assert.equal(parseTempoDateTime('2026-10-08 10:45').toISOString(), '2026-10-08T08:45:00.000Z')
  // Day after the October change, and the March one.
  assert.equal(parseTempoDateTime('2026-10-26 08:00').toISOString(), '2026-10-26T07:00:00.000Z')
  assert.equal(parseTempoDateTime('2027-03-29 08:00').toISOString(), '2027-03-29T06:00:00.000Z')
  // A bare date is its midnight.
  assert.equal(parseTempoDateTime('2026-11-02').toISOString(), '2026-11-01T23:00:00.000Z')
  assert.equal(parseTempoDateTime('02/11/2026 10:45'), null)
  assert.equal(parseTempoDateTime(null), null)
})

test('a TEMPO event becomes a planning event', () => {
  const event = normalizeTempoEvent({
    id: 9909,
    start: '2026-11-02 10:45',
    end: '2026-11-02 12:45',
    str_start: '10:45',
    str_end: '12:45',
    title: 'UEF 2 - Histoire des médias - CM1',
    description: 'L2 INFO-COM CM1 - G 1 2 3',
    location: 'B204 Bâtiment B\nCampus Villejean',
    people: ['Martin C.', ''],
    color: '62a5ff',
    url: '',
    url_label: '',
    info: '',
  })

  assert.deepEqual(event, {
    uid: 'tempo-9909',
    title: 'UEF 2 - Histoire des médias - CM1',
    teacher: 'Martin C.',
    location: 'B204 Bâtiment B - Campus Villejean',
    groups: ['L2 INFO-COM CM1 - G 1 2 3'],
    groupsLabel: 'L2 INFO-COM CM1 - G 1 2 3',
    start: '2026-11-02T09:45:00.000Z',
    end: '2026-11-02T11:45:00.000Z',
    startMs: Date.parse('2026-11-02T09:45:00.000Z'),
    endMs: Date.parse('2026-11-02T11:45:00.000Z'),
    date: '2026-11-02',
    timeLabel: '10:45 - 12:45',
    allDay: false,
    editable: false,
    color: '#62a5ff',
    hue: null,
    link: null,
    linkLabel: null,
    notes: null,
    resourceId: 'tempo',
    activityId: null,
  })
})

test('the HTML of the text fields is read as text', () => {
  const event = normalizeTempoEvent({
    id: 3,
    start: '2026-11-03 09:00',
    end: '2026-11-03 10:00',
    title: 'Théâtre &amp; danse <b>CC</b>',
    location: 'Salle A<br>Salle B &#39;2&#39;',
    people: ['M&#233;nard A.', 'Le&nbsp;Goff B.'],
    info: 'Cours <strong>annulé</strong>',
    url: 'https://pix.example.fr/planning',
    url_label: 'VOTRE PLANNING :',
  })

  assert.equal(event.title, 'Théâtre & danse CC')
  assert.equal(event.location, "Salle A - Salle B '2'")
  assert.equal(event.teacher, 'Ménard A. - Le Goff B.')
  assert.equal(event.notes, 'Cours annulé')
  assert.equal(event.link, 'https://pix.example.fr/planning')
  assert.equal(event.linkLabel, 'VOTRE PLANNING')
})

test('a whole-day event runs from midnight to the next one', () => {
  const event = normalizeTempoEvent({ id: 4, start: '2026-11-11', end: '2026-11-11', title: 'Férié', people: [], location: '' })
  assert.equal(event.allDay, true)
  assert.equal(event.start, '2026-11-10T23:00:00.000Z')
  assert.equal(event.end, '2026-11-11T23:00:00.000Z')
  assert.equal(event.timeLabel, 'Toute la journée')
  assert.equal(event.date, '2026-11-11')
})

test('an event without a readable start is dropped', () => {
  assert.equal(normalizeTempoEvent({ id: 1, start: '', end: '' }), null)
  assert.equal(normalizeTempoEvent(null), null)
  const bare = normalizeTempoEvent({ id: 2, start: '2026-11-03 09:00', end: '2026-11-03 10:00', people: [], location: '' })
  assert.equal(bare.title, 'Cours')
  assert.equal(bare.groups.length, 0)
})

test('the asked days and their academic years', () => {
  assert.deepEqual(buildTempoRange('2026-11-02', 7), { start: '2026-11-02', end: '2026-11-09' })
  assert.deepEqual(buildTempoRange('2026-12-28', 7), { start: '2026-12-28', end: '2027-01-04' })
  assert.deepEqual(buildTempoRange('', 1, new Date(2026, 10, 5)), { start: '2026-11-05', end: '2026-11-06' })
  assert.deepEqual(getTempoAcademicYears({ start: '2026-11-02', end: '2026-11-09' }), [2026])
  assert.deepEqual(getTempoAcademicYears({ start: '2027-06-28', end: '2027-07-05' }), [2026, 2027])
  assert.deepEqual(getTempoAcademicYears({ start: '2027-06-24', end: '2027-07-01' }), [2026])
  assert.deepEqual(buildTempoYearWindow(2026), { start: '2026-07-01', end: '2027-08-31' })
})

const YEAR_EVENTS = [
  { id: 2, start: '2026-11-04 14:00', end: '2026-11-04 16:00', title: 'B', people: [], location: '' },
  { id: 1, start: '2026-11-02 10:45', end: '2026-11-02 12:45', title: 'A', people: [], location: '' },
  { id: 1, start: '2026-11-02 10:45', end: '2026-11-02 12:45', title: 'A', people: [], location: '' },
  { id: 3, start: '2026-11-09 08:00', end: '2026-11-09 10:00', title: 'Next week', people: [], location: '' },
]

// A fake TEMPO and CAS: the API answers 401 JSON until /auth got a ticket.
function createFakeTempo({
  casAnswer = 'ticket',
  authLoop = false,
  eventsAnswer = () => Response.json(YEAR_EVENTS),
  timeoutMs,
} = {}) {
  const calls = []
  const state = { signedIn: false }
  const fetchWithJar = async (url, jar, options = {}) => {
    const { hostname, pathname, searchParams } = new URL(url)
    if (hostname === 'cas.example.fr') {
      calls.push(['cas', url])
      return casAnswer === 'ticket'
        ? new Response(null, { status: 302, headers: { location: 'https://tempo.example.fr/auth?ticket=ST-1' } })
        : new Response('<form><input name="execution" value="x"></form>', { status: 200 })
    }
    if (pathname === '/auth') {
      calls.push(['auth', url])
      if (searchParams.has('ticket')) state.signedIn = true
      if (authLoop && !searchParams.has('ticket')) return new Response('Forbidden', { status: 403 })
      return new Response(null, { status: 302, headers: { location: searchParams.has('ticket') ? '/auth' : '/' } })
    }
    if (pathname === '/api/events') {
      calls.push(['events', url])
      if (!state.signedIn) return Response.json({ message: 'Authentication required' }, { status: 401 })
      return eventsAnswer(options)
    }
    calls.push(['other', url])
    return new Response('page', { status: 200 })
  }
  const client = createTempoApiClient({
    casOrigin: 'https://cas.example.fr',
    tempoOrigin: 'https://tempo.example.fr',
    fetchWithJar,
    timeoutMs,
  })
  return { client, calls, state }
}

test('without a TEMPO session the CAS signs in once, then the year is read and cut to the week', async () => {
  const { client, calls } = createFakeTempo()
  const result = await client.fetchPortalEvents({}, { date: '2026-11-02', lookaheadDays: 7, cacheScope: 'a' })

  assert.deepEqual(calls.map(([kind]) => kind), ['events', 'cas', 'auth', 'auth', 'events'])
  assert.equal(calls[1][1], 'https://cas.example.fr/login?service=https%3A%2F%2Ftempo.example.fr%2Fauth')
  assert.equal(calls[4][1], 'https://tempo.example.fr/api/events?start=2026-07-01&end=2027-08-31')
  assert.deepEqual(result.events.map((event) => event.title), ['A', 'B'])
  assert.deepEqual(result.resourceIds, ['tempo'])

  // Another week of the same year: from the cache, no request.
  const nextWeek = await client.fetchPortalEvents({}, { date: '2026-11-09', lookaheadDays: 7, cacheScope: 'a' })
  assert.equal(nextWeek.cache, 'hit')
  assert.deepEqual(nextWeek.events.map((event) => event.title), ['Next week'])
  assert.equal(calls.length, 5)
})

test('weeks asked in parallel share one sign-in and one request', async () => {
  const { client, calls } = createFakeTempo()
  await Promise.all(['2026-11-02', '2026-11-09', '2026-11-16'].map((date) => (
    client.fetchPortalEvents({}, { date, lookaheadDays: 7, cacheScope: 'b' })
  )))
  assert.equal(calls.filter(([kind]) => kind === 'cas').length, 1)
  assert.equal(calls.filter(([kind]) => kind === 'events').length, 2)
})

test('a range across two academic years asks both', async () => {
  const { client, calls } = createFakeTempo()
  await client.fetchPortalEvents({}, { date: '2027-06-28', lookaheadDays: 7, cacheScope: 'c' })
  const asked = calls.filter(([kind]) => kind === 'events').map(([, url]) => new URL(url).searchParams.get('start'))
  assert.ok(asked.includes('2026-07-01'))
  assert.ok(asked.includes('2027-07-01'))
})

test('an error from TEMPO is reported without a pointless sign-in', async () => {
  const { client, calls, state } = createFakeTempo({ eventsAnswer: () => Response.json({ status: 500 }, { status: 500 }) })
  state.signedIn = true
  await assert.rejects(client.fetchPortalEvents({}, { date: '2026-11-02' }), /TEMPO answered 500/)
  assert.deepEqual(calls.map(([kind]) => kind), ['events'])
})

test('a JSON object instead of the list is an error', async () => {
  const { client, state } = createFakeTempo({ eventsAnswer: () => Response.json({ message: 'nope' }) })
  state.signedIn = true
  await assert.rejects(client.fetchPortalEvents({}, { date: '2026-11-02' }), /unexpected answer/)
})

test('an HTML page even after the sign-in is an error, not an empty week', async () => {
  const { client } = createFakeTempo({ eventsAnswer: () => new Response('<html>maintenance</html>', { status: 200 }) })
  await assert.rejects(client.fetchPortalEvents({}, { date: '2026-11-02' }), /no session after the CAS/)
})

test('an expired CAS session is an error', async () => {
  const { client } = createFakeTempo({ casAnswer: 'form' })
  await assert.rejects(client.fetchPortalEvents({}, { date: '2026-11-02' }), /CAS session has expired/)
})

test('a sign-in that ends in TEMPO\'s /auth 403 loop is still signed in', async () => {
  const { client } = createFakeTempo({ authLoop: true })
  const result = await client.fetchPortalEvents({}, { date: '2026-11-02' })
  assert.deepEqual(result.events.map((event) => event.title), ['A', 'B'])
})

test('a TEMPO that never answers times out', async () => {
  const { client, state } = createFakeTempo({
    timeoutMs: 30,
    eventsAnswer: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason))
    }),
  })
  state.signedIn = true
  await assert.rejects(client.fetchPortalEvents({}, { date: '2026-11-02' }), (error) => error.name === 'TimeoutError')
})

test('the tree is one personal group, adopted as the default selection', async () => {
  const { client } = createFakeTempo()
  const tree = await client.fetchPortalTree({}, {})
  assert.equal(tree.root.children[0].id, 'tempo')
  assert.equal(tree.defaultSelection.resourceId, 'tempo')
  assert.equal(tree.defaultSelection.label, 'Mon emploi du temps')
  assert.equal(tree.defaultSelection.tdResourceId, null)
  assert.deepEqual((await client.searchPortalTree({}, 'L2')).results, [])
})

test('a whole academic year without a class is no timetable, a free week is not', async () => {
  const empty = createFakeTempo({ eventsAnswer: () => Response.json([]) })
  const none = await empty.client.fetchPortalEvents({}, { date: '2026-11-02', cacheScope: 'none' })
  assert.equal(none.noTimetable, true)
  assert.equal(none.events.length, 0)

  const { client } = createFakeTempo()
  const freeWeek = await client.fetchPortalEvents({}, { date: '2026-10-26', lookaheadDays: 7, cacheScope: 'free' })
  assert.equal(freeWeek.events.length, 0)
  assert.equal(freeWeek.noTimetable, false)
})
