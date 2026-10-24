// University registry. Each university lives in universities/<id>/ with a
// client.js (browser-safe), a server.js (origins, auth params, secrets) and a
// shared.js (pure data read by both).
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const UNIVERSITIES_DIR = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_UNIVERSITY_ID = 'univ-rennes'

export function listUniversityIds() {
  return readdirSync(UNIVERSITIES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

export function resolveUniversityId(rawId = process.env.UNIVERSITY) {
  const id = String(rawId || '').trim() || DEFAULT_UNIVERSITY_ID

  if (!/^[a-z0-9-]+$/.test(id) || !listUniversityIds().includes(id)) {
    throw new Error(
      `Unknown university "${id}". Available: ${listUniversityIds().join(', ')}. ` +
      'Set the UNIVERSITY env var to one of these, or add universities/<id>/ (see docs/ADDING_A_UNIVERSITY.md).',
    )
  }

  return id
}

export function clientConfigPath(id) {
  return path.join(UNIVERSITIES_DIR, id, 'client.js')
}

export async function loadServerConfig(rawId) {
  const id = resolveUniversityId(rawId)
  // Built as a runtime path (not a static template literal) so bundlers that
  // process vite.config.js don't try to glob-bundle every university module.
  const moduleUrl = pathToFileURL(path.join(UNIVERSITIES_DIR, id, 'server.js')).href
  const module = await import(moduleUrl)
  return module.default
}

// Pure-data subset (branding text, features…) usable from Node — e.g. by the
// Vite config for index.html templating and the PWA manifest.
export async function loadSharedConfig(rawId) {
  const id = resolveUniversityId(rawId)
  const moduleUrl = pathToFileURL(path.join(UNIVERSITIES_DIR, id, 'shared.js')).href
  return await import(moduleUrl)
}

// Universities one process serves: the UNIVERSITIES list (comma-separated
// ids; TENANTS is its former name), else every directory except the
// example-* stubs.
export function listServedUniversityIds(rawList = process.env.UNIVERSITIES ?? process.env.TENANTS) {
  const list = String(rawList ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  return list.length > 0
    ? [...new Set(list.map((id) => resolveUniversityId(id)))]
    : listUniversityIds().filter((id) => !id.startsWith('example'))
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

// Whether one process serves every university (tafac.fr) or a single one
// (a self-hosted instance). MULTI_UNIVERSITY decides (MULTI_TENANT is its
// former name); without it, a set UNIVERSITY means that university alone.
export function resolveMultiUniversity(env = process.env) {
  const flag = String(env.MULTI_UNIVERSITY ?? env.MULTI_TENANT ?? '').trim().toLowerCase()
  if (TRUE_VALUES.has(flag)) return true
  if (FALSE_VALUES.has(flag)) return false
  return !String(env.UNIVERSITY ?? '').trim()
}

const LOGO_EXTENSIONS = ['svg', 'png', 'webp', 'jpg']

// Path of universities/<id>/assets/logo.<ext>, or null.
export function universityLogoPath(rawId) {
  const id = resolveUniversityId(rawId)
  for (const extension of LOGO_EXTENSIONS) {
    const file = path.join(UNIVERSITIES_DIR, id, 'assets', `logo.${extension}`)
    if (existsSync(file)) return file
  }
  return null
}

// What anyone may know about a university, for the picker and the /<slug>
// entry links: its id, names, slug (university.slug in shared.js, else the
// id without its "univ-" prefix) and whether it's only listed on dev servers.
export async function loadUniversityDirectoryEntry(rawId) {
  const id = resolveUniversityId(rawId)
  const { university = {} } = await loadSharedConfig(id)
  return {
    id,
    name: university.name ?? id,
    shortName: university.shortName ?? university.name ?? id,
    slug: String(university.slug ?? id.replace(/^univ-/, '')).toLowerCase(),
    devOnly: university.devOnly === true,
  }
}
