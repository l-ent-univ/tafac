import { useCallback, useEffect, useRef, useState } from 'react'
import { publishBriefingSource } from './briefingSources'
import { usePageVisit } from './pageVisit'
import { usePullRefresh } from './usePullRefresh'
import {
  buildNextClassCacheEntryKey,
  buildResourceIdsFromSelection,
  fetchUpcomingEvents,
  persistNextClassCache,
  readNextClassCache,
} from './upcomingClasses'

// The shared cache is fresh enough under this age (the « Prochain cours »
// card refreshes every 5 min while shown).
const REFRESH_MS = 10 * 60 * 1000

// Upcoming classes through the « Prochain cours » card's cache (« Accueil »'s
// « Prochains cours », the sidebar's « Prochain cours »): what's there
// when fresh, else one request, written back for the card and the greeting.
// `retry()` asks again after a failed load. Back on a page kept mounted
// (the iOS app, src/pageVisit.js), read again as a mount would: the cache
// while fresh.
export function useUpcomingClasses({ selection, sessionUser, lookaheadDays }) {
  const visit = usePageVisit()
  const resourceKey = buildResourceIdsFromSelection(selection).join('|')
  const cacheKey = buildNextClassCacheEntryKey(sessionUser, resourceKey, lookaheadDays)
  const [state, setState] = useState(() => {
    if (!resourceKey) return { status: 'unconfigured', events: [] }
    const cached = readNextClassCache(cacheKey)
    return cached ? { status: 'ok', events: cached.events } : { status: 'loading', events: [] }
  })
  const [attempt, setAttempt] = useState(0)
  // Pulled down with its page (the iOS app): asked again even while the
  // cache is fresh, what is shown staying meanwhile.
  const forcedRef = useRef(false)
  usePullRefresh(() => {
    forcedRef.current = true
    setAttempt((current) => current + 1)
  })

  useEffect(() => {
    if (!resourceKey || !cacheKey) {
      setState({ status: 'unconfigured', events: [] })
      return undefined
    }
    const cached = readNextClassCache(cacheKey)
    if (cached) setState({ status: 'ok', events: cached.events })
    const forced = forcedRef.current
    forcedRef.current = false
    if (cached && !forced && Date.now() - cached.cachedAt < REFRESH_MS) return undefined

    const controller = new AbortController()
    fetchUpcomingEvents({ selection, lookaheadDays, signal: controller.signal })
      .then((result) => {
        persistNextClassCache(cacheKey, result)
        publishBriefingSource('classes', { cacheKey, loadedAt: Date.now() })
        if (!controller.signal.aborted) setState({ status: 'ok', events: result.events })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((current) => (current.status === 'ok' ? current : { status: 'error', events: [] }))
      })
    return () => controller.abort()
  }, [attempt, cacheKey, lookaheadDays, resourceKey, selection, visit])

  const retry = useCallback(() => {
    setState({ status: 'loading', events: [] })
    setAttempt((current) => current + 1)
  }, [])
  return [state, retry]
}
