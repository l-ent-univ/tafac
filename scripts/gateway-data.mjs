// What the gateway (back/crates/tafac-gateway) reads of the page's own
// modules, written from them, and the fixture that holds the two sides
// together.
//
//   node scripts/gateway-data.mjs
//
// writes:
//   back/crates/tafac-gateway/src/own/icons.json
//       the icons' lists as src/appIconPicks.js has them (the concepts and
//       their icons in each style, the hues, the keywords, each university's
//       look from its shared.js, the limits), and how a title's letters
//       fold, accents and case away (normalizeText, one character at a
//       time). The gateway picks with these (own/icons.rs): nothing of them
//       is typed again in Rust.
//   tests/fixtures/app-icon-picks.json
//       titles and ids with what the JS picks for them, and the route as
//       Node answered it on a few files (kept, no longer written again: Node
//       is gone). The gateway's tests and tests/appIcons.test.js both hold
//       to it.
//
// tests/fixtures/static-files.json, the page's files as Node served them,
// is no longer written: it is what the gateway holds to (own/statics.rs,
// own/page_headers.rs, own/conditional.rs).
//
// Run it again after a change to src/appIconPicks.js or a university's
// look: the tests say when a file is out of date.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_ICON_COLOR_MODES,
  APP_ICON_HUES,
  APP_ICON_RULES,
  APP_ICON_STYLES,
  BRAND_CONCEPTS,
  GENERIC_CONCEPT,
  ICON_NAME_PATTERN,
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_REQUEST_SERVICES,
  MAX_TITLE_LENGTH,
  SERVICE_ID_PATTERN,
  assignAppIcon,
  hashString,
  isPinnedAppIcon,
  matchAppIcon,
  matchAppIconBrand,
  normalizeText,
  pickAppColor,
  resolveAppIconTheme,
  sanitizeAppIconRequest,
  toIconifyName,
} from '../src/appIconPicks.js'
import { listUniversityIds, loadSharedConfig } from '../universities/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The icons' file as the gateway keeps it (own/icons.rs), as Node's server
// kept it before: its version, and how many tiles it remembers.
const APP_ICONS_FILE_VERSION = 1
const MAX_STORED_SERVICES = 500

// --- The icons' data -----------------------------------------------------------

// How each character outside ASCII folds in normalizeText, by itself:
// nothing (a combining mark), letters and digits (an accented letter, the
// Kelvin sign…), or a separator (everything else, left out of the table).
// [first, last, folded] for runs of code points that fold alike. ASCII is
// the gateway's own: A-Z lower, a-z 0-9 + kept, the rest a separator.
//
// normalizeText works on a whole title, but one character at a time comes
// to the same: NFD decomposes each character alone and reorders only marks,
// which go; lower case differs in context only for the Greek final sigma,
// a separator either way.
function buildFold() {
  const runs = []
  for (let code = 0x80; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue
    const folded = String.fromCodePoint(code)
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9+]/g, ' ')
    // A separator, however many: not listed.
    if (folded !== '' && folded.trim() === '') continue
    const last = runs.at(-1)
    if (last && last[1] === code - 1 && last[2] === folded) {
      last[1] = code
    } else {
      runs.push([code, code, folded])
    }
  }
  return runs
}

// One of our own icons stored by name (any style) → its concept, as
// toIconifyName reads it: the last style that draws it wins.
function buildBuiltInIcons() {
  const byIcon = new Map()
  for (const icons of Object.values(APP_ICON_STYLES)) {
    for (const [concept, icon] of Object.entries(icons)) byIcon.set(icon, concept)
  }
  return Object.fromEntries(byIcon)
}

export async function buildIconData() {
  const themes = {}
  for (const id of listUniversityIds()) {
    const { style, colorMode, icons } = resolveAppIconTheme((await loadSharedConfig(id)).appIcons)
    themes[id] = { style, colorMode, icons }
  }
  return {
    about: 'Written by scripts/gateway-data.mjs from src/appIconPicks.js and universities/*/shared.js: never by hand.',
    fileVersion: APP_ICONS_FILE_VERSION,
    maxStoredServices: MAX_STORED_SERVICES,
    maxRequestServices: MAX_REQUEST_SERVICES,
    maxTitleLength: MAX_TITLE_LENGTH,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
    maxCategoryLength: MAX_CATEGORY_LENGTH,
    servicePattern: SERVICE_ID_PATTERN.source,
    iconNamePattern: ICON_NAME_PATTERN.source,
    generic: GENERIC_CONCEPT,
    brands: [...BRAND_CONCEPTS],
    hues: APP_ICON_HUES,
    concepts: Object.keys(APP_ICON_STYLES.carbon),
    builtInIcons: buildBuiltInIcons(),
    colorModes: APP_ICON_COLOR_MODES,
    themes,
    rules: APP_ICON_RULES,
    fold: buildFold(),
  }
}

