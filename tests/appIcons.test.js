import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import {
  APP_ICON_COLOR_MODES,
  APP_ICON_CONCEPTS,
  APP_ICON_HUES,
  APP_ICON_RULES,
  APP_ICON_STYLES,
  GENERIC_CONCEPT,
  MAX_REQUEST_SERVICES,
  MAX_STORED_SERVICES,
  assignAppIcon,
  createAppIconStore,
  hashString,
  isValidAppIconEntry,
  matchAppIcon,
  pickAppColor,
  resolveAppIconTheme,
  sanitizeAppIconRequest,
  toIconifyName,
} from '../server/appIcons.js'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { loadServerConfig } from '../universities/index.js'
import { buildIconData, buildIconFixture, outputPath } from '../scripts/gateway-data.mjs'

const silentLogger = { warn() {} }

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tafac-app-icons-'))
  try {
    return await run(dir)
  } finally {
    await chmod(dir, 0o700).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

function service(id, title, extra = {}) {
  return { id, title, description: '', category: '', ...extra }
}

async function readStoreFile(dir, universityId = 'univ-test') {
  return JSON.parse(await readFile(path.join(dir, 'app-icons', `${universityId}.json`), 'utf8'))
}

// --- Keyword matching --------------------------------------------------------

test('matches common portal services in French and English', () => {
  const cases = [
    ['Messagerie', 'mail'],
    ['Webmail étudiant', 'mail'],
    ['Moodle - FOAD', 'moodle'],
    ['FOAD', 'course'],
    ['Cours en ligne', 'course'],
    ['Emplois du temps', 'calendar'],
    ['Mon emploi du temps', 'calendar'],
    ['Planning', 'calendar'],
    ['Notes IUT Lannion', 'grades'],
    ['Annuaire', 'directory'],
    ['Bibliothèques universitaires', 'library'],
    ['BU', 'library'],
    ['Wi-Fi eduroam', 'wifi'],
    ["Crédits d'impression", 'printing'],
    ['Webconférence', 'visio'],
    ['Visioconférence BigBlueButton', 'visio'],
    ['Microsoft 365', 'office'],
    ['Espaces de stockage', 'cloud'],
    ['Assistance', 'help'],
    ['Documentation des services numériques', 'documentation'],
    ['Restauration CROUS', 'restaurant'],
    ['SUAPS - Sport', 'sport'],
    ['Orientation et insertion', 'orientation'],
    ['Offres de stage', 'jobs'],
    ['Job board', 'jobs'],
    ['Carte étudiante', 'card'],
    ['Paiement en ligne', 'payment'],
    ['Dossier étudiant (Apogée)', 'student-record'],
    ['Authentification multifacteur (MFA)', 'security'],
    ['Compte informatique', 'account'],
    ['Esup Signature', 'signature'],
    ['Listes de diffusion - étudiants', 'announcement'],
    ['Évaluation orthographique', 'spell-check'],
    ['Portail des thèses', 'publications'],
    ['Recherche documentaire', 'library'],
    ['Prêt de matériel', 'equipment'],
    ['Library', 'library'],
    ['Printing', 'printing'],
  ]

  for (const [title, icon] of cases) {
    assert.equal(matchAppIcon({ title }), icon, title)
  }
})

test('specific rules win over broad ones', () => {
  // "emploi" alone means jobs, "emploi du temps" a timetable.
  assert.equal(matchAppIcon({ title: 'Emploi et carrière' }), 'jobs')
  assert.equal(matchAppIcon({ title: 'Emploi du temps' }), 'calendar')
  // A mailing list isn't the mailbox.
  assert.equal(matchAppIcon({ title: 'Listes de diffusion' }), 'announcement')
  // « Contrat pédagogique » is paperwork, not a course.
  assert.equal(matchAppIcon({ title: 'Contrat pédagogique' }), 'student-record')
  // Financial aid isn't the help desk.
  assert.equal(matchAppIcon({ title: 'Aides financières' }), 'payment')
})

test('keywords match at the start of a word, and whole words when they end with a space', () => {
  assert.equal(matchAppIcon({ title: 'BU' }), 'library')
  assert.notEqual(matchAppIcon({ title: 'Bureautique' }), 'library')
  assert.notEqual(matchAppIcon({ title: 'Information' }), 'course')
  assert.equal(matchAppIcon({ title: 'BIBLIOTHÈQUE' }), 'library')
})

test('falls back to the description, then the category, then nothing', () => {
  assert.equal(matchAppIcon({ title: 'Pod', description: 'Plateforme vidéo' }), 'video')
  assert.equal(matchAppIcon({ title: 'Zébulon', description: '', category: 'Pédagogie' }), 'course')
  assert.equal(matchAppIcon({ title: 'Zébulon', description: 'Un outil maison' }), 'tools')
  assert.equal(matchAppIcon({ title: 'Zébulon' }), null)
  assert.equal(assignAppIcon(service('zebulon', 'Zébulon')).icon, GENERIC_CONCEPT)
})

test('every rule points to a concept that every style draws', () => {
  for (const { concept, keywords } of APP_ICON_RULES) {
    assert.ok(APP_ICON_CONCEPTS.includes(concept), concept)
    assert.ok(isValidAppIconEntry({ icon: concept, color: 'blue' }), concept)
    assert.ok(keywords.length > 0, concept)
  }

  for (const [style, icons] of Object.entries(APP_ICON_STYLES)) {
    assert.deepEqual(Object.keys(icons), APP_ICON_CONCEPTS, style)
    for (const icon of Object.values(icons)) {
      assert.match(icon, /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/, `${style} ${icon}`)
    }
  }
  assert.equal(APP_ICON_STYLES['phosphor-duotone'].mail, 'ph:envelope-simple-duotone')
})

test('every colour mode covers every hue in light and dark', () => {
  for (const [mode, palette] of Object.entries(APP_ICON_COLOR_MODES)) {
    assert.deepEqual(Object.keys(palette), APP_ICON_HUES, mode)
    for (const { light, dark } of Object.values(palette)) {
      for (const value of [light.bg, light.fg, dark.bg, dark.fg]) {
        assert.match(value, /^#[0-9a-f]{6}$/, mode)
      }
    }
  }
})

// --- University look ---------------------------------------------------------------

test('resolveAppIconTheme defaults to Carbon on pastel tiles', () => {
  const theme = resolveAppIconTheme()
  assert.equal(theme.style, 'carbon')
  assert.equal(theme.colorMode, 'pastel')
  assert.equal(theme.icons.mail, 'carbon:email')
  assert.equal(theme.palette, APP_ICON_COLOR_MODES.pastel)
})

test('resolveAppIconTheme applies a style, a colour mode and single overrides', () => {
  const theme = resolveAppIconTheme({ style: 'tabler', colorMode: 'vivid', icons: { mail: 'mdi:email-outline' } })
  assert.equal(theme.icons.mail, 'mdi:email-outline')
  assert.equal(theme.icons.calendar, 'tabler:calendar')
  assert.equal(theme.palette.blue.light.fg, '#ffffff')
})

test('resolveAppIconTheme refuses unknown values', () => {
  assert.throws(() => resolveAppIconTheme({ style: 'carbonn' }), /appIcons\.style/)
  assert.throws(() => resolveAppIconTheme({ colorMode: 'neon' }), /appIcons\.colorMode/)
  assert.throws(() => resolveAppIconTheme({ icons: { nope: 'mdi:x' } }), /appIcons\.icons/)
  assert.throws(() => resolveAppIconTheme({ icons: { mail: 'not an icon' } }), /appIcons\.icons/)
})

test('stored icons draw in the university style; pinned names stay as they are', () => {
  const carbon = resolveAppIconTheme()
  const duotone = resolveAppIconTheme({ style: 'phosphor-duotone' })
  assert.equal(toIconifyName('library', carbon), 'carbon:book')
  assert.equal(toIconifyName('library', duotone), 'ph:book-open-duotone')
  assert.equal(toIconifyName('mdi:soccer', duotone), 'mdi:soccer')
  // Our own icons stored by name follow the style; only other icons are pins.
  assert.equal(toIconifyName('carbon:book', duotone), 'ph:book-open-duotone')
  assert.equal(toIconifyName('ph:book-open-duotone', carbon), 'carbon:book')
  assert.equal(toIconifyName('???', duotone), duotone.icons[GENERIC_CONCEPT])
})

// --- Colours -------------------------------------------------------------------

test('colours are deterministic', () => {
  assert.equal(hashString('demo-moodle'), hashString('demo-moodle'))
  assert.equal(pickAppColor('demo-moodle'), pickAppColor('demo-moodle'))
  assert.deepEqual(
    assignAppIcon(service('demo-moodle', 'Moodle')),
    assignAppIcon(service('demo-moodle', 'Moodle')),
  )
  assert.ok(APP_ICON_HUES.includes(pickAppColor('anything')))
})

test('usage-aware colours go to the least used colour', () => {
  const keys = APP_ICON_HUES
  const preferred = pickAppColor('some-service')
  // Preferred colour is free: keep it.
  assert.equal(pickAppColor('some-service', new Map()), preferred)
  // Preferred colour taken: the next free one.
  const usage = new Map([[preferred, 1]])
  const picked = pickAppColor('some-service', usage)
  assert.notEqual(picked, preferred)
  assert.equal(picked, keys[(keys.indexOf(preferred) + 1) % keys.length])
  // Every colour used once: back to the preferred one.
  assert.equal(pickAppColor('some-service', new Map(keys.map((key) => [key, 1]))), preferred)
})

// --- Input validation --------------------------------------------------------------

test('sanitizeAppIconRequest rejects bodies of the wrong shape', () => {
  assert.equal(sanitizeAppIconRequest(null), null)
  assert.equal(sanitizeAppIconRequest('services'), null)
  assert.equal(sanitizeAppIconRequest({ services: 'x' }), null)
  assert.deepEqual(sanitizeAppIconRequest({ services: [] }), [])
})

test('sanitizeAppIconRequest keeps valid, de-duplicated slugs with cleaned text', () => {
  const services = sanitizeAppIconRequest({
    services: [
      { id: 'moodle-foad', title: '  Moodle\n - FOAD ', description: 42, category: 'Pédagogie' },
      { id: 'moodle-foad', title: 'Duplicate' },
      { id: '../../etc/passwd', title: 'Path' },
      { id: 'has space', title: 'Space' },
      { id: 'x'.repeat(65), title: 'Too long' },
      { id: 'no-title', title: '   ' },
      { id: 'not-a-string', title: { toString: () => 'x' } },
      { id: 'lent-iutlan-notes9', title: 'T'.repeat(500), description: 'D'.repeat(500) },
      'garbage',
    ],
  })

  assert.deepEqual(services.map((entry) => entry.id), ['moodle-foad', 'lent-iutlan-notes9'])
  assert.deepEqual(services[0], { id: 'moodle-foad', title: 'Moodle - FOAD', description: '', category: 'Pédagogie' })
  assert.equal(services[1].title.length, 120)
  assert.equal(services[1].description.length, 300)
})

test('sanitizeAppIconRequest caps the number of services', () => {
  const services = sanitizeAppIconRequest({
    services: Array.from({ length: MAX_REQUEST_SERVICES + 50 }, (_, index) => ({ id: `s${index}`, title: `S${index}` })),
  })
  assert.equal(services.length, MAX_REQUEST_SERVICES)
})

// --- Store -----------------------------------------------------------------------

test('the store writes first picks and a restarted server reads them back', () => withTempDir(async (dir) => {
  const services = [service('demo-messagerie', 'Messagerie'), service('demo-moodle', 'Moodle')]
  const first = await createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger }).resolve(services)

  assert.equal(first['demo-messagerie'].icon, 'mail')
  assert.equal(first['demo-moodle'].icon, 'moodle')
  assert.notEqual(first['demo-messagerie'].color, first['demo-moodle'].color)

  const file = await readStoreFile(dir)
  assert.equal(file.version, 1)
  assert.equal(file.university, 'univ-test')
  assert.equal(file.services['demo-moodle'].title, 'Moodle')
  assert.equal(file.services['demo-moodle'].icon, 'moodle')

  // A new process (fresh store) answers from the file, whatever order the
  // services come in.
  const restarted = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  assert.deepEqual(await restarted.resolve([...services].reverse()), first)
}))

