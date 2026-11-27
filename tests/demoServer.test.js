import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DEMO_ACCOUNT, buildDemoApps, buildDemoGradesPayload } from '../src/demoAccount.js'
import { pickAppIcons, sanitizeAppIconRequest } from '../src/appIconPicks.js'
import { buildDemoCertificatePdf, createDemoServer } from '../src/demoServer.js'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { loadServerConfig, loadSharedConfig } from '../universities/index.js'

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

async function withBothSides(run) {
  const config = await loadServerConfig('univ-rennes')
  const shared = await loadSharedConfig('univ-rennes')
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tafac-demo-icons-'))
  const app = createEntAuthApp(config, { analytics: {}, session: { secret: 'a'.repeat(44), production: false }, appIcons: { dataDir } })
  const listener = app.listen(0)
  const base = `http://127.0.0.1:${listener.address().port}`

  // The server's side: a demo session, as the page had one.
  const signIn = async () => {
    const response = await fetch(`${base}/__ent_auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
    })
    assert.equal(response.status, 200)
    return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  }
  const cookie = await signIn()
  const served = async (url, init = {}) => {
    const response = await fetch(`${base}${url}`, { ...init, headers: { ...init.headers, cookie } })
    const text = await response.text()
    let body = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // Not JSON: compared as it is.
    }
    return { status: response.status, body }
  }

  // The page's side: the university as its client config says it, the
  // signature's logos as the page reads them (the same PNG files).
  const readLogo = async (file, alt) => {
    const bytes = await readFile(new URL(`../universities/univ-rennes/assets/mail/${file}.png`, import.meta.url))
    return { src: `data:image/png;base64,${bytes.toString('base64')}`, width: bytes.readUInt32BE(16) / 2, height: bytes.readUInt32BE(20) / 2, alt }
  }
  const page = createDemoServer({
    config: {
      id: 'univ-rennes',
      features: shared.features,
      university: shared.university,
      establishments: { byId: { iutlan: { label: shared.establishmentNames.iutlan } } },
    },
    pickIcons: (services) => pickAppIcons(sanitizeAppIconRequest({ services }) ?? [], shared.appIcons),
    readLogos: async (establishment) => [
      ...(establishment ? [await readLogo(establishment, shared.establishmentNames[establishment])] : []),
      await readLogo('logo', shared.university.name),
    ],
  })
  const local = async (url, init = {}) => {
    const response = await page.answer(url, init)
    const text = await response.text()
    let body = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // Not JSON: compared as it is.
    }
    return { status: response.status, body }
  }

  try {
    await run({ served, local, page, base, cookie })
  } finally {
    listener.close()
    await rm(dataDir, { recursive: true, force: true })
  }
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('the page answers the demo as the server answered it', async (t) => {
  // One clock for both: the demo's dates follow the time of the request.
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  await withBothSides(async ({ served, local }) => {
    const same = async (url, init) => {
      assert.deepEqual(await local(url, init), await served(url, init), `${init?.method ?? 'GET'} ${url}`)
    }

    // The server's side is signed in to its own demo.
    assert.equal((await served('/__ent_auth/session')).body.sessionMode, 'demo')

    const grades = buildDemoGradesPayload()
    const semesterIds = grades.semestres.map((semester) => semester.formsemestre_id)
    const evaluationId = Object.values(grades['relevé'].ressources).flatMap((module) => module.evaluations ?? [])[0].id
    assert.ok(semesterIds.length > 1 && evaluationId)

    for (const url of [
      '/__ent_auth/account',
      '/__ent_auth/apps',
      '/__ent_auth/grades',
      ...semesterIds.map((id) => `/__ent_auth/grades/semester/${id}`),
      '/__ent_auth/grades/semester/999999',
      '/__ent_auth/grades/semester/abc',
      '/__ent_auth/grades/department-message?dep=INFOCOM',
      '/__ent_auth/grades/department-message?dep=pas%20un%20nom',
      '/__ent_auth/grades/department-message',
      `/__ent_auth/grades/evaluation-distribution?semestre=current&eval=${evaluationId}`,
      `/__ent_auth/grades/evaluation-distribution?semestre=${semesterIds.at(-1)}&eval=${evaluationId}`,
      '/__ent_auth/grades/evaluation-distribution?semestre=current&eval=999999',
      '/__ent_auth/grades/evaluation-distribution?semestre=current',
      '/__ent_auth/grades/evaluation-distribution?semestre=x&eval=1',
      `/__ent_auth/grades/report.pdf?semestre=${semesterIds[0]}`,
      '/__ent_auth/grades/report.pdf',
      '/__ent_auth/moodle/deadlines',
      '/__ent_auth/student-pic?meta=1',
      '/__ent_auth/student-pic',
      '/__ent_auth/documents/school-certificate/status',
      '/__ent_auth/documents/school-certificate',
      '/__ent_auth/mail/recent',
      '/__ent_auth/mail/recent?offset=20',
      '/__ent_auth/mail/recent?fresh=1',
      '/__ent_auth/mail/recent?q=dossier%20presse',
      '/__ent_auth/mail/recent?q=zzz',
      '/__ent_auth/mail/recent?q=dossier&offset=20',
      '/__ent_auth/mail/recent?folder=5',
      '/__ent_auth/mail/recent?folder=6',
      '/__ent_auth/mail/recent?folder=300&q=moodle',
      '/__ent_auth/mail/recent?folder=pas-un-dossier',
      '/__ent_auth/mail/message?id=demo-mail-1',
      '/__ent_auth/mail/message?id=demo-mail-3',
      '/__ent_auth/mail/message?id=demo-mail-9',
      '/__ent_auth/mail/message?id=257',
      '/__ent_auth/mail/message',
      '/__ent_auth/mail/thread?id=demo-mail-2&folder=2',
      '/__ent_auth/mail/thread?id=demo-mail-2',
      '/__ent_auth/mail/thread?id=demo-sent-1&folder=5',
      '/__ent_auth/mail/thread?id=-257',
      '/__ent_auth/mail/folders',
      '/__ent_auth/mail/prefs',
      '/__ent_auth/mail/autocomplete?q=lann',
      '/__ent_auth/mail/autocomplete?q=le%20fur',
      '/__ent_auth/mail/autocomplete?q=l',
      '/__ent_auth/mail/autocomplete',
      '/__ent_auth/mail/signatures',
      '/__ent_auth/mail/draft?id=demo-draft-1',
      '/__ent_auth/mail/draft?id=257',
      '/__ent_auth/mail/part?id=demo-mail-1&part=2',
    ]) {
      await same(url)
    }

    for (const [url, body] of [
      ['/__ent_auth/mail/action', { ids: ['demo-mail-1', 'demo-mail-2'], action: 'read' }],
      ['/__ent_auth/mail/action', { ids: ['demo-mail-1'], action: 'move', folder: '300' }],
      ['/__ent_auth/mail/action', { ids: ['demo-mail-1'], action: 'move', folder: '999' }],
      ['/__ent_auth/mail/action', { ids: ['demo-mail-1'], action: 'move', folder: 'x' }],
      ['/__ent_auth/mail/action', { ids: ['257'], action: 'read' }],
      ['/__ent_auth/mail/action', { ids: [], action: 'read' }],
      ['/__ent_auth/mail/action', { ids: ['demo-mail-1'], action: 'archive' }],
      ['/__ent_auth/mail/folder-action', { folder: '2', action: 'read' }],
      ['/__ent_auth/mail/folder-action', { folder: '4', action: 'empty' }],
      ['/__ent_auth/mail/folder-action', { folder: '2', action: 'empty' }],
      ['/__ent_auth/mail/folder-action', { folder: '1', action: 'read' }],
      ['/__ent_auth/mail/folder-action', { folder: '999', action: 'read' }],
      ['/__ent_auth/mail/folder-action', { folder: '2', action: 'rename' }],
      ['/__ent_auth/mail/signature', { text: 42 }],
      ['/__ent_auth/mail/signature', { text: 'x'.repeat(2001) }],
      ['/__ent_auth/mail/signature', { text: '  Camille \r\n\r\n\r\nBUT Info-Com <3> & co\t ' }],
      ['/__ent_auth/app-icons', { services: buildDemoApps().map(({ id, title, description }) => ({ id, title, description })) }],
      ['/__ent_auth/app-icons', { services: 'none' }],
    ]) {
      await same(url, json(body))
    }
    await same('/__ent_auth/mail/signatures')
  })
})

test('the composer\'s mails are kept by the page as the server kept them', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  await withBothSides(async ({ served, local, page, base, cookie }) => {
    // The files picked: their ids are each side's own, the rest the same.
    const upload = async (name, type, bytes) => {
      const fromServer = await fetch(`${base}/__ent_auth/mail/upload`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
        body: bytes,
      }).then(async (response) => ({ status: response.status, body: await response.json() }))
      const fromPage = await page.upload({ name, type, size: bytes.length, arrayBuffer: async () => bytes.buffer })
      assert.deepEqual({ ...fromPage, body: { attachment: { ...fromPage.body.attachment, aid: null } } }, { ...fromServer, body: { attachment: { ...fromServer.body.attachment, aid: null } } }, name)
      return { served: fromServer.body.attachment.aid, local: fromPage.body.attachment.aid }
    }
    // The same body on both sides, each with its own file ids.
    const both = async (url, body, files = {}) => {
      const fill = (side) => JSON.parse(JSON.stringify(body), (key, value) => (typeof value === 'string' && files[value] ? files[value][side] : value))
      const [fromPage, fromServer] = [await local(url, json(fill('local'))), await served(url, json(fill('served')))]
      const unnamed = (answer) => JSON.parse(JSON.stringify(answer).replace(/demo-upload-[0-9a-f-]{36}/g, 'demo-upload'))
      assert.deepEqual(unnamed(fromPage), unnamed(fromServer), `POST ${url} ${JSON.stringify(body).slice(0, 100)}`)
      return fromPage
    }
    const same = async (url) => assert.deepEqual(await local(url), await served(url), url)

    const mail = {
      to: [{ name: 'Léo', email: 'leo@univ.fr' }],
      cc: [{ email: 'lea@univ.fr' }],
      subject: 'Objet',
      html: '<p>Bonjour <strong>Léo</strong>,</p><p></p><ul><li><p>un <a href="https://tafac.fr">lien</a></p></li></ul><div data-mail-signature=""></div><blockquote><p>cité</p></blockquote>',
      signature: { include: true, establishment: 'iutlan', group: 'Info-Com 3 · TP 3' },
    }
    let uid = 0
    const send = (overrides, files) => both('/__ent_auth/mail/send', { ...mail, sendUid: `uid-0000000${uid += 1}`, ...overrides }, files)

    // Refused: the same words.
    await send({ to: [{ email: 'pas une adresse' }] })
    await send({ to: [] })
    await send({ identityId: 'someone-else' })
    await send({ attachments: [{ source: 'upload', aid: 'demo-upload-00000000-0000-0000-0000-000000000000' }] })
    await send({ attachments: [{ source: 'message', messageId: 'demo-mail-2', part: '2' }] })
    await send({ origin: { kind: 'reply', messageId: '257' } })
    await send({ html: `<p>${'x'.repeat(300_000)}</p>` })

    // A draft with a file of each kind and an image of the text, saved
    // over, read back.
    const files = { PDF: await upload('Été "final".pdf', 'application/pdf', new Uint8Array(2048)), IMAGE: await upload('note.png', 'image/png', PNG) }
    const withImage = `${mail.html}<p><img data-inline-cid="${CID}" alt="Ma note" width="1120" height="600"></p>`
    const saved = await both('/__ent_auth/mail/draft', {
      ...mail,
      to: [{ email: 'à moitié' }],
      html: withImage,
      attachments: [{ source: 'message', messageId: 'demo-mail-1', part: '3' }, { source: 'upload', aid: 'PDF' }],
      inlineImages: [{ cid: CID, source: 'upload', aid: 'IMAGE', width: 1120, height: 600 }],
    }, files)
    assert.equal(saved.status, 200)
    const { id } = saved.body.draft
    await same(`/__ent_auth/mail/draft?id=${id}`)
    await same('/__ent_auth/mail/recent?folder=6')
    await same(`/__ent_auth/mail/thread?id=${id}&folder=6`)
    const asParts = {
      attachments: saved.body.draft.attachments.map((reference) => ({ source: 'message', ...reference })),
      inlineImages: [{ cid: CID, source: 'message', messageId: id, part: saved.body.draft.inlineImages[0].part, width: 560, height: 300 }],
    }
    await both('/__ent_auth/mail/draft', { ...mail, html: withImage, subject: 'Autre objet', draftId: id, ...asParts })
    await same(`/__ent_auth/mail/draft?id=${id}`)

    // Sent from the draft, as a reply, with the automatic signature and
    // its logos: the copy in « Envoyés » is the same, byte for byte.
    const sent = await send({ html: withImage, draftId: id, ...asParts, origin: { kind: 'reply', messageId: 'demo-mail-1' } })
    assert.deepEqual([sent.status, sent.body], [200, { ok: true }])
    await same(`/__ent_auth/mail/draft?id=${id}`)
    await same('/__ent_auth/mail/recent')
    await same('/__ent_auth/mail/recent?folder=5')
    await same('/__ent_auth/mail/message?id=demo-sent-3')
    await same('/__ent_auth/mail/thread?id=demo-sent-3&folder=5')
    const copy = (await local('/__ent_auth/mail/message?id=demo-sent-3')).body.message
    assert.match(copy.html, /IUT de Lannion – Université de Rennes/)
    assert.match(copy.html, /alt="Université de Rennes"/)

    // The student's own signatures, and no signature.
    await both('/__ent_auth/mail/signature', { text: 'Camille\n\nBUT Info-Com <3>' })
    await send({ signature: { include: true, mode: 'custom' }, origin: { kind: 'forward', messageId: 'demo-mail-2' } })
    await send({ signature: { include: true, mode: 'partage' }, identityId: 'demo-etudiant' })
    await send({ signature: { include: false } })
    await same('/__ent_auth/mail/recent')
    await same('/__ent_auth/mail/recent?folder=5')
    for (const sentId of ['demo-sent-4', 'demo-sent-5', 'demo-sent-6']) await same(`/__ent_auth/mail/message?id=${sentId}`)

    // A draft discarded.
    const other = await both('/__ent_auth/mail/draft', mail)
    await both('/__ent_auth/mail/action', { ids: [other.body.draft.id], action: 'discard' })
    await same(`/__ent_auth/mail/draft?id=${other.body.draft.id}`)
    await same('/__ent_auth/mail/recent?folder=6')
  })
})
