import { useSyncExternalStore } from 'react'
import universityConfig from '@university'
import { CHANGELOG } from './changelog'
import {
  forgetSeen,
  getApplicableEntries,
  getHeldLaunchIds,
  markAllSeen,
  markEntrySeen,
  readSeenValue,
  resolveAudienceVisit,
  resolveChangelogVisit,
  writeSeenValue,
} from './changelogState'
import { markNewMarksSeen } from './useNewMark'

// « Nouveautés » state shared by the dashboard pill, the list and the
// Réglages row: opening the list from anywhere hides the pill. Resolved once
// per page load, on first use. A first visit shows nothing as new, and is
// recorded once the student is signed in (setChangelogAudience): the list is
// mounted on the landing and login pages too, where neither the university
// nor what the student has there is known yet.
//
// entries: what this university (and student) gets, newest first
// unseenIds: ids not seen yet, emptied when the list opens. The pill is
//   about those without `spotlight` (getPillIds); a spotlight entry has its
//   card and tab mark instead, for as long as it's in here
// open: whether the list is showing
// highlightIds: the ids that were unseen when the list opened, marked in it
//   until it closes
// heldLaunchIds: spotlight entries whose card waits for the next page load,
//   another launch having been dealt with in this one (getLaunchId)

// What this student has, beyond the university (setChangelogAudience): known
// only once the app has read the student's establishment and relevé.
let audience = []

function applicableEntries() {
  return getApplicableEntries(CHANGELOG, universityConfig, audience)
}

let state = null
const listeners = new Set()

function getState() {
  if (!state) {
    const entries = applicableEntries()
    const visit = resolveChangelogVisit({ entries, allEntries: CHANGELOG, rawSeen: readSeenValue() })
    state = { entries, unseenIds: visit.unseenIds, open: false, highlightIds: [], heldLaunchIds: [], firstVisit: visit.firstVisit }
  }
  return state
}

function setState(patch) {
  state = { ...getState(), ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useChangelog() {
  return useSyncExternalStore(subscribe, getState)
}

// What this signed-in student has (e.g. ['grades-page'] for a BUT student of
// a school with "Mes notes", 'planning-page' where the Planning page is), set
// by App.jsx once they are signed in, and again as more is known. Entries it
// brings in are new to the pill, unless this is the device's first visit:
// then everything that applies is recorded as seen (resolveAudienceVisit),
// the blue « new » dots included (useNewMark): nothing is new to a student
// who has just arrived.
let studentKnown = false

export function setChangelogAudience(nextAudience) {
  const next = [...new Set(nextAudience)].sort()
  if (studentKnown && next.join() === audience.join()) return
  const firstCall = !studentKnown
  studentKnown = true
  audience = next

  const current = getState()
  const entries = applicableEntries()
  const { unseenIds, nextSeen } = resolveAudienceVisit({
    entries,
    previousEntries: current.entries,
    unseenIds: current.unseenIds,
    firstVisit: current.firstVisit,
    rawSeen: readSeenValue(),
    allEntries: CHANGELOG,
  })
  if (nextSeen) writeSeenValue(nextSeen)
  if (current.firstVisit && firstCall) markNewMarksSeen()
  setState({ entries, unseenIds })
}

// Opens the list and marks everything in it as seen.
export function openChangelog() {
  const { entries, unseenIds } = getState()
  writeSeenValue(markAllSeen({ entries, allEntries: CHANGELOG, rawSeen: readSeenValue() }))
  setState({ open: true, highlightIds: unseenIds, unseenIds: [] })
}

// Read once: reopening the list later shows nothing as new.
export function closeChangelog() {
  setState({ open: false, highlightIds: [] })
}

// One entry seen, the others left as they are: a spotlight entry's card
// closed or its page visited. Nothing to do once it's seen. The other
// launches still unseen keep their tab mark but wait for the next page
// load for their card (getHeldLaunchIds).
export function markChangelogEntrySeen(id) {
  const { entries, unseenIds, heldLaunchIds } = getState()
  if (!unseenIds.includes(id)) return
  const nextSeen = markEntrySeen({ id, allEntries: CHANGELOG, rawSeen: readSeenValue() })
  if (nextSeen) writeSeenValue(nextSeen)
  const isLaunch = entries.some((entry) => entry.id === id && entry.spotlight)
  setState({
    unseenIds: unseenIds.filter((unseenId) => unseenId !== id),
    heldLaunchIds: isLaunch ? [...new Set([...heldLaunchIds, ...getHeldLaunchIds(entries, unseenIds, id)])] : heldLaunchIds,
  })
}

// Debug menu: makes `id` unseen again, so the pill (or, for a spotlight
// entry, its card and tab mark) comes back for it. A spotlight entry's card
// comes first, the other launches held back for this visit.
// False when the entry doesn't apply to this student.
export function replayChangelogEntry(id) {
  const { entries, unseenIds, heldLaunchIds } = getState()
  const entry = entries.find((candidate) => candidate.id === id)
  if (!entry) return false
  const nextSeen = forgetSeen({ id, allEntries: CHANGELOG, rawSeen: readSeenValue() })
  if (nextSeen) writeSeenValue(nextSeen)
  const unseen = new Set([...unseenIds, id])
  setState({
    open: false,
    highlightIds: [],
    unseenIds: entries.filter((candidate) => unseen.has(candidate.id)).map((candidate) => candidate.id),
    heldLaunchIds: entry.spotlight ? getHeldLaunchIds(entries, [...unseen], id) : heldLaunchIds,
  })
  return true
}