test('stored picks survive a change of keywords or title', () => withTempDir(async (dir) => {
  const store = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  // An older keyword list picked another icon: it's kept.
  await store.resolve([service('demo-annuaire', 'Annuaire')])
  const filePath = path.join(dir, 'app-icons', 'univ-test.json')
  const file = await readStoreFile(dir)
  file.services['demo-annuaire'] = { ...file.services['demo-annuaire'], icon: 'ph:books-duotone', color: 'teal' }
  await writeFile(filePath, JSON.stringify(file))
  await utimes(filePath, new Date(), new Date(Date.now() + 5000))

  const result = await store.resolve([service('demo-annuaire', 'Annuaire renamed'), service('demo-wifi', 'Wifi')])
  assert.deepEqual(result['demo-annuaire'], { icon: 'ph:books-duotone', color: 'teal' })
  assert.equal(result['demo-wifi'].icon, 'wifi')
  assert.equal((await readStoreFile(dir)).services['demo-annuaire'].title, 'Annuaire')
}))

test('a brand logo replaces a stored concept but not a pinned icon', () => withTempDir(async (dir) => {
  const store = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  await store.resolve([service('demo-moodle', 'Moodle'), service('pinned-moodle', 'Moodle')])
  const filePath = path.join(dir, 'app-icons', 'univ-test.json')
  const file = await readStoreFile(dir)
  // Picked as a course before Moodle had its logo, and an admin pin.
  file.services['demo-moodle'] = { ...file.services['demo-moodle'], icon: 'course', color: 'pink' }
  file.services['pinned-moodle'] = { ...file.services['pinned-moodle'], icon: 'mdi:school', color: 'teal' }
  await writeFile(filePath, JSON.stringify(file))
  await utimes(filePath, new Date(), new Date(Date.now() + 5000))

  const result = await store.resolve([service('demo-moodle', 'Moodle'), service('pinned-moodle', 'Moodle')])
  assert.deepEqual(result['demo-moodle'], { icon: 'moodle', color: 'pink' })
  assert.deepEqual(result['pinned-moodle'], { icon: 'mdi:school', color: 'teal' })
}))

