import universityConfig from '@university'
import { getTimetable } from './entApi'
import { addDays } from './planningDates'
import { classOfCourse } from './planningEvents'

// Upcoming ADE classes, shared by the "Prochain cours" card and the greeting
// briefing: both read the same on-device cache entry, and only one of them
// asks the server (the card when it is shown, the briefing otherwise).

export const NEXT_CLASS_CACHE_KEY = 'l-ent:next-class-cache'
export const NEXT_CLASS_CACHE_TTL_MS = 48 * 60 * 60 * 1000
export const NEXT_CLASS_LOOKAHEAD_DAYS = 21

function formatDateOnly(date) {
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
      noTimetable: parsedValue.noTimetable === true,
      cachedAt: Number(parsedValue.cachedAt ?? 0),
    }
  } catch {
    return null
  }
}

// Signed out: the classes kept for the next visit go with the session.
export function clearNextClassCache() {
  academicYears.clear()
  try {
    localStorage.removeItem(NEXT_CLASS_CACHE_KEY)
  } catch {
    // Storage unavailable
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
      noTimetable: result.noTimetable === true,
      events: result.events,
      cachedAt: Date.now(),
    }))
  } catch {
    // Storage unavailable
  }
}

// The ids a selection asks the planning for: ADE's resources, digits only.
// A personal timetable's own (« personal », TEMPO's « tempo ») is none: the
// planning then gives the student's own classes.
export function planningResources(selection) {
  return buildResourceIdsFromSelection(selection).filter((id) => /^\d+$/.test(id))
}

// A personal timetable (planning.personal: TEMPO) can have no class at all
// for the account, all year (another campus, a course outside it): not a
// free week. Each academic year asked once (1 July to 31 August the next
// year, as TEMPO's own), by its first year: whether it has none.
const academicYears = new Map()

function academicYearIsEmpty(year, signal) {
  if (!academicYears.has(year)) {
    const asked = getTimetable({ from: `${year}-07-01`, to: `${year + 1}-08-31`, signal })
      .then((answer) => !(Array.isArray(answer?.data) && answer.data.length > 0))
    asked.catch(() => academicYears.delete(year))
    academicYears.set(year, asked)
  }
  return academicYears.get(year)
}

// Whether the academic years `from` to `to` meet have no class at all.
async function hasNoTimetable(from, to, signal) {
  const years = []
  for (let year = Number(from.slice(0, 4)) - 1; year <= Number(to.slice(0, 4)); year += 1) {
    if (`${year}-07-01` <= to && `${year + 1}-08-31` >= from) years.push(year)
  }
  const empty = await Promise.all(years.map((year) => academicYearIsEmpty(year, signal)))
  return empty.length > 0 && empty.every(Boolean)
}

// The classes of `lookaheadDays` days from `startDate` (one request), as
// the page keeps them (classOfCourse); throws when the planning can't say.
// `noTimetable`: the student has none there at all, a personal timetable
// without a class all year, or a university whose planning isn't served
// (tonAPI's `service_absent`: a link to the university's own).
export async function fetchUpcomingEvents({
  selection,
  signal,
  startDate = getTodayDateString(),
  lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS,
}) {
  const from = startDate
  const to = addDays(startDate, Math.max(1, lookaheadDays) - 1)
  let courses
  try {
    const answer = await getTimetable({ from, to, resources: planningResources(selection), signal })
    courses = Array.isArray(answer?.data) ? answer.data : []
  } catch (error) {
    if (error?.code === 'service_absent') return { complete: true, events: [], noTimetable: true }
    throw error
  }

  const events = courses.map(classOfCourse).filter(Boolean)
  const noTimetable = events.length === 0 && universityConfig.planning?.personal === true
    ? await hasNoTimetable(from, to, signal).catch(() => false)
    : false
  return { complete: true, events, noTimetable }
}
