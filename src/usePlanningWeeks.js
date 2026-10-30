import { useCallback, useEffect, useMemo, useState } from 'react'
import { getRequestErrorKind } from './entApi'
import { buildResourceIdsFromSelection, fetchUpcomingEvents } from './upcomingClasses'
import { assignAccent } from './eventAccents'
import { startOfWeek } from './planningDates'
import { mergeEvents, toPlanningEvent } from './planningEvents'
import { shouldAskWeek } from './planningStates'

// The planning's weeks, as the iOS app keeps them (PlanningEvents): one
// /ade/upcoming request a week (its Monday and the six days after, the
// student's groups), kept in memory for the visit, by account and groups.
// A week that failed is asked again no sooner than 30 seconds later
// (RETRY_AFTER_MS), at once on `retry`; one asked again (a refresh) keeps
// its classes meanwhile.
const weeks = new Map()
// The pages showing them (each hook's re-render), told of any week that
// changes, whoever asked it (a page, or a mail's lookup: readPlanningEvents).
const listeners = new Set()
const pending = new Map()

function planningScope(selection, user) {
  return `${user ?? ''}::${buildResourceIdsFromSelection(selection).join('|')}`
}

// One week asked (or not: shouldAskWeek), its answer kept. → a promise
// settled once it's known.
function askWeek(scope, selection, monday, { force = false, retry = false } = {}) {
  const key = `${scope}::${monday}`
  const entry = weeks.get(key)
  if (!shouldAskWeek(entry, { force, retry })) return pending.get(key) ?? Promise.resolve()
  const notify = () => listeners.forEach((listener) => listener())
  weeks.set(key, { ...entry, status: 'loading' })
  notify()
  const promise = fetchUpcomingEvents({ selection, startDate: monday, lookaheadDays: 7 })
    .then(({ events, noTimetable }) => {
      weeks.set(key, { status: 'loaded', events: mergeEvents(events.map(toPlanningEvent)), noTimetable })
    })
    .catch((error) => {
      weeks.set(key, entry?.events
        ? { status: 'loaded', events: entry.events }
        : { status: 'unavailable', failedAt: Date.now(), errorKind: getRequestErrorKind(error) })
    })
    .finally(() => {
      pending.delete(key)
      notify()
    })
  pending.set(key, promise)
  return promise
}

// The classes of the weeks of `mondays` for this account, from the cache
// or asked now (the same requests as the Planning's), outside a page: a
// mail about a grade looks for its module's teachers there. A week that
// fails is left out. → a promise of the classes, in order.
export async function readPlanningEvents({ selection, user, mondays }) {
  if (!selection) return []
  const scope = planningScope(selection, user)
  await Promise.all(mondays.map((monday) => askWeek(scope, selection, monday)))
  return mergeEvents(...mondays.map((monday) => weeks.get(`${scope}::${monday}`)?.events ?? []))
}

export function usePlanningWeeks({ selection, user }) {
  const scope = useMemo(() => planningScope(selection, user), [selection, user])
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])

  const load = useCallback((monday, { force = false, retry = false } = {}) => {
    if (!selection) return
    void askWeek(scope, selection, monday, { force, retry })
  }, [scope, selection])

  // Every class known for this account, in order.
  const events = useMemo(() => {
    void version
    const lists = []
    for (const [key, entry] of weeks) {
      if (key.startsWith(`${scope}::`) && entry.events) lists.push(entry.events)
    }
    return mergeEvents(...lists)
  }, [scope, version])

  // A day's state: 'loaded' (its week answered), 'loading' (on its way, or
  // not asked yet), 'unavailable' (it failed), 'unconfigured' (no group),
  // 'no-timetable' (the planning service has none for this account: TEMPO).
  const statusOn = useCallback((day) => {
    void version
    if (!selection) return 'unconfigured'
    const entry = weeks.get(`${scope}::${startOfWeek(day)}`)
    if (entry?.events) return entry.noTimetable ? 'no-timetable' : 'loaded'
    return entry?.status === 'unavailable' ? 'unavailable' : 'loading'
  }, [scope, selection, version])

  // Why a day's week failed, as a category only (getRequestErrorKind), for
  // the anonymous analytics; null unless it is 'unavailable'.
  const errorKindOn = useCallback((day) => {
    void version
    const entry = weeks.get(`${scope}::${startOfWeek(day)}`)
    return entry?.status === 'unavailable' ? entry.errorKind ?? null : null
  }, [scope, version])

  // The student's "Réessayer": a failed week asked again at once (one that
  // answered meanwhile, or is on its way, stays as it is).
  const retry = useCallback((monday) => load(monday, { retry: true }), [load])

  return { events, statusOn, errorKindOn, load, retry }
}

// The courses' accents (eventAccents), in the order they are first seen
// here, kept in this browser so a course keeps its colour.
const ACCENTS_KEY = 'l-ent:planning-accents'

function readAssigned() {
  try {
    const stored = JSON.parse(localStorage.getItem(ACCENTS_KEY) ?? '{}')
    return stored && typeof stored === 'object' ? stored : {}
  } catch {
    return {}
  }
}

export function useEventAccents(events) {
  const [assigned, setAssigned] = useState(readAssigned)

  useEffect(() => {
    let next = assigned
    for (const event of events) next = assignAccent(next, event.title).assigned
    if (next === assigned) return
    setAssigned(next)
    try {
      localStorage.setItem(ACCENTS_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable: the colours last for the visit.
    }
  }, [events, assigned])

  return useCallback((title) => assignAccent(assigned, title).index, [assigned])
}