test('deleting an entry from the file lets the server pick it again', () => withTempDir(async (dir) => {
  const store = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  await store.resolve([service('demo-moodle', 'Moodle'), service('demo-annuaire', 'Annuaire')])
  const filePath = path.join(dir, 'app-icons', 'univ-test.json')
  const file = await readStoreFile(dir)
  delete file.services['demo-moodle']
  file.services['demo-annuaire'].color = 'not-a-colour'
  await writeFile(filePath, JSON.stringify(file))
  await utimes(filePath, new Date(), new Date(Date.now() + 5000))

  const result = await store.resolve([service('demo-moodle', 'Moodle'), service('demo-annuaire', 'Annuaire')])
  assert.equal(result['demo-moodle'].icon, 'moodle')
  // Invalid entries are dropped on load and re-picked.
  assert.ok(APP_ICON_HUES.includes(result['demo-annuaire'].color))
  assert.ok((await readStoreFile(dir)).services['demo-moodle'])
}))

test('remember: false answers without writing', () => withTempDir(async (dir) => {
  const store = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  await store.resolve([service('kept', 'Messagerie')])
  const result = await store.resolve([service('kept', 'Other'), service('transient', 'Wifi')], { remember: false })

  assert.equal(result.transient.icon, 'wifi')
  assert.equal(result.kept.icon, 'mail')
  assert.deepEqual(Object.keys((await readStoreFile(dir)).services), ['kept'])
}))

