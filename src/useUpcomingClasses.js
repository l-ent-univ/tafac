import { useCallback, useEffect, useState } from 'react'
import { publishBriefingSource } from './briefingSources'
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
// `retry()` asks again after a failed load.
export function useUpcomingClasses({ selection, sessionUser, lookaheadDays }) {
  const resourceKey = buildResourceIdsFromSelection(selection).join('|')
  const cacheKey = buildNextClassCacheEntryKey(sessionUser, resourceKey, lookaheadDays)
  const [state, setState] = useState(() => {
    if (!resourceKey) return { status: 'unconfigured', events: [] }
    const cached = readNextClassCache(cacheKey)
    return cached ? { status: 'ok', events: cached.events } : { status: 'loading', events: [] }
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!resourceKey || !cacheKey) {
      setState({ status: 'unconfigured', events: [] })
      return undefined
    }
    const cached = readNextClassCache(cacheKey)
    if (cached) setState({ status: 'ok', events: cached.events })
    if (cached && Date.now() - cached.cachedAt < REFRESH_MS) return undefined

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
  }, [attempt, cacheKey, lookaheadDays, resourceKey, selection])

  const retry = useCallback(() => {
    setState({ status: 'loading', events: [] })
    setAttempt((current) => current + 1)
  }, [])
  return [state, retry]
}
