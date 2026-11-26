// What the gateway (back/crates/tafac-gateway) reads of Node's own modules,
// written from them, and the fixtures that hold the two sides together.
//
//   node scripts/gateway-data.mjs
//
// writes:
//   back/crates/tafac-gateway/src/own/icons.json
//       the icons' lists as src/appIconPicks.js has them (the concepts and
//       their icons in each style, the hues, the keywords, each university's
//       look, the limits), and how a title's letters fold, accents and case
//       away (normalizeText, one character at a time). The gateway picks
//       with these (own/icons.rs): nothing of them is typed again in Rust.
//   tests/fixtures/app-icon-picks.json
//       titles and ids with what the JS picks for them, and the route
//       answered on a few files: the gateway's tests and tests/appIcons.test.js
//       both hold to it.
//   tests/fixtures/static-files.json
//       the page's files as server.js serves them (each type's
//       Content-Type, each path's Cache-Control, Express's ETags) and the
//       page's Content-Security-Policy for a few pages: own/statics.rs and
//       own/page_headers.rs hold to it, and so do tests/staticFiles.test.ts
//       and tests/securityHeaders.test.ts.
//
// Run it again after a change to any of those modules: the tests say when
// a file is out of date.
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
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
import { APP_ICONS_FILE_VERSION, MAX_STORED_SERVICES } from '../server/appIcons.js'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { createSessionCookieCodec } from '../server/sessionCookie.js'
import { cacheControlFor, serveBuiltFiles } from '../server/staticFiles/index.ts'
import { buildPagePolicy } from '../server/securityHeaders/index.ts'
import { listUniversityIds, loadServerConfig } from '../universities/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
    const { style, colorMode, icons } = resolveAppIconTheme((await loadServerConfig(id)).appIcons)
    themes[id] = { style, colorMode, icons }
  }
  return {
    about: 'Written by scripts/gateway-data.mjs from src/appIconPicks.js, server/appIcons.js and universities/*: never by hand.',
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

// --- The route, as Node answers it --------------------------------------------------

const SECRET = 'g'.repeat(44)

// Node's own route, on a file of each university's: its status, its body
// and the file as it is after each request. `file`: the file before the
// first one, as Node or an admin wrote it (null: none).
const ROUTE_CASES = [
  {
    university: 'univ-rennes',
    file: null,
    requests: [
      { services: PICKS.map(({ id, title, description, category }) => ({ id, title, description, category })) },
      // Some known, some new: the new ones take the hues used least.
      { services: [{ id: 'mail', title: 'Webmail renamed' }, { id: 'nouveau', title: 'Nouveau service' }, { id: 'zz-wifi', title: 'Wifi' }, { id: '12', title: 'Douze' }, { id: '3', title: 'Trois' }] },
      { services: 'nope' },
      { services: [] },
    ],
  },
  {
    university: 'univ-sorbonne-nouvelle',
    file: `${JSON.stringify({
      version: 1,
      university: 'univ-sorbonne-nouvelle',
      services: {
        'old-moodle': { icon: 'course', color: 'pink', title: 'Moodle', assignedAt: '2025-01-02' },
        pinned: { icon: 'mdi:school', color: 'teal', title: 'Moodle', assignedAt: '2025-01-02T10:00:00Z' },
        named: { icon: 'ph:books-duotone', color: 'lime', title: 'Annuaire' },
        'bad-colour': { icon: 'mail', color: 'not-a-colour', title: 'Messagerie' },
        'bad icon': { icon: 'mail', color: 'red' },
        'long-title': { icon: 'library', color: 'sky', title: `${'L'.repeat(119)}📚`, assignedAt: 20250102 },
        7: { icon: 'wifi', color: 'blue', title: 7 },
        array: ['mail', 'red'],
      },
      extra: 'kept by nobody',
    }, null, 2)}\n`,
    requests: [
      { services: [{ id: 'old-moodle', title: 'Moodle' }, { id: 'pinned', title: 'Moodle' }, { id: 'named', title: 'Annuaire' }, { id: 'bad-colour', title: 'Messagerie' }, { id: '7', title: 'Wifi' }, { id: 'new-one', title: 'Impression' }] },
    ],
  },
  {
    university: 'univ-rennes-2',
    file: '{ broken',
    requests: [
      { services: [{ id: 'moodle', title: 'Cursus (Moodle)' }, { id: 'tempo', title: 'TEMPO', description: 'Emplois du temps' }] },
    ],
  },
  {
    university: 'univ-rennes-2',
    file: `${JSON.stringify({ version: 1, university: 'univ-rennes-2', services: [{ icon: 'mail', color: 'red', title: 'An array' }] })}`,
    requests: [
      { services: [{ id: '0', title: 'Zéro' }, { id: 'one', title: 'Un' }] },
    ],
  },
]

async function answerRoute(routeCase) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tafac-gateway-icons-'))
  const filePath = path.join(dir, 'app-icons', `${routeCase.university}.json`)
  const readStored = () => readFile(filePath, 'utf8').catch(() => null)
  try {
    if (routeCase.file !== null) {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, routeCase.file)
    }
    const config = await loadServerConfig(routeCase.university)
    const app = createEntAuthApp(config, { analytics: {}, appIcons: { dataDir: dir }, session: { secret: SECRET, production: true }, demoAccount: false })
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const codec = createSessionCookieCodec({ secret: SECRET })
    const cookie = `__Host-lent_session=${codec.encode({ id: 'fixture-session', uni: config.id, user: 'student', demoState: null, createdAt: Date.now(), mode: null, jar: [] })}`
    const answered = []
    // A broken file is said in the log, which isn't the fixture's.
    const warn = console.warn
    console.warn = () => {}
    try {
      for (const body of routeCase.requests) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/__ent_auth/app-icons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify(body),
        })
        answered.push({ body: JSON.stringify(body), status: response.status, answer: await response.text(), file: await readStored() })
      }
    } finally {
      console.warn = warn
      await new Promise((resolve) => server.close(resolve))
      await app.locals.analytics.shutdown?.()
    }
    return { university: routeCase.university, file: routeCase.file, requests: answered }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function buildIconFixture() {
  const themes = {}
  for (const id of listUniversityIds()) themes[id] = resolveAppIconTheme((await loadServerConfig(id)).appIcons)
  const routes = []
  for (const routeCase of ROUTE_CASES) routes.push(await answerRoute(routeCase))
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

// --- The page's files, and the page --------------------------------------------------

// The types the build has (dist/), and a few more; another is Node's to serve.
export const STATIC_EXTENSIONS = [
  'js', 'mjs', 'css', 'html', 'json', 'map', 'webmanifest', 'txt', 'xml', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm', 'mov', 'mp3', 'wasm', 'pdf',
]

const CACHE_PATHS = [
  'assets/index-DaeHe8mh.js', 'assets/lake-D07LPwNH.webp', 'assets/sub/x.css', 'assets', 'sw.js', 'index.html',
  'manifest.webmanifest', 'icon.png', 'robots.txt', 'workbox-2fbc6a65.js', 'other/assets/x.js', 'other/sw.js', 'Assets/x.js', 'SW.JS',
]

// The files of a made-up build: their path in dist/, what they hold and
// when they changed, in nanoseconds (a fraction of a millisecond too:
// Node rounds it for the ETag and the date).
const FILES = [
  { path: 'assets/index-DaeHe8mh.js', content: 'console.log("hashed")\n', mtime: 1767323045.9996 },
  { path: 'icon.png', content: 'not really a png', mtime: 1767323045.4994 },
  { path: 'sw.js', content: '// worker', mtime: 1700000000 },
  { path: 'empty.txt', content: '', mtime: 1700000000.25 },
  { path: 'Upper.PNG', content: 'upper', mtime: 1700000000 },
  { path: 'no-extension', content: 'what is it', mtime: 1700000000 },
  { path: 'dotted.', content: 'a dot', mtime: 1700000000 },
  { path: 'archive.tar.gz', content: 'gz', mtime: 1700000000 },
  { path: 'with space.txt', content: 'space', mtime: 1700000000 },
  { path: '.hidden', content: 'hidden', mtime: 1700000000 },
  { path: 'assets/index.html', content: '<p>nested</p>', mtime: 1700000000 },
  ...STATIC_EXTENSIONS.map((extension) => ({ path: `types/file.${extension}`, content: extension, mtime: 1700000000 })),
]

const JS_FILE = '/assets/index-DaeHe8mh.js'
const ETAG_OF_JS = 'W/"16-19b7ca99070"'
const MODIFIED_JS = 'Fri, 02 Jan 2026 03:04:06 GMT'

// Requests, as a browser or a CDN sends them. `left`: one the gateway
// leaves to Node on purpose (Node answers it, or the page after it does).
const REQUESTS = [
  { path: JS_FILE },
  { path: JS_FILE, method: 'HEAD' },
  { path: '/icon.png' },
  { path: '/sw.js' },
  { path: '/empty.txt' },
  { path: '/Upper.PNG' },
  { path: '/no-extension', left: true },
  { path: '/dotted.', left: true },
  { path: '/archive.tar.gz', left: true },
  { path: '/with%20space.txt' },
  { path: '/%61ssets/index-DaeHe8mh.js' },
  ...STATIC_EXTENSIONS.map((extension) => ({ path: `/types/file.${extension}` })),
  // Conditional.
  { path: JS_FILE, headers: { 'if-none-match': ETAG_OF_JS } },
  { path: JS_FILE, method: 'HEAD', headers: { 'if-none-match': ETAG_OF_JS } },
  { path: JS_FILE, headers: { 'if-none-match': ETAG_OF_JS.slice(2) } },
  { path: JS_FILE, headers: { 'if-none-match': `"other", ${ETAG_OF_JS}` } },
  { path: JS_FILE, headers: { 'if-none-match': '"other"' } },
  { path: JS_FILE, headers: { 'if-none-match': '*' } },
  { path: JS_FILE, headers: { 'if-none-match': ETAG_OF_JS, 'cache-control': 'max-age=0, no-cache' } },
  { path: JS_FILE, headers: { 'if-none-match': ETAG_OF_JS, 'cache-control': 'no-cache-please' } },
  { path: JS_FILE, headers: { 'if-modified-since': MODIFIED_JS } },
  { path: JS_FILE, headers: { 'if-modified-since': 'Sat, 03 Jan 2026 00:00:00 GMT' } },
  { path: JS_FILE, headers: { 'if-modified-since': 'Fri, 02 Jan 2026 03:04:05 GMT' } },
  { path: JS_FILE, headers: { 'if-modified-since': 'Thu, 01 Jan 1970 00:00:00 GMT' } },
  { path: JS_FILE, headers: { 'if-modified-since': 'yesterday' }, left: true },
  { path: JS_FILE, headers: { 'if-modified-since': '2026-01-03T00:00:00Z' }, left: true },
  { path: JS_FILE, headers: { 'if-none-match': '"other"', 'if-modified-since': 'Sat, 03 Jan 2026 00:00:00 GMT' } },
  { path: JS_FILE, headers: { 'if-match': ETAG_OF_JS } },
  { path: JS_FILE, headers: { 'if-match': '*' } },
  { path: JS_FILE, headers: { 'if-match': '"other"' }, left: true },
  { path: JS_FILE, headers: { 'if-unmodified-since': 'Sat, 03 Jan 2026 00:00:00 GMT' } },
  { path: JS_FILE, headers: { 'if-unmodified-since': 'Thu, 01 Jan 1970 00:00:00 GMT' }, left: true },
  // Ranges.
  { path: JS_FILE, headers: { range: 'bytes=0-3' } },
  { path: JS_FILE, method: 'HEAD', headers: { range: 'bytes=0-3' } },
  { path: JS_FILE, headers: { range: 'bytes=5-' } },
  { path: JS_FILE, headers: { range: 'bytes=-4' } },
  { path: JS_FILE, headers: { range: 'bytes=0-99999' } },
  { path: JS_FILE, headers: { range: 'bytes=002-004' } },
  { path: JS_FILE, headers: { range: 'bytes=0-1,4-5' }, left: true },
  { path: JS_FILE, headers: { range: 'bytes=99-' }, left: true },
  { path: JS_FILE, headers: { range: 'bytes=-0' }, left: true },
  { path: JS_FILE, headers: { range: 'bytes=3-1' }, left: true },
  { path: JS_FILE, headers: { range: 'bytes= 0-3' }, left: true },
  { path: JS_FILE, headers: { range: 'items=0-3' } },
  { path: JS_FILE, headers: { range: 'bytes=0-3', 'if-range': ETAG_OF_JS } },
  { path: JS_FILE, headers: { range: 'bytes=0-3', 'if-range': '"other"' } },
  { path: JS_FILE, headers: { range: 'bytes=0-3', 'if-range': MODIFIED_JS } },
  { path: JS_FILE, headers: { range: 'bytes=0-3', 'if-range': 'Thu, 01 Jan 1970 00:00:00 GMT' } },
  { path: JS_FILE, headers: { range: 'bytes=99-', 'if-range': '"other"' } },
  { path: '/empty.txt', headers: { range: 'bytes=0-' }, left: true },
  { path: JS_FILE, headers: { range: 'bytes=0-3', 'if-none-match': ETAG_OF_JS } },
  // Not a file of the build: the page's, after.
  { path: '/missing.js', left: true },
  { path: '/assets', left: true },
  { path: '/assets/', left: true },
  { path: '/.hidden', left: true },
  { path: '/assets/../icon.png', left: true },
  { path: '/assets/%2e%2e/icon.png', left: true },
  { path: '/../etc/passwd', left: true },
  { path: '/%2e%2e/etc/passwd', left: true },
  { path: '/%00', left: true },
  { path: '/%E0%A4%A', left: true },
  { path: '//icon.png', left: true },
  { path: '/assets\\..\\icon.png', left: true },
  { path: JS_FILE, method: 'POST', left: true },
]

// Node's static handler on its own, with what follows it marked: 299 for a
// request it passes on (the page answers it on tafac.fr), 298 for an error
// it passes on (Express's own page).
async function answerStatics() {
  const dist = await mkdtemp(path.join(tmpdir(), 'tafac-gateway-dist-'))
  try {
    for (const file of FILES) {
      const filePath = path.join(dist, ...file.path.split('/'))
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, file.content)
      await utimes(filePath, file.mtime, file.mtime)
    }
    const files = []
    for (const file of FILES) {
      const stats = await stat(path.join(dist, ...file.path.split('/')), { bigint: true })
      files.push({ path: file.path, content: file.content, mtimeNs: String(stats.mtimeNs) })
    }

    const app = express()
    app.disable('x-powered-by')
    app.use(serveBuiltFiles(dist))
    app.use((_req, res) => res.status(299).end())
    app.use((_error, _req, res, _next) => res.status(298).end())
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const answers = []
    try {
      for (const asked of REQUESTS) {
        const method = asked.method ?? 'GET'
        const headers = Object.fromEntries(Object.entries(asked.headers ?? {}).filter(([name]) => name !== 'left'))
        // node:http, not fetch: fetch adds headers of its own.
        const answer = await new Promise((resolve, reject) => {
          const sent = request({ host: '127.0.0.1', port: server.address().port, method, path: asked.path, headers }, (response) => {
            const chunks = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
          })
          sent.on('error', reject)
          sent.end()
        })
        const kept = Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !['date', 'connection', 'keep-alive', 'transfer-encoding'].includes(name)))
        answers.push({ method, path: asked.path, headers, left: Boolean(asked.left), status: answer.status, answered: kept, body: answer.body })
      }
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
    return { files, answers }
  } finally {
    await rm(dist, { recursive: true, force: true })
  }
}

