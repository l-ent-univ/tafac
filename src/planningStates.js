// The planning's states, as its pages and notes tell them (PlanningNote,
// usePlanningWeeks). Pure, see tests/planningStates.test.js.
import { startOfWeek } from './planningDates.js'

// A week that failed is asked again no sooner than 30 seconds later, but
// at once when the student asks (the note's "Réessayer").
export const RETRY_AFTER_MS = 30 * 1000

// Whether a week is to be asked of /ade/upcoming now, from what is known of
// it (`entry`: none yet, or { status, events, failedAt }). `force`: again
// even when it answered (a refresh); `retry`: a failed one without waiting.
export function shouldAskWeek(entry, { force = false, retry = false, now = Date.now() } = {}) {
  if (!entry) return true
  if (entry.status === 'loading') return false
  if (entry.status === 'loaded') return force
  if (entry.status === 'unavailable') return force || retry || now - entry.failedAt >= RETRY_AFTER_MS
  return true
}

// A page's days' states as one (its single note when it has no class at
// all): any day not set up, still on its way or failed says so first.
export function pageStatus(statuses) {
  for (const status of ['unconfigured', 'loading', 'unavailable', 'no-timetable']) {
    if (statuses.includes(status)) return status
  }
  return 'loaded'
}

// The Mondays of a page's failed weeks, in order (one each), for its
// "Réessayer".
export function failedWeeks(days, statusOn) {
  return [...new Set(days.filter((day) => statusOn(day) === 'unavailable').map(startOfWeek))]
}