test('concurrent first visits agree on the same picks', () => withTempDir(async (dir) => {
  const store = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  const services = Array.from({ length: 10 }, (_, index) => service(`svc-${index}`, `Service ${index}`))
  const [a, b] = await Promise.all([store.resolve(services), store.resolve([...services].reverse())])
  assert.deepEqual(a, b)
}))

test('an unwritable directory degrades to memory, deterministically', { skip: process.getuid?.() === 0 }, () => withTempDir(async (dir) => {
  await chmod(dir, 0o500)
  const services = [service('demo-moodle', 'Moodle'), service('demo-messagerie', 'Messagerie')]
  const store = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  const first = await store.resolve(services)

  assert.equal(store.persistent, false)
  assert.equal(first['demo-moodle'].icon, 'moodle')
  assert.deepEqual(await store.resolve(services), first)
  // Another process in the same situation picks the same tiles.
  const other = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  assert.deepEqual(await other.resolve(services), first)
}))

test('a corrupt file is left alone and the store keeps working in memory', () => withTempDir(async (dir) => {
  const filePath = path.join(dir, 'app-icons', 'univ-test.json')
  await createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
    .resolve([service('seed', 'Seed')])
  await writeFile(filePath, '{ broken')

  const store = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  const result = await store.resolve([service('demo-moodle', 'Moodle')])
  assert.equal(result['demo-moodle'].icon, 'moodle')
  assert.equal(store.persistent, false)
  assert.equal(await readFile(filePath, 'utf8'), '{ broken')
}))