const ETAG_BODIES = [
  '', 'User-agent: *\nAllow: /\nDisallow: /__ent_auth/\nDisallow: /__ent_proxy/',
  'User-agent: *\nAllow: /\nDisallow: /__ent_auth/\nDisallow: /__ent_proxy/\nSitemap: https://tafac.fr/sitemap.xml',
  JSON.stringify({ webcredentials: { apps: ['ABCDE12345.fr.tafac.desktop'] } }), 'é', 'x'.repeat(1000),
]

const PAGES = [
  '<p>no script</p>',
  '<script>theme()</script><script src="/app.js"></script>',
  `<head>
    <script type="application/ld+json">{"@context":"https://schema.org"}</script>
    <script>document.documentElement.dataset.theme = 'dark'</script>
    <script type="module">import '/x.js'</script>
    <script type="module" crossorigin src="/assets/index.js"></script>
    <script src="/a.js"> </script>
    <script></script>
  </head>`,
  '<SCRIPT TYPE="TEXT/JAVASCRIPT">a()</SCRIPT><script type=" module ">b()</script><script type="text/plain">c()</script>',
  '<script type>d()</script><script type="">e()</script><script data-src="x">f()</script><script srcset="x">g()</script>',
  '<script SRC>h()</script><script src = \'x\'>i()</script><script src=x>j()</script><script x src="y"z>k()</script>',
  '<scripts>l()</scripts><script>m()</script >n()</script><script>o()</SCRIPT><script>p()',
  '<script>same()</script><script>same()</script><script>unicode("é ✓ 📚")</script><script\ttype="module"\n>q()</script>',
  '<script type="application/javascript">r()</script><script type="text/ecmascript">s()</script><script type="text/javascripts">t()</script>',
  '<script type=\'module\' src>u()</script><script type="module"src="x">v()</script><script\u00a0src="x">w()</script>',
  '<script type="module" src="x" src>x()</script><script src="a"src="b">y()</script><script type=module>z()</script>',
  '<script>a</script><script>b</script><scriptx>c</script><script/>d</script><script\n>e</script>',
]

export async function buildStaticFixture() {
  const app = express()
  const { files, answers } = await answerStatics()
  return {
    about: 'Written by scripts/gateway-data.mjs from server.js\'s modules: the gateway (own/statics.rs, own/page_headers.rs) and the Node tests hold to it.',
    contentTypes: Object.fromEntries(STATIC_EXTENSIONS.map((extension) => [extension, answers.find((answer) => answer.path === `/types/file.${extension}`).answered['content-type']])),
    cacheControl: CACHE_PATHS.map((relativePath) => [relativePath, cacheControlFor(relativePath)]),
    files,
    answers,
    // Express's weak ETag of an answer sent whole (robots.txt, Apple's file).
    etags: ETAG_BODIES.map((body) => [body, app.get('etag fn')(body, 'utf8')]),
    pagePolicies: PAGES.map((html) => [html, buildPagePolicy(html)]),
  }
}

// --- The files -------------------------------------------------------------------

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export const OUTPUTS = [
  { file: 'back/crates/tafac-gateway/src/own/icons.json', build: buildIconData },
  { file: 'tests/fixtures/app-icon-picks.json', build: buildIconFixture },
  { file: 'tests/fixtures/static-files.json', build: buildStaticFixture },
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
