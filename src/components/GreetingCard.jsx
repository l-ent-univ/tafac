import { useEffect, useState, useSyncExternalStore } from 'react'
import { Icon } from '@iconify/react'
import { getBriefingSources, publishBriefingSource, subscribeBriefingSources } from '../briefingSources'
import { buildDailyBriefing } from '../dailyBriefing'
import { fetchUpcomingEvents, persistNextClassCache, readNextClassCache } from '../upcomingClasses'
import LoadingDots from './LoadingDots'

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
// then the sentence, or null when there is nothing to say.
function useDailyBriefing({
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

// `headingAs`: the greeting's tag ('p' where the card is only a demo, as on
// the landing page).
function GreetingCard({
  displayName,
  greeting,
  visible = false,
  onDismiss,
  classesSource = null,
  classesCacheKey = '',
  selection = null,
  lookaheadDays,
  expectDeadlines = false,
  headingAs = 'h2',
}) {
  const Heading = headingAs
  const briefing = useDailyBriefing({
    classesSource,
    classesCacheKey,
    selection,
    lookaheadDays,
    expectDeadlines,
  })
  const subtitle = greeting ?? briefing.text
  const isLoading = greeting == null && briefing.loading

  return (
    // On phones the card shrinks to what it says: the wave sits beside the
    // heading instead of above it, and the card loses its minimum height.
    <article className={`widget-card group relative shadow-md flex-[0_1_280px] min-h-[140px] p-4 border border-white rounded-[22px] overflow-hidden bg-widget-bg text-base leading-6 min-w-0 max-2xl:flex-[1_1_calc(50%-6px)] max-2xl:min-w-[min(280px,100%)] max-md:min-h-[124px] max-md:p-3 max-md:rounded-[20px] max-xs:flex-[1_1_100%] max-xs:min-w-0 max-xs:min-h-0 flex flex-col justify-end gap-1 text-text ${visible ? 'widget-card-visible' : ''}`}>
      <div className="contents max-xs:flex max-xs:items-center max-xs:gap-2 max-xs:min-w-0 max-xs:pr-8">
        <Icon icon="ph:hand-waving" className="greeting-icon w-[34px] h-[34px] text-inherit shrink-0 max-xs:w-[26px] max-xs:h-[26px]" aria-hidden="true" />
        <Heading className="m-0 min-w-0 leading-[1.15] text-2xl font-bold overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[22px] max-xs:text-xl" title={`Salut ${displayName} !`}>Salut {displayName} !</Heading>
      </div>
      {isLoading ? (
        <LoadingDots label="Chargement du résumé de ta journée" className="h-[18px] text-text-muted" />
      ) : subtitle ? (
        <p className="m-0 leading-[1.2] text-[15px] font-medium line-clamp-2" title={subtitle}>{subtitle}</p>
      ) : null}
      {typeof onDismiss === 'function' ? (
        // 44px hit area on touch screens, same 16px cross.
        <button
          type="button"
          className="absolute top-2.5 right-2.5 inline-flex items-center justify-center w-7 h-7 p-0 border-0 rounded-full bg-transparent text-text-muted opacity-0 cursor-pointer transition-[opacity,background-color,color] duration-[120ms] ease-in-out hover:bg-brand-subtle hover:text-text group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 max-md:top-0.5 max-md:right-0.5 max-md:w-11 max-md:h-11"
          onClick={onDismiss}
          aria-label="Masquer la carte de bienvenue"
          title="Masquer (réactivable dans Mon compte)"
        >
          <Icon icon="carbon:close" className="w-4 h-4" aria-hidden="true" />
        </button>
      ) : null}
    </article>
  )
}

export default GreetingCard