// --- What the JS picks -------------------------------------------------------------

const TEXTS = [
  'Messagerie', 'Webmail étudiant', 'BIBLIOTHÈQUE', 'Bibliothèque', 'École', 'École', 'Œuvres',
  'Ångström', 'Kelvin', 'İstanbul', 'Straße', 'ﬁchier', 'Ｍail', 'naïve café', 'Crédits d\'impression',
  'Wi-Fi eduroam', 'Écri+ et Voltaire', 'C++ / Java', '  espaces insécables et\ttabs  ', 'ΣΟΦΙΑ Σ',
  '한국어 강의', 'Notes 📚 IUT', 'á̂̃b', 'x̸y', '́début', 'fiń', 'ǅungla', 'ⅷ',
  '', '   ', '---', 'ĳssel', 'Ŀlama', 'ŉ', 'Ǆ', 'Ǳ', 'ǈ', 'ﬀ', '①', 'Ⓜoodle', 'ｅcole',
]

// A service as sanitizeAppIconRequest gives it.
const service = (id, title, description = '', category = '') => ({ id, title, description, category })

const PICKS = [
  service('mail', 'Messagerie'),
  service('webmail-etu', 'Webmail étudiant'),
  service('moodle-foad', 'Moodle - FOAD'),
  service('foad', 'FOAD'),
  service('edt', 'Mon emploi du temps'),
  service('emploi', 'Emploi et carrière'),
  service('bu', 'BU'),
  service('bureautique', 'Bureautique'),
  service('information', 'Information'),
  service('pod', 'Pod', 'Plateforme vidéo'),
  service('zebulon', 'Zébulon', '', 'Pédagogie'),
  service('zebulon-2', 'Zébulon', 'Un outil maison'),
  service('zebulon-3', 'Zébulon'),
  service('ecri', 'Écri+'),
  service('ia', 'IA générative'),
  service('wifi', 'Wi-Fi eduroam'),
  service('aides', 'Aides financières'),
  service('contrat', 'Contrat pédagogique'),
  service('listes', 'Listes de diffusion'),
  service('ortho', 'Évaluation orthographique'),
  service('theses', 'Portail des thèses'),
  service('pret', 'Prêt de matériel'),
  service('accents', 'BIBLIOTHÈQUES'),
  service('kelvin', 'Ke'),
  service('ent', 'ENT'),
  service('portail-ent', 'Portail ENT'),
  service('doc', 'Doc'),
  service('doc-2', 'Doc en ligne'),
  service('emoji', '📚 Bibliothèque'),
  service('long', `${'Une très longue description '.repeat(4)}mail`),
  service('Aa', 'Annuaire'),
  service('aA', 'Annuaire'),
  service('0', 'Zéro'),
  service('4294967294', 'Index'),
  service('4294967295', 'Pas un index'),
  service('x_y.z-1', 'Code source'),
]

const IDS = [
  'a', 'A', 'b', 'B', 'a-b', 'a_b', 'a.b', 'ab', 'aB', 'Ab', 'AB', 'a0', 'a9', '0', '9', '10', '2', '007', 'a-', 'a_', 'a.',
  'x-1', 'x.1', 'x_1', 'x1', 'xa', 'X1', 'z', 'Z', 'aa', 'aA', 'Aa', 'AA', 'a-a', 'a-A', 'A-a', 'moodle-foad', 'moodle_foad',
  'moodle.foad', 'moodlefoad', 'Moodle-Foad', 'lent-iutlan-notes9', 'lent-iutlan-notes10', 'portal-tool-12', 'portal-tool-2',
  'webapp-ade', 'webapp-ADE', 'webapp-ade-2', '1a', 'a1', 'A1', '_', '-', '.', 'x--y', 'x-_y', 'x_-y', 'x..y', 'q', 'Q', 'q9z',
]

