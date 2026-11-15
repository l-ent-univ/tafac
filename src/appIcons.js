// Automatic icons for application tiles, picked and remembered by the server
// for the whole university (server/appIcons.js). Hand-made icons
// (services.getAppIcon) still win; these fill in the rest.
//
// Kept in memory and in localStorage per university, so a reload paints the
// same tiles right away while one request per page load refreshes them (an
// admin may have edited the server's file).
import universityConfig from '@university'
import { ENT_AUTH_PREFIX, serverFetch } from './entApi'

const CACHE_KEY = `l-ent:app-icons:${universityConfig.id}`
const EMPTY_ASSIGNMENTS = Object.freeze({ palette: {}, icons: {} })

let memoryCache = null
// Ids already asked for during this page load.
const requestedIds = new Set()

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readStoredAssignments() {
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (isRecord(stored?.palette) && isRecord(stored?.icons)) {
      return { palette: stored.palette, icons: stored.icons }
    }
  } catch {
    // Unreadable cache: start empty.
  }
  return EMPTY_ASSIGNMENTS
}

function storeAssignments(assignments) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(assignments))
  } catch {
    // Storage full or unavailable: the memory copy is enough.
  }
}

// { palette: { [color]: { light: { bg, fg }, dark: { bg, fg } } },
//   icons: { [applicationKey]: { icon, color } } }
export function getCachedAppIcons() {
  if (!memoryCache) {
    memoryCache = readStoredAssignments()
  }
  return memoryCache
}

// Asks the server about the applications not asked about yet during this
// page load and returns the merged assignments, or null when there was
// nothing new to learn. Never throws: tiles keep their letter on failure.
export async function fetchAppIcons(applications) {
  const services = []
  for (const application of applications) {
    const id = application.fname || application.id
    if (!id || !application.title || requestedIds.has(id)) {
      continue
    }

    requestedIds.add(id)
    services.push({
      id,
      title: application.title,
      description: application.description || undefined,
      category: application.category || undefined,
    })
  }

  if (services.length === 0) {
    return null
  }

  try {
    const response = await serverFetch(`${ENT_AUTH_PREFIX}/app-icons`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ services }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !isRecord(payload?.icons) || !isRecord(payload?.palette)) {
      throw new Error(`App icons request failed (${response.status}).`)
    }

    const current = getCachedAppIcons()
    memoryCache = {
      palette: payload.palette,
      icons: { ...current.icons, ...payload.icons },
    }
    storeAssignments(memoryCache)
    return memoryCache
  } catch {
    // Let a later call (retry, other establishment) try these ids again.
    for (const service of services) {
      requestedIds.delete(service.id)
    }
    return null
  }
}
