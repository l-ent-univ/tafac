// Automatic icons for application tiles, picked and remembered by the server
// for the whole university (server/appIcons.js). Hand-made icons
// (services.getAppIcon) still win; these fill in the rest.
//
// Kept in memory and in localStorage per university, so a reload paints the
// same tiles right away while one request per page load refreshes them (an
// admin may have edited the server's file). The demo account's are kept
// apart, as its favourites are: the page picks them itself
// (src/demoRuntime.js), and a look at the demo never touches the picks the
// server remembers for the university.
import universityConfig from '@university'
import { ENT_AUTH_PREFIX, serverFetch } from './entApi'
import { isDemoSignedIn } from './demoRuntime'

const CACHE_KEY = `l-ent:app-icons:${universityConfig.id}`
const DEMO_CACHE_KEY = `${CACHE_KEY}:demo`
const EMPTY_ASSIGNMENTS = Object.freeze({ palette: {}, icons: {} })

// By cache key: the assignments, and the ids already asked for during this
// page load.
const memoryCaches = new Map()
const requestedIdsByKey = new Map()

const currentCacheKey = () => (isDemoSignedIn() ? DEMO_CACHE_KEY : CACHE_KEY)

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readStoredAssignments(cacheKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(cacheKey) || 'null')
    if (isRecord(stored?.palette) && isRecord(stored?.icons)) {
      return { palette: stored.palette, icons: stored.icons }
    }
  } catch {
    // Unreadable cache: start empty.
  }
  return EMPTY_ASSIGNMENTS
}

function storeAssignments(cacheKey, assignments) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(assignments))
  } catch {
    // Storage full or unavailable: the memory copy is enough.
  }
}

// { palette: { [color]: { light: { bg, fg }, dark: { bg, fg } } },
//   icons: { [applicationKey]: { icon, color } } }
export function getCachedAppIcons(cacheKey = currentCacheKey()) {
  if (!memoryCaches.has(cacheKey)) {
    memoryCaches.set(cacheKey, readStoredAssignments(cacheKey))
  }
  return memoryCaches.get(cacheKey)
}

// Asks the server about the applications not asked about yet during this
// page load and returns the merged assignments, or null when there was
// nothing new to learn. Never throws: tiles keep their letter on failure.
export async function fetchAppIcons(applications) {
  const cacheKey = currentCacheKey()
  if (!requestedIdsByKey.has(cacheKey)) requestedIdsByKey.set(cacheKey, new Set())
  const requestedIds = requestedIdsByKey.get(cacheKey)
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

    const current = getCachedAppIcons(cacheKey)
    const assignments = {
      palette: payload.palette,
      icons: { ...current.icons, ...payload.icons },
    }
    memoryCaches.set(cacheKey, assignments)
    storeAssignments(cacheKey, assignments)
    return assignments
  } catch {
    // Let a later call (retry, other establishment) try these ids again.
    for (const service of services) {
      requestedIds.delete(service.id)
    }
    return null
  }
}