const BODIES = [
  null, 'services', 7, [], {}, { services: 'x' }, { services: {} }, { services: [] }, { services: null },
  {
    services: [
      { id: 'moodle-foad', title: '  Moodle\n - FOAD ', description: 42, category: 'Pédagogie' },
      { id: 'moodle-foad', title: 'Duplicate' },
      { id: '../../etc/passwd', title: 'Path' },
      { id: 'has space', title: 'Space' },
      { id: 'x'.repeat(65), title: 'Too long' },
      { id: 'x'.repeat(64), title: 'Long enough' },
      { id: 'no-title', title: '   ' },
      { id: 'not-a-string', title: { toString: 'x' } },
      { id: 42, title: 'Number' },
      { id: '  trimmed ', title: 'Trimmed id' },
      { id: '-dash-first', title: 'Dash' },
      { id: 'lent-iutlan-notes9', title: 'T'.repeat(500), description: 'D'.repeat(500), category: 'C'.repeat(50) },
      { id: 'controls', title: 'A\u0000B\u0007\u0085C​D﻿E F', description: '\t\tx\r\n y ', category: ' é ' },
      { id: 'cut-emoji', title: `${'a'.repeat(119)}📚 and more` },
      { id: 'cut-space', title: `${'a'.repeat(119)} b` },
      'garbage',
      null,
      ['id', 'title'],
    ],
  },
  { services: Array.from({ length: MAX_REQUEST_SERVICES + 5 }, (_, index) => ({ id: `s${index}`, title: `S${index}` })) },
  { services: [{ id: 'a', title: 'A' }], other: true },
]

const STORED = ['mail', 'library', 'moodle', 'generic', 'carbon:book', 'ph:book-open-duotone', 'devicon-plain:moodle', 'mdi:soccer', '???', 'nope', 'Mail', 'tabler:x']

// --- The route, as Node answered it ------------------------------------------------

// Node's route on a file of each university's, before Node went (27 November
// 2026): its status, its body and the file after each request. Kept as they
// were written, the gateway's (own/icons.rs) to answer alike; no longer
// written again.
async function nodesRoutes() {
  const kept = JSON.parse(await readFile(outputPath('tests/fixtures/app-icon-picks.json'), 'utf8'))
  return kept.routes
}

export async function buildIconFixture() {
  const themes = {}
  for (const id of listUniversityIds()) themes[id] = resolveAppIconTheme((await loadSharedConfig(id)).appIcons)
  const routes = await nodesRoutes()
  return {
    about: 'Written by scripts/gateway-data.mjs from what the JS picks: the gateway (own/icons.rs) and tests/appIcons.test.js hold to it.',
    // The day the stores wrote down (assignedAt), for the files below.
    today: new Date().toISOString().slice(0, 10),
    normalized: TEXTS.map((text) => [text, normalizeText(text)]),
    picks: PICKS.map((picked) => ({
      ...picked,
      concept: matchAppIcon(picked),
      brand: matchAppIconBrand(picked.title),
      hash: hashString(picked.id),
      assigned: assignAppIcon(picked),
    })),
    colors: [
      // Hue → tiles of it already: the next least used from the id's own.
      { id: 'some-service', usage: {}, color: pickAppColor('some-service', new Map()) },
      { id: 'some-service', usage: { [pickAppColor('some-service')]: 1 }, color: pickAppColor('some-service', new Map([[pickAppColor('some-service'), 1]])) },
      { id: 'other', usage: Object.fromEntries(APP_ICON_HUES.map((hue, index) => [hue, index % 3])), color: pickAppColor('other', new Map(APP_ICON_HUES.map((hue, index) => [hue, index % 3]))) },
    ],
    sanitized: BODIES.map((body) => ({ body, services: sanitizeAppIconRequest(body) })),
    sorted: [...IDS].sort((a, b) => a.localeCompare(b)),
    iconify: Object.entries(themes).flatMap(([university, theme]) => STORED.map((stored) => ({
      university, stored, name: toIconifyName(stored, theme), pinned: isPinnedAppIcon(stored),
    }))),
    routes,
  }
}

// --- The files -------------------------------------------------------------------

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export const OUTPUTS = [
  { file: 'back/crates/tafac-gateway/src/own/icons.json', build: buildIconData },
  { file: 'tests/fixtures/app-icon-picks.json', build: buildIconFixture },
]

export function outputPath(file) {
  return path.join(ROOT, file)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, build } of OUTPUTS) {
    await writeFile(outputPath(file), serialize(await build()))
    console.log(`wrote ${file}`)
  }
}
