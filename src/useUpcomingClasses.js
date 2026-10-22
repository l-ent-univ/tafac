import { useEffect, useState } from 'react'
import {
  NEXT_CLASS_LOOKAHEAD_DAYS,
  buildNextClassCacheEntryKey,
  buildResourceIdsFromSelection,
  fetchUpcomingEvents,
  persistNextClassCache,
  readNextClassCache,
} from './upcomingClasses'

// The student's upcoming ADE classes, from the « Prochain cours » card's
// cache when fresh, else asked once (and cached for the card): the events,
// or null while unknown / unavailable.
export function useUpcomingClasses({ selection, sessionUser, enabled = true }) {
  const cacheKey = buildNextClassCacheEntryKey(sessionUser, buildResourceIdsFromSelection(selection).join('|'), NEXT_CLASS_LOOKAHEAD_DAYS)
  const [events, setEvents] = useState(() => readNextClassCache(cacheKey)?.events ?? null)

  useEffect(() => {
    if (!enabled || !cacheKey) return undefined
    const cached = readNextClassCache(cacheKey)
    if (cached) {
      setEvents(cached.events)
      // Fresh enough for buses: the timetable rarely moves within hours.
      if (Date.now() - cached.cachedAt < 6 * 60 * 60 * 1000) return undefined
    }
    const controller = new AbortController()
    fetchUpcomingEvents({ selection, signal: controller.signal })
      .then((result) => {
        persistNextClassCache(cacheKey, result)
        if (!controller.signal.aborted) setEvents(result.events)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [cacheKey, enabled, selection])

  return events
}
