import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { DEMO_ACCOUNT, buildDemoApps } from '../src/demoAccount.js'
import { buildDemoCertificatePdf, createDemoServer } from '../src/demoServer.js'

// The page answers the demo account by itself (src/demoServer.js), with
// what the server answered a demo session. Both are asked the same here,
// while the server still has its own demo (entAuthApp.js: demoAccount).

const FEATURES = { ade: true, planning: true, grades: true, mail: true, moodleDeadlines: true, schoolCertificate: true }
const NOW = Date.UTC(2026, 10, 26, 9, 30)

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

async function ask(server, url, init) {
  const response = await server.answer(url, init)
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
}

const post = (server, url, body) => ask(server, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ── Route by route ─────────────────────────────────────────────────────────

test('the session, the account and the applications', async () => {
  const server = createDemoServer({ config: { id: 'univ-rennes-2', features: FEATURES }, session: () => ({ analyticsEnabled: true }) })
  assert.deepEqual(await ask(server, '/__ent_auth/session'), {
    status: 200,
    body: {
      authenticated: true,
      user: 'demo@tafac.fr',
      sessionMode: 'demo',
      sessionSource: null,
      canUseServerLaunch: false,
      degraded: false,
      degradedReason: null,
      analyticsEnabled: true,
      university: 'univ-rennes-2',
    },
    headers: (await server.answer('/__ent_auth/session')).headers,
  })
  assert.equal((await server.answer('/__ent_auth/session')).headers.get('content-type'), 'application/json; charset=utf-8')
  // The audience isn't measured unless the sign-in says the server does.
  assert.equal((await ask(createDemoServer({ config: { id: 'x' } }), '/__ent_auth/session')).body.analyticsEnabled, false)

  assert.deepEqual((await ask(server, '/__ent_auth/account')).body, { authenticated: true, sessionMode: 'demo', account: DEMO_ACCOUNT })
  assert.deepEqual((await ask(server, '/__ent_auth/apps')).body, { authenticated: true, sessionMode: 'demo', apps: buildDemoApps() })
  // Under the page's base path too, and whatever origin the address has.
  assert.equal((await ask(server, 'https://tafac.fr/base/__ent_auth/apps?x=1')).body.apps.length, 8)
})

test('a service the university doesn\'t have says so, as the server\'s', async () => {
  const server = createDemoServer({ config: { id: 'univ-sorbonne-nouvelle', features: { demo: true } } })
  for (const [url, feature] of [
    ['/__ent_auth/grades', 'grades'],
    ['/__ent_auth/grades/semester/1', 'grades'],
    ['/__ent_auth/mail/recent', 'mail'],
    ['/__ent_auth/mail', 'mail'],
    ['/__ent_auth/moodle/deadlines', 'moodleDeadlines'],
    ['/__ent_auth/timetable', 'planning'],
    ['/__ent_auth/timetable/tree', 'planning'],
  ]) {
    assert.deepEqual(await ask(server, url).then(({ status, body }) => [status, body]), [404, { ok: false, disabled: true, feature }], url)
  }
  assert.equal((await ask(server, '/__ent_auth/documents/school-certificate/status')).status, 404)
  assert.equal((await ask(server, '/__ent_auth/documents/school-certificate')).status, 404)
  assert.deepEqual(await server.upload({ name: 'a.txt', type: 'text/plain', size: 4 }), { status: 404, body: { ok: false, disabled: true, feature: 'mail' } })
  // The session and the applications need no service.
  assert.equal((await ask(server, '/__ent_auth/apps')).status, 200)
})

test('what isn\'t a route of the demo\'s is answered here all the same, never sent', async () => {
  const server = createDemoServer({ config: { id: 'univ-rennes-2', features: FEATURES } })
  assert.deepEqual(await ask(server, '/__ent_auth/nothing').then(({ status, body }) => [status, body]), [404, { error: 'Not found.' }])
  assert.equal((await ask(server, '/__ent_auth/mail/recent', { method: 'DELETE' })).status, 404)
  assert.equal((await ask(server, '/somewhere/else')).status, 404)
  // The demo account never reaches the university's portal.
  assert.equal((await ask(server, '/__ent_proxy/api/v5-1/userinfo')).status, 401)
  assert.equal((await ask(server, '/__ent_auth/mail/part?id=demo-mail-1&part=2')).status, 404)
  assert.deepEqual((await ask(server, '/__ent_auth/launch-preview?url=https%3A%2F%2Fmoodle.org%2F')).body.useServerLaunch, false)
  assert.equal((await ask(server, '/__ent_auth/launch-preview?url=javascript:alert(1)')).status, 400)
  // A request dropped before it left.
  await assert.rejects(server.answer('/__ent_auth/mail/recent', { signal: AbortSignal.abort() }), { name: 'AbortError' })
})

// The planning, as the gateway gives a real one (tonAPI's own answers): the
// server's demo has no such route, so these are the page's alone.
test('the planning is tonAPI\'s model: courses, the tree, a search', async () => {
  const server = createDemoServer({ config: { id: 'univ-rennes', features: FEATURES }, now: () => NOW })
  const week = await ask(server, '/__ent_auth/timetable?from=2026-11-23&to=2026-11-29')
  assert.equal(week.status, 200)
  assert.deepEqual(week.body.meta, { university: 'univ-rennes', establishment: null, provider: 'demo', fetchedAt: new Date(NOW).toISOString(), cacheSecs: null })
  const courses = week.body.data
  assert.ok(courses.length > 5)
  assert.deepEqual(Object.keys(courses[0]).sort(), ['activityId', 'color', 'description', 'end', 'groups', 'id', 'kind', 'link', 'rooms', 'start', 'teachers', 'title'])
  assert.ok(courses.every((course) => course.start >= '2026-11-22' && course.start < '2026-11-30'))
  // Without a resource: the student's own group, TP 3; another group's are its own.
  assert.deepEqual([...new Set(courses.flatMap((course) => course.groups))], ['TP 3'])
  const other = (await ask(server, '/__ent_auth/timetable?from=2026-11-23&to=2026-11-29&resources=11211')).body.data
  assert.deepEqual([...new Set(other.flatMap((course) => course.groups))], ['TP 1'])
  // A room: its classes alone; an id the demo doesn't know: none.
  const room = (await ask(server, '/__ent_auth/timetable?from=2026-11-23&to=2026-11-29&resources=9106')).body.data
  assert.ok(room.length > 0 && room.every((course) => course.rooms[0] === 'Amphi 1'))
  assert.deepEqual((await ask(server, '/__ent_auth/timetable?from=2026-11-23&to=2026-11-29&resources=42')).body.data, [])

  // The tree: groups (the student's own `selected`), teachers, rooms.
  const tree = (await ask(server, '/__ent_auth/timetable/tree')).body.data
  assert.deepEqual([...new Set(tree.map((node) => node.kind))], ['group', 'teacher', 'room'])
  const followed = []
  const walk = (nodes) => nodes.forEach((node) => {
    if (node.selected) followed.push(node.id)
    walk(node.children)
  })
  walk(tree)
  assert.deepEqual(followed, ['11121'])
  const rooms = (await ask(server, '/__ent_auth/timetable/tree?kind=room')).body.data
  assert.ok(rooms.length > 0 && rooms.every((node) => node.kind === 'room' && node.folder))
  const found = (await ask(server, '/__ent_auth/timetable/resources?kind=room&q=amphi')).body.data
  assert.deepEqual(found.map((resource) => resource.id), ['9106', '9107', '9108'])
  assert.deepEqual(found[0].path, ['Sites Univ Rennes', 'IUT Lannion', 'Amphithéâtre', 'Amphi 1 [180P]'])
})

test('the certificat de scolarité is a PDF of the page\'s making', async () => {
  const server = createDemoServer({ config: { id: 'univ-rennes', features: FEATURES }, now: () => NOW })
  const response = await server.answer('/__ent_auth/documents/school-certificate')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Certificat_de_scolarite_demo_2026-2027.pdf"; filename*=UTF-8\'\'Certificat_de_scolarite_demo_2026-2027.pdf')
  const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
  assert.match(pdf, /^%PDF-1\.4\n/)
  assert.match(pdf, /compte demo \(2026-2027\)/)
  assert.match(pdf, /%%EOF\n$/)
  // The table's offsets point at the objects.
  const text = Buffer.from(buildDemoCertificatePdf('2025-2026')).toString('latin1')
  const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]))
  assert.equal(offsets.length, 5)
  offsets.forEach((offset, index) => assert.ok(text.startsWith(`${index + 1} 0 obj`, offset)))
  // The school year turns in September.
  const august = createDemoServer({ config: { features: FEATURES }, now: () => Date.UTC(2026, 7, 20) })
  assert.deepEqual((await ask(august, '/__ent_auth/documents/school-certificate/status')).body, { available: true, schoolYear: '2025-2026' })
})