test('past MAX_STORED_SERVICES, new services are answered but not stored', () => withTempDir(async (dir) => {
  const store = createAppIconStore({ universityId: 'univ-test', dataDir: dir, logger: silentLogger })
  for (let start = 0; start < MAX_STORED_SERVICES; start += MAX_REQUEST_SERVICES) {
    const count = Math.min(MAX_REQUEST_SERVICES, MAX_STORED_SERVICES - start)
    await store.resolve(Array.from({ length: count }, (_, index) => service(`s${start + index}`, 'Service')))
  }

  const result = await store.resolve([service('one-too-many', 'Wifi')])
  assert.equal(result['one-too-many'].icon, 'wifi')
  const file = await readStoreFile(dir)
  assert.equal(Object.keys(file.services).length, MAX_STORED_SERVICES)
  assert.equal(file.services['one-too-many'], undefined)
}))

// --- Route -----------------------------------------------------------------------

test('POST /__ent_auth/app-icons needs a session and stores only demo services for demo sessions', () => withTempDir(async (dir) => {
  const config = await loadServerConfig('univ-exemple')
  const app = createEntAuthApp(config, {
    analytics: {},
    appIcons: { dataDir: dir },
    session: { secret: 'a'.repeat(44), production: false },
  })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    const post = (pathname, body, cookie = '') => fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    })

    const anonymous = await post('/__ent_auth/app-icons', { services: [] })
    assert.equal(anonymous.status, 401)

    const login = await post('/__ent_auth/login', { username: 'demo@tafac.fr', password: 'tafac-demo' })
    assert.equal(login.status, 200)
    const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')

    const invalid = await post('/__ent_auth/app-icons', { services: 'nope' }, cookie)
    assert.equal(invalid.status, 400)

    const response = await post('/__ent_auth/app-icons', {
      services: [
        // The server uses its own title for demo services.
        { id: 'demo-moodle', title: 'Sport' },
        { id: 'made-up', title: 'Wifi' },
      ],
    }, cookie)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    // univ-exemple draws phosphor-duotone icons on soft tiles.
    assert.deepEqual(payload.palette, APP_ICON_COLOR_MODES.soft)
    // Moodle gets its own logo (a brand: same mark in every style).
    assert.equal(payload.icons['demo-moodle'].icon, 'devicon-plain:moodle')
    assert.equal(payload.icons['made-up'].icon, 'ph:wifi-high-duotone')

    const file = await readStoreFile(dir, 'univ-exemple')
    assert.deepEqual(Object.keys(file.services), ['demo-moodle'])
    // The file keeps the concept: switching style later restyles the tile.
    assert.equal(file.services['demo-moodle'].icon, 'moodle')
    assert.equal(file.services['demo-moodle'].title, 'Moodle')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await app.locals.analytics.shutdown?.()
  }
}))

// --- The gateway's copy ----------------------------------------------------------
// The gateway (back/crates/tafac-gateway, own/icons.rs) answers this route
// for the sessions it holds, from a copy of these lists that
// scripts/gateway-data.mjs writes, and holds itself to the fixture below.
// Both fail here when a list or a pick changes and the script wasn't run
// again (node scripts/gateway-data.mjs).

// A fold table's code points, those this Node's Unicode knows: a newer
// Node's table may name marks an older one hasn't heard of.
function foldedByCode(fold) {
  const assigned = /\p{Assigned}/u
  const byCode = new Map()
  for (const [first, last, folded] of fold) {
    for (let code = first; code <= last; code += 1) {
      if (assigned.test(String.fromCodePoint(code))) byCode.set(code, folded)
    }
  }
  return byCode
}

test('the gateway picks from the lists the JS has', async () => {
  const written = JSON.parse(await readFile(outputPath('back/crates/tafac-gateway/src/own/icons.json'), 'utf8'))
  const made = await buildIconData()
  assert.deepEqual({ ...written, fold: null }, { ...made, fold: null })
  assert.deepEqual(foldedByCode(written.fold), foldedByCode(made.fold))
})

// The day a store wrote down, in the files of the fixture's routes.
function withoutToday(fixture) {
  const routes = fixture.routes.map((route) => ({
    ...route,
    requests: route.requests.map((request) => ({ ...request, file: request.file?.replaceAll(`"assignedAt": "${fixture.today}"`, '"assignedAt": "today"') ?? null })),
  }))
  return { ...fixture, today: null, routes }
}

test('the JS picks what the fixture the gateway holds to says', async () => {
  const written = JSON.parse(await readFile(outputPath('tests/fixtures/app-icon-picks.json'), 'utf8'))
  assert.deepEqual(withoutToday(written), withoutToday(await buildIconFixture()))
})
