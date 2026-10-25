// Which universities this server has and which one the page runs for, as
// GET /__ent_auth/universities said at boot (server/universitiesApp.js), and
// the university picked on the login page. No @university import: boot code
// and entApi.js read it. The pure parts (readEntryPath, pickBootUniversity)
// are tested in tests/universityRuntime.test.js.

// The university picked on the login page (or last signed in to): its id.
export const UNIVERSITY_CHOICE_KEY = 'l-ent:university'
// Address of the university picker: forgets the choice.
export const PICKER_PATH = '/universites'
export const UNIVERSITY_HEADER = 'X-Tafac-University'

const state = {
  mode: 'single',
  defaultUniversity: null,
  session: null,
  host: null,
  universities: [],
  loadedId: null,
}

export function setUniversityDirectory(info) {
  state.mode = info?.mode === 'multi' ? 'multi' : 'single'
  state.defaultUniversity = info?.defaultUniversity ?? null
  state.session = info?.session ?? null
  state.host = info?.host ?? null
  state.universities = Array.isArray(info?.universities) ? info.universities : []
}

export function setLoadedUniversityId(id) {
  state.loadedId = id ?? null
}

// The university whose config the page runs on; null on the neutral page.
export function getLoadedUniversityId() {
  return state.loadedId
}

// Several universities on this server: the login page offers a picker.
export function isMultiUniversity() {
  return state.mode === 'multi'
}

// The universities the picker lists (dev-only ones only on dev servers).
export function getListedUniversities() {
  return state.universities.filter((entry) => entry.listed !== false)
}

export function findUniversity(idOrSlug) {
  const name = String(idOrSlug ?? '').trim().toLowerCase()
  if (!name) return null
  return state.universities.find((entry) => (
    entry.id === name || entry.slug === name || entry.id.replace(/-/g, '') === name
  )) ?? null
}

export function readUniversityChoice(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(UNIVERSITY_CHOICE_KEY) || null
  } catch {
    return null
  }
}

export function writeUniversityChoice(id, storage = globalThis.localStorage) {
  try {
    if (id) storage?.setItem(UNIVERSITY_CHOICE_KEY, id)
    else storage?.removeItem(UNIVERSITY_CHOICE_KEY)
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

// Sent with the requests that can run signed out (session, login): the
// server routes them to this university. Signed in, the session decides.
export function getUniversityRequestHeaders() {
  return state.mode === 'multi' && state.loadedId ? { [UNIVERSITY_HEADER]: state.loadedId } : {}
}

// What the address asks for: `/<slug>` (or the id) of a served university,
// the picker, or nothing.
export function readEntryPath(pathname, universities = []) {
  const name = String(pathname ?? '').replace(/^\/+|\/+$/g, '').toLowerCase()
  if (!name || name.includes('/')) return null
  if (`/${name}` === PICKER_PATH) return { kind: 'picker' }

  const entry = universities.find((university) => (
    university.slug === name || university.id === name || university.id.replace(/-/g, '') === name
  ))
  return entry ? { kind: 'university', id: entry.id } : null
}

// The university the page boots for, or null for the neutral page:
//   - no answer from the server (offline): the last one picked;
//   - one university on this server: that one;
//   - signed in: the session's, whatever else;
//   - the address (/<slug>, or the picker), the stored choice, the old
//     per-university address, in that order.
export function pickBootUniversity({ info, entry = null, storedChoice = null }) {
  if (!info) return storedChoice || null

  const universities = Array.isArray(info.universities) ? info.universities : []
  const served = (id) => Boolean(id) && universities.some((entry) => entry.id === id)

  if (info.mode !== 'multi') return universities[0]?.id ?? info.defaultUniversity ?? null
  if (served(info.session)) return info.session
  if (entry?.kind === 'picker') return null
  if (entry?.kind === 'university' && served(entry.id)) return entry.id
  if (served(storedChoice)) return storedChoice
  if (served(info.host)) return info.host
  return null
}

// The page's address and SEO text, as the server sends them (server.js): on
// a server with every university, a university's /<slug> has its own (its
// landing page) and any other address Tafac's, whichever university was
// picked; on a single-university server, the university's everywhere. Pure:
// tested in tests/universityRuntime.test.js.
export function readSeoPage({ pathname, multiUniversity, university, branding, neutral }) {
  if (!multiUniversity) return { path: '/', branding }
  const clean = String(pathname ?? '').replace(/\/+$/, '').toLowerCase()
  if (university?.slug && clean === `/${university.slug}`) return { path: `/${university.slug}`, branding }
  return { path: '/', branding: neutral }
}
