// « Nouveautés » logic: which entries apply to this university, which ones
// this device hasn't seen yet, and the seen state kept in localStorage.
// Pure (no React, no @university), see tests/changelogState.test.js.
//
// The device stores the ids it has seen: `{"ids":["resume-du-jour",…]}`.
// Ids rather than a date, so an entry added later on the same day still
// shows up. Nothing stored yet means a first visit: every entry that applies
// to the student is recorded as seen without showing the pill, so a new
// student only hears about what comes after. That is settled once they are
// signed in (resolveAudienceVisit), not on the pages before: which entries
// apply depends on their university and on what they have there.

// Per device, like the theme. Never rename: devices would see everything again.
export const CHANGELOG_SEEN_KEY = 'l-ent:changelog-seen'

// `true`, or an object that isn't switched off (`weather: { enabled }`).
// Anything else, `grades: 'disabled'` included, is off.
export function isFeatureOn(value) {
  if (value === true) return true
  return value !== null && typeof value === 'object' && value.enabled !== false
}

// `university`: { id, features } (universityConfig). `audience`: what this
// student has (e.g. 'grades-page'), for entries about something not every
// student of the university gets; an entry needs all of its `audience`.
export function isEntryApplicable(entry, university = {}, audience = []) {
  if (Array.isArray(entry.universities) && entry.universities.length > 0
    && !entry.universities.includes(university.id)) {
    return false
  }

  if (Array.isArray(entry.audience) && !entry.audience.every((tag) => audience.includes(tag))) {
    return false
  }

  if (Array.isArray(entry.features)) {
    return entry.features.every((feature) => isFeatureOn(university.features?.[feature]))
  }

  return true
}

// The entries this university (and student, `audience`) gets, newest
// first. Same-day entries keep their order in the file.
export function getApplicableEntries(entries, university, audience = []) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isEntryApplicable(entry, university, audience))
    .sort((left, right) => (
      right.entry.date.localeCompare(left.entry.date) || left.index - right.index
    ))
    .map(({ entry }) => entry)
}

// Stored value → Set of seen ids, or null when nothing (usable) is stored,
// which counts as a first visit.
export function parseSeenValue(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue) return null

  try {
    const ids = JSON.parse(rawValue)?.ids
    return Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === 'string')) : null
  } catch {
    return null
  }
}

// Value to store once `ids` are seen. Only ids still in the changelog are
// kept, so removed entries don't pile up.
export function serializeSeen(ids, entries) {
  const knownIds = new Set(entries.map((entry) => entry.id))
  return JSON.stringify({ ids: [...new Set(ids)].filter((id) => knownIds.has(id)) })
}

// Where this device stands when the app starts.
//   entries: the applicable entries (getApplicableEntries)
//   allEntries: the whole changelog, for pruning
//   rawSeen: what localStorage holds under CHANGELOG_SEEN_KEY (or null)
// Returns the unseen ids (in display order) and the value to write, or null
// when storage is already right.
export function resolveChangelogVisit({ entries, allEntries = entries, rawSeen }) {
  const seen = parseSeenValue(rawSeen)

  if (!seen) {
    return {
      firstVisit: true,
      unseenIds: [],
      nextSeen: serializeSeen(entries.map((entry) => entry.id), allEntries),
    }
  }

  return {
    firstVisit: false,
    unseenIds: entries.filter((entry) => !seen.has(entry.id)).map((entry) => entry.id),
    nextSeen: null,
  }
}

