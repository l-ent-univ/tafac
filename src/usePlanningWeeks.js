import { useCallback, useEffect, useMemo, useState } from 'react'
import { getRequestErrorKind } from './entApi'
import { getOfflineCache, setOfflineCache } from './offlineStorage'
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

export function usePlanningWeeks({ selection, user }) {
  const scope = useMemo(() => `${user ?? ''}::${buildResourceIdsFromSelection(selection).join('|')}`, [selection, user])
  const [version, setVersion] = useState(0)

  const load = useCallback((monday, { force = false, retry = false } = {}) => {
    if (!selection) return
    const key = `${scope}::${monday}`
    const entry = weeks.get(key)
    if (!shouldAskWeek(entry, { force, retry })) return

    weeks.set(key, { ...entry, status: 'loading' })
    setVersion((value) => value + 1)
    fetchUpcomingEvents({ selection, startDate: monday, lookaheadDays: 7 })
      .then(({ events }) => {
        const weekEvents = mergeEvents(events.map(toPlanningEvent))
        weeks.set(key, { status: 'loaded', events: weekEvents })
        void setOfflineCache(`planning-week:${key}`, weekEvents)
      })
      .catch(async (error) => {
        // Offline or ADE down: the week last seen on this device, if any.
        const offline = entry?.events ? null : await getOfflineCache(`planning-week:${key}`).catch(() => null)
        weeks.set(key, entry?.events
          ? { status: 'loaded', events: entry.events }
          : offline?.data
            ? { status: 'loaded', events: offline.data }
            : { status: 'unavailable', failedAt: Date.now(), errorKind: getRequestErrorKind(error) })
      })
      .finally(() => setVersion((value) => value + 1))
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
  // not asked yet), 'unavailable' (it failed), 'unconfigured' (no group).
  const statusOn = useCallback((day) => {
    void version
    if (!selection) return 'unconfigured'
    const entry = weeks.get(`${scope}::${startOfWeek(day)}`)
    if (entry?.events) return 'loaded'
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
