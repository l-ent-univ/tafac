import { useEffect, useState, useSyncExternalStore } from 'react'
import { getBriefingSources, publishBriefingSource, subscribeBriefingSources } from './briefingSources'
import { buildDailyBriefing } from './dailyBriefing'
import { fetchUpcomingEvents, persistNextClassCache, readNextClassCache } from './upcomingClasses'

// The briefing follows the clock ("Encore 2 cours" becomes "Dernier cours").
const BRIEFING_TICK_MS = 60 * 1000
// Longest wait for a slow source before the briefing shows what it has.
const BRIEFING_MAX_WAIT_MS = 4000
// With the "Prochain cours" card hidden, the briefing loads classes itself,
// at most this often (the card refreshes every 5 min while shown).
const SELF_LOAD_REFRESH_MS = 30 * 60 * 1000

function readClassesEntry(cacheKey) {
  return { cacheKey, entry: readNextClassCache(cacheKey) }
}

// The greeting's "briefing du jour". Reuses what is already on the device:
// classes from the next-class cache, deadlines from the "Échéances" card.
// Loading until every expected source answered (or BRIEFING_MAX_WAIT_MS),
// then the sentence, or null when there is nothing to say. Also the
// « Accueil » page's inline greeting (HomeDraftPage).
export default function useDailyBriefing({
  classesSource,
  classesCacheKey,
  selection,
  lookaheadDays,
  expectDeadlines,
}) {
  // Same on the server (the landing page's build-time render).
  const sources = useSyncExternalStore(subscribeBriefingSources, getBriefingSources, getBriefingSources)
  const [now, setNow] = useState(() => new Date())
  const [classesCache, setClassesCache] = useState(() => readClassesEntry(classesCacheKey))
  const [isRevealed, setIsRevealed] = useState(false)
  const classesLoad = classesCacheKey && sources.classes?.cacheKey === classesCacheKey ? sources.classes : null

  // Re-read the shared cache after each load of the card (or our own).
  useEffect(() => {
    setClassesCache(readClassesEntry(classesCacheKey))
  }, [classesCacheKey, classesLoad])

  // Card hidden by the student: nobody else asks ADE, so the briefing does,
  // through the same cache entry the card would use.
  useEffect(() => {
    if (classesSource !== 'self' || !classesCacheKey) {
      return undefined
    }

    const cached = readNextClassCache(classesCacheKey)
    if (cached && Date.now() - cached.cachedAt < SELF_LOAD_REFRESH_MS) {
      return undefined
    }

    const controller = new AbortController()
    fetchUpcomingEvents({ selection, lookaheadDays, signal: controller.signal })
      .then((result) => persistNextClassCache(classesCacheKey, result))
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) {
          publishBriefingSource('classes', { cacheKey: classesCacheKey, loadedAt: Date.now() })
        }
      })

    return () => controller.abort()
  }, [classesCacheKey, classesSource, lookaheadDays, selection])

  useEffect(() => {
    function refreshClock() {
      if (document.visibilityState === 'visible') {
        setNow(new Date())
      }
    }

    const intervalId = window.setInterval(refreshClock, BRIEFING_TICK_MS)
    document.addEventListener('visibilitychange', refreshClock)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshClock)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setIsRevealed(true), BRIEFING_MAX_WAIT_MS)
    return () => window.clearTimeout(timeoutId)
  }, [])

  const classes = classesSource && classesCache.cacheKey === classesCacheKey ? classesCache.entry : null
  const deadlines = sources.deadlines
  const isClassesSettled = !classesSource || !classesCacheKey || Boolean(classes) || Boolean(classesLoad)
  const isDeadlinesSettled = !expectDeadlines || Boolean(deadlines && deadlines.status !== 'loading')
  const isSettled = isClassesSettled && isDeadlinesSettled

  useEffect(() => {
    if (isSettled) {
      setIsRevealed(true)
    }
  }, [isSettled])

  if (!isRevealed && !isSettled) {
    return { loading: true, text: null }
  }

  return {
    loading: false,
    text: buildDailyBriefing({
      classes,
      deadlines: expectDeadlines && deadlines?.status === 'ok' ? deadlines.items : null,
      now,
    }),
  }
}