// What a signed-in student's audience changes (changelogStore's
// setChangelogAudience), `entries` being what applies to them now and
// `previousEntries` what applied before it was known.
//   - a first visit: everything that applies is stored as seen, nothing is
//     new. It lasts the page load: what comes in a moment later (a relevé
//     that confirms « Mes notes ») is seen too;
//   - otherwise: the entries the audience brings in are new, unless seen.
// Returns the unseen ids and the value to write, or null when storage is
// already right.
export function resolveAudienceVisit({ entries, previousEntries = [], unseenIds = [], firstVisit, rawSeen, allEntries = entries }) {
  const stored = parseSeenValue(rawSeen)
  const seen = stored ?? new Set()

  if (firstVisit) {
    const ids = entries.map((entry) => entry.id)
    const complete = stored && ids.every((id) => seen.has(id))
    return { unseenIds: [], nextSeen: complete ? null : serializeSeen([...seen, ...ids], allEntries) }
  }

  const known = new Set(previousEntries.map((entry) => entry.id))
  const unseen = new Set(unseenIds)
  for (const entry of entries) {
    if (!known.has(entry.id) && !seen.has(entry.id)) unseen.add(entry.id)
  }
  return { unseenIds: entries.filter((entry) => unseen.has(entry.id)).map((entry) => entry.id), nextSeen: null }
}

// Value to store with `id` no longer seen (the debug menu's replay), or
// null when nothing usable is stored.
export function forgetSeen({ id, allEntries, rawSeen }) {
  const seen = parseSeenValue(rawSeen)
  if (!seen) return null
  seen.delete(id)
  return serializeSeen([...seen], allEntries)
}

// Value to store with `id` seen too (its spotlight card dismissed, its page
// visited), or null when nothing usable is stored: a device whose storage
// fails shouldn't start over with only that id.
export function markEntrySeen({ id, allEntries, rawSeen }) {
  const seen = parseSeenValue(rawSeen)
  if (!seen) return null
  seen.add(id)
  return serializeSeen([...seen], allEntries)
}

// The unseen ids the « Nouveautés » pill (and the Réglages dot) is about:
// all but `spotlight` entries, which get their own card on the dashboard
// (LaunchCard) instead of a second signal for the same thing. They stay in
// the list like any other.
export function getPillIds(entries, unseenIds) {
  const spotlit = new Set(entries.filter((entry) => entry.spotlight).map((entry) => entry.id))
  return unseenIds.filter((id) => !spotlit.has(id))
}

// The spotlight entry whose card the dashboard shows: the newest unseen one
// (`entries` come newest first), leaving out `heldIds`, or null. One card
// at a time, never two launches stacked.
export function getLaunchId(entries, unseenIds, heldIds = []) {
  const unseen = new Set(unseenIds)
  const held = new Set(heldIds)
  return entries.find((entry) => entry.spotlight && unseen.has(entry.id) && !held.has(entry.id))?.id ?? null
}

// The launches to hold back until the next visit once `id` is dealt with
// (seen, or brought back by the debug menu): the other spotlight entries
// still unseen. So closing one card doesn't pop the next one up in its
// place; it comes with the next page load.
export function getHeldLaunchIds(entries, unseenIds, id) {
  const unseen = new Set(unseenIds)
  return entries.filter((entry) => entry.spotlight && entry.id !== id && unseen.has(entry.id)).map((entry) => entry.id)
}

// Value to store once the list was opened: everything shown is seen, and
// whatever was seen before stays seen.
export function markAllSeen({ entries, allEntries = entries, rawSeen }) {
  const previous = parseSeenValue(rawSeen) ?? new Set()
  return serializeSeen([...previous, ...entries.map((entry) => entry.id)], allEntries)
}

export function readSeenValue(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(CHANGELOG_SEEN_KEY) ?? null
  } catch {
    return null
  }
}

export function writeSeenValue(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(CHANGELOG_SEEN_KEY, value)
  } catch {
    // Storage unavailable: the pill comes back next time, nothing worse.
  }
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// '2026-10-12' → '12 octobre', with the year when it isn't `now`'s.
export function formatEntryDate(date, now = new Date()) {
  const [year, month, day] = String(date).split('-').map(Number)
  if (!year || !month || !day) return ''
  const label = `${day === 1 ? '1er' : day} ${MONTHS[month - 1]}`
  return year === now.getFullYear() ? label : `${label} ${year}`
}

// Consecutive entries of the same day, for the list's date headings.
export function groupEntriesByDate(entries) {
  const groups = []
  for (const entry of entries) {
    const last = groups[groups.length - 1]
    if (last?.date === entry.date) {
      last.entries.push(entry)
    } else {
      groups.push({ date: entry.date, entries: [entry] })
    }
  }
  return groups
}
