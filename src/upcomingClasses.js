import { getAdeUpcoming } from './entApi'

// Upcoming ADE classes, shared by the "Prochain cours" card and the greeting
// briefing: both read the same on-device cache entry, and only one of them
// asks the server (the card when it is shown, the briefing otherwise).

export const NEXT_CLASS_CACHE_KEY = 'l-ent:next-class-cache'
export const NEXT_CLASS_CACHE_TTL_MS = 48 * 60 * 60 * 1000
export const NEXT_CLASS_LOOKAHEAD_DAYS = 21

const CLASS_COLORS_KEY = 'l-ent:class-colors'

// Stable random hue per class title, shared by the "Prochain cours" card and
// the planning page so a class keeps its colour everywhere.
export function getClassHue(title) {
  try {
    const stored = JSON.parse(localStorage.getItem(CLASS_COLORS_KEY) || '{}')
    if (stored[title] != null) return stored[title]
    // From the title, not at random: a course keeps its colour on every device.
    let hue = 0
    for (const char of String(title ?? '')) hue = (hue * 31 + char.codePointAt(0)) % 360
    stored[title] = hue
    localStorage.setItem(CLASS_COLORS_KEY, JSON.stringify(stored))
    return hue
  } catch {
    return 207
  }
}

export function formatDateOnly(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getTodayDateString() {
  return formatDateOnly(new Date())
}

export function buildResourceIdsFromSelection(selection) {
  const candidates = [
    selection?.tpResourceId,
    selection?.tdResourceId,
    selection?.yearResourceId,
    selection?.resourceId,
  ]

  return candidates.filter((value, index) => {
    const normalizedValue = String(value ?? '').trim()
    if (!normalizedValue) {
      return false
    }

    return candidates.findIndex((candidate) => String(candidate ?? '').trim() === normalizedValue) === index
  }).map((value) => String(value).trim())
}

export function buildNextClassCacheEntryKey(sessionUser, resourceKey, lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS) {
  const normalizedUser = String(sessionUser ?? '').trim()
  const normalizedResourceKey = String(resourceKey ?? '').trim()

  if (!normalizedUser || !normalizedResourceKey) {
    return ''
  }

  return `${normalizedUser}::${normalizedResourceKey}::${lookaheadDays}d`
}

// Events exactly as cached (no sorting or labels), or null when there is no
// fresh entry for this user, group selection and lookahead.
export function readNextClassCache(cacheKey) {
  if (!cacheKey) {
    return null
  }

  try {
    const rawValue = localStorage.getItem(NEXT_CLASS_CACHE_KEY)
    if (!rawValue) {
      return null
    }

    const parsedValue = JSON.parse(rawValue)
    if (!parsedValue || typeof parsedValue !== 'object') {
      return null
    }

    if (parsedValue.cacheKey !== cacheKey || !Array.isArray(parsedValue.events)) {
      return null
    }

    if (Date.now() - Number(parsedValue.cachedAt ?? 0) > NEXT_CLASS_CACHE_TTL_MS) {
      return null
    }

    return {
      events: parsedValue.events,
      complete: parsedValue.complete !== false,
      cachedAt: Number(parsedValue.cachedAt ?? 0),
    }
  } catch {
    return null
  }
}

export function persistNextClassCache(cacheKey, result) {
  if (!cacheKey || !Array.isArray(result?.events)) {
    return
  }

  try {
    localStorage.setItem(NEXT_CLASS_CACHE_KEY, JSON.stringify({
      cacheKey,
      complete: result.complete !== false,
      events: result.events,
      cachedAt: Date.now(),
    }))
  } catch {
    // Storage unavailable
  }
}

// One /ade/upcoming request; throws when the ENT session is gone.
export async function fetchUpcomingEvents({
  selection,
  signal,
  startDate = getTodayDateString(),
  lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS,
}) {
  const data = await getAdeUpcoming({
    date: startDate,
    lookaheadDays,
    selection,
    signal,
  })

  if (!data?.authenticated) {
    throw new Error('Connexion requise pour charger le planning')
  }

  return {
    complete: data?.upcoming?.complete !== false,
    events: Array.isArray(data?.upcoming?.events) ? data.upcoming.events : [],
  }
}
