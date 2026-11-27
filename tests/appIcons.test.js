import assert from 'node:assert/strict'
import { APP_ICON_COLOR_MODES, APP_ICON_CONCEPTS, APP_ICON_HUES, APP_ICON_RULES, APP_ICON_STYLES, GENERIC_CONCEPT, MAX_REQUEST_SERVICES, assignAppIcon, hashString, isValidAppIconEntry, matchAppIcon, pickAppColor, resolveAppIconTheme, sanitizeAppIconRequest, toIconifyName } from '../src/appIconPicks.js'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildIconData, buildIconFixture, outputPath } from '../scripts/gateway-data.mjs'

function service(id, title, extra = {}) {
  return { id, title, description: '', category: '', ...extra }
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

// --- Route -----------------------------------------------------------------------

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