test('a file picked is read only when the mailbox keeps it', async () => {
  const server = createDemoServer({ config: { id: 'univ-rennes', features: FEATURES } })
  let read = 0
  const file = (name, type, bytes) => ({
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => {
      read += 1
      return bytes.buffer
    },
  })
  const text = await server.upload(file('notes.txt', 'text/plain', new Uint8Array(12)))
  assert.deepEqual([text.status, text.body.attachment.name, text.body.attachment.size, read], [200, 'notes.txt', 12, 0])
  const image = await server.upload(file('image.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])), { name: 'Ma note.png' })
  assert.deepEqual([image.status, image.body.attachment.name, image.body.attachment.contentType, read], [200, 'Ma note.png', 'image/png', 1])
  assert.equal((await server.upload(file('vide.txt', 'text/plain', new Uint8Array(0)))).status, 400)
})

test('signing out clears what the visitor did', async () => {
  const storage = createStorage()
  const server = createDemoServer({ config: { id: 'univ-rennes', features: FEATURES }, storage })
  await post(server, '/__ent_auth/mail/draft', { to: [], subject: 'Un brouillon', html: '<p>x</p>' })
  assert.equal((await ask(server, '/__ent_auth/mail/recent?folder=6')).body.mail.messages.length, 1)
  // A reload: the same tab's storage.
  const reloaded = createDemoServer({ config: { id: 'univ-rennes', features: FEATURES }, storage })
  assert.equal((await ask(reloaded, '/__ent_auth/mail/recent?folder=6')).body.mail.messages.length, 1)
  reloaded.clear()
  assert.equal((await ask(createDemoServer({ config: { features: FEATURES }, storage }), '/__ent_auth/mail/recent?folder=6')).body.mail.messages.length, 0)
})

// ── The same questions, asked of the server's own demo ─────────────────────

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const CID = 'tafac-img-0123abcd-0000-4000-8000-000000000000@tafac.fr'
