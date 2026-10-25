import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { useWidgetLoadReport } from '../analytics'
import { publishBriefingSource } from '../briefingSources'
import { ENT_AUTH_PREFIX, getRecentEntLoginAgeMs, getRequestErrorKind } from '../entApi'
import { accentStyle } from '../eventAccents'
import { toDayKey } from '../planningDates'
import { useEventAccents } from '../usePlanningWeeks'
import {
  NEXT_CLASS_LOOKAHEAD_DAYS,
  buildNextClassCacheEntryKey,
  buildResourceIdsFromSelection,
  fetchUpcomingEvents,
  persistNextClassCache,
  readNextClassCache,
} from '../upcomingClasses'

const NEXT_CLASS_TICK_MS = 30 * 1000
const NEXT_CLASS_REFRESH_MS = 5 * 60 * 1000
const NEXT_CLASS_LOGIN_QUIET_MS = 90 * 1000
const PLANNING_SERVICE_URL = universityConfig.planning?.serviceUrl ?? null
const ADE_HREF = PLANNING_SERVICE_URL
  ? `${ENT_AUTH_PREFIX}/launch?url=${encodeURIComponent(PLANNING_SERVICE_URL)}`
  : null

function createWidgetState(overrides = {}) {
  return {
    status: 'idle',
    nextClass: null,
    errorMessage: '',
    errorKind: null,
    complete: true,
    ...overrides,
  }
}

function getEventKey(event) {
  return [
    event?.start ?? '',
    event?.end ?? '',
    event?.title ?? '',
    event?.location ?? '',
    event?.teacher ?? '',
  ].join('||')
}

function readCachedNextClass(cacheKey) {
  const cached = readNextClassCache(cacheKey)
  if (!cached) {
    return null
  }

  return {
    ...cached,
    events: cached.events.map(decorateUpcomingEvent).filter(Boolean).sort(compareEvents),
  }
}

function compareEvents(left, right) {
  if ((left?.start ?? '') !== (right?.start ?? '')) {
    return (left?.start ?? '').localeCompare(right?.start ?? '')
  }

  if ((left?.end ?? '') !== (right?.end ?? '')) {
    return (left?.end ?? '').localeCompare(right?.end ?? '')
  }

  return (left?.title ?? '').localeCompare(right?.title ?? '')
}

function findNextClass(events) {
  if (!events?.length) return null

  const now = new Date()

  for (const event of events) {
    if (!event.start) continue
    const start = new Date(event.start)
    if (start > now) return event
  }

  return null
}

function getTimeRemainingLabel(startStr, endStr) {
  const now = new Date()
  const start = new Date(startStr)
  const end = endStr ? new Date(endStr) : null

  if (start <= now && end && end > now) return 'En cours'
  if (end && end <= now) return ''

  const diffMs = start - now
  if (diffMs <= 0) return ''

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const startDay = new Date(start)
  startDay.setHours(0, 0, 0, 0)

  if (startDay.getTime() === tomorrow.getTime()) {
    return 'Demain'
  }

  const diffMins = Math.round(diffMs / 60000)
  if (diffMins < 60) return `Dans ${diffMins} min`

  if (diffMins < 24 * 60) {
    const hours = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    if (mins === 0) return `Dans ${hours}h`
    return `Dans ${hours}h${String(mins).padStart(2, '0')}`
  }

  const diffDays = Math.floor(diffMins / (24 * 60))
  if (diffDays < 7) {
    return `Dans ${diffDays} jour${diffDays > 1 ? 's' : ''}`
  }

  return `Le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(start)}`
}

function capitalizeLabel(value) {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatEventTimeLabel(startStr, endStr) {
  if (!startStr) {
    return ''
  }

  const start = new Date(startStr)
  const end = endStr ? new Date(endStr) : null
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (!end || Number.isNaN(end.getTime())) {
    return formatter.format(start).replace(':', 'h')
  }

  return `${formatter.format(start).replace(':', 'h')} - ${formatter.format(end).replace(':', 'h')}`
}

function formatExactDateLabel(startStr) {
  if (!startStr) {
    return ''
  }

  const start = new Date(startStr)
  const now = new Date()
  const options = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }

  if (start.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric'
  }

  return capitalizeLabel(new Intl.DateTimeFormat('fr-FR', options).format(start))
}

function formatEventDayLabel(startStr) {
  if (!startStr) {
    return ''
  }

  const start = new Date(startStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const targetDay = new Date(start)
  targetDay.setHours(0, 0, 0, 0)

  if (targetDay.getTime() === today.getTime()) {
    return 'Aujourd’hui'
  }

  if (targetDay.getTime() === tomorrow.getTime()) {
    return 'Demain'
  }

  return capitalizeLabel(new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(start))
}

function decorateUpcomingEvent(event) {
  if (!event) {
    return null
  }

  return {
    ...event,
    dayLabel: event.dayLabel || formatEventDayLabel(event.start),
    timeLabel: event.timeLabel || formatEventTimeLabel(event.start, event.end),
  }
}

function simplifyTimeLabel(timeLabel) {
  if (!timeLabel) return ''
  return timeLabel.replace(/(\d{2})h00/g, '$1h')
}

function isElementOverflowing(element) {
  return Boolean(element && element.scrollWidth - element.clientWidth > 1)
}

function getWidgetErrorMessage(error) {
  if (error?.name === 'AbortError') {
    return ''
  }

  const message = error instanceof Error ? error.message : String(error)

  if (!message) {
    return 'Planning indisponible'
  }

  if (message.toLowerCase().includes('connexion')) {
    return 'Connexion requise'
  }

  return 'Planning indisponible'
}

function buildFakeNextClass() {
  const now = new Date()
  const start = new Date(now.getTime() + 20 * 60000)
  const end = new Date(start.getTime() + 60 * 60000)
  const pad = (n) => String(n).padStart(2, '0')

  return {
    title: 'R211 Gestion de contenus CM 1MMI',
    teacher: 'CANU Fabien',
    location: 'B03 - Amphi 2 (008)',
    groups: ['MM1A'],
    dayLabel: 'Aujourd’hui',
    timeLabel: `${pad(start.getHours())}h${pad(start.getMinutes())} - ${pad(end.getHours())}h${pad(end.getMinutes())}`,
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

// `opensInApp`: the card opens the Planning page, not the planning service.
function getStatusCopy(widgetState, lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS, { opensInApp = false } = {}) {
  const action = opensInApp ? 'Voir le planning' : 'Ouvrir l\'emploi du temps'

  switch (widgetState.status) {
    case 'loading':
      return {
        title: 'Chargement',
        body: 'Chargement',
        icon: 'carbon:search',
      }
    case 'unconfigured':
      return {
        title: 'Groupe manquant',
        body: 'Choisis ton groupe TD ou TP dans « Mon compte »',
        icon: 'carbon:user-multiple',
      }
    case 'limited':
      return {
        title: 'Planning partiel',
        body: 'Les données reçues sont incomplètes pour le moment',
        icon: 'carbon:warning-alt',
        action,
      }
    case 'empty':
      return {
        title: 'Aucun cours à venir',
        body: `Rien de prévu dans les ${lookaheadDays} prochains jours`,
        action,
      }
    case 'paused':
      return {
        title: 'Synchroniser le planning',
        body: 'Appuie ici pour mettre à jour le prochain cours',
        icon: 'carbon:calendar-settings',
        action,
      }
    default:
      return {
        title: 'Prochain cours',
        body: '',
        icon: 'carbon:calendar',
      }
  }
}

async function loadUpcomingClasses(options) {
  const data = await fetchUpcomingEvents(options)
  const events = data.events.map(decorateUpcomingEvent).filter(Boolean).sort(compareEvents)

  return {
    complete: data.complete,
    events,
    nextClass: findNextClass(events),
  }
}

// Outcome of the first load (cache or network), for anonymous analytics.
// 'unconfigured' / 'paused' / debug are not loads and are not reported.
function getLoadOutcome(widgetState, debug) {
  if (debug) return null
  if (widgetState.status === 'ready') return { status: 'ok' }
  if (widgetState.status === 'empty' || widgetState.status === 'limited') return { status: 'empty' }
  if (widgetState.status === 'error') return { status: 'error', errorKind: widgetState.errorKind }
  return null
}

// `onOpenPlanning`: the in-app Planning page, passed only while the student
// has it, called with the next class's day ("YYYY-MM-DD", null without one).
// With it the card opens that page on that day; without it, the planning
// service in a new tab.
function WidgetNextClass({
  visible = false,
  debug = false,
  selection = null,
  sessionUser = null,
  autoLoad = true,
  lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS,
  onOpenPlanning = null,
  preview = null,
}) {
  // `preview`: ADE events to show (the landing page, which changes them),
  // like the debug class: nothing loaded, cached or reported, not clickable.
  const isStatic = debug || Boolean(preview)
  const staticNextClass = useMemo(() => (preview
    ? findNextClass(preview.map(decorateUpcomingEvent).filter(Boolean).sort(compareEvents))
    : null), [preview])
  const resourceIds = useMemo(() => buildResourceIdsFromSelection(selection), [selection])
  const resourceKey = resourceIds.join('|')
  const cacheKey = useMemo(
    () => buildNextClassCacheEntryKey(sessionUser, resourceKey, lookaheadDays),
    [resourceKey, sessionUser, lookaheadDays],
  )
  const hasResources = resourceIds.length > 0
  const [widgetState, setWidgetState] = useState(() => (
    isStatic
      ? createWidgetState({ status: 'ready', nextClass: staticNextClass ?? buildFakeNextClass() })
      : createWidgetState({ status: hasResources ? (autoLoad ? 'loading' : 'paused') : 'unconfigured' })
  ))
  const [timeLabel, setTimeLabel] = useState('')
  const [wide, setWide] = useState(false)
  useWidgetLoadReport('nextClass', getLoadOutcome(widgetState, isStatic))
  const visibleRef = useRef(visible)
  const loadedEventsRef = useRef([])
  const loadedCompleteRef = useRef(true)
  const lastRefreshAtRef = useRef(0)
  const quietUntilRef = useRef(0)
  const loadingRef = useRef(false)
  const abortControllerRef = useRef(null)
  const titleRef = useRef(null)
  const locationRef = useRef(null)
  const teacherRef = useRef(null)
  const timeLabelRef = useRef(null)
  const timeRangeRef = useRef(null)
  const groupRef = useRef(null)
  visibleRef.current = visible
  const nextClass = widgetState.nextClass
  const nextClassKey = nextClass ? getEventKey(nextClass) : ''
  const displayTimeRange = simplifyTimeLabel(nextClass?.timeLabel)
  const firstGroup = nextClass?.groups?.[0] || ''

  const measureWideLayout = useCallback(() => {
    const shouldExpand = [
      titleRef.current,
      locationRef.current,
      teacherRef.current,
      timeLabelRef.current,
      timeRangeRef.current,
      groupRef.current,
    ].some(isElementOverflowing)

    if (shouldExpand) {
      setWide(true)
    }
  }, [])

  const syncNextClassFromLoadedEvents = useCallback(() => {
    const nextClass = findNextClass(loadedEventsRef.current)
    setWidgetState((current) => {
      const currentKey = current.nextClass ? getEventKey(current.nextClass) : null
      const nextKey = nextClass ? getEventKey(nextClass) : null

      if (nextClass) {
        if (current.status === 'ready' && currentKey === nextKey) {
          return current
        }

        return createWidgetState({
          status: 'ready',
          nextClass,
          complete: true,
        })
      }

      if (loadedEventsRef.current.length === 0) {
        const nextStatus = loadedCompleteRef.current ? 'empty' : 'limited'
        if (current.status === nextStatus) {
          return current
        }

        return createWidgetState({
          status: nextStatus,
          complete: loadedCompleteRef.current,
        })
      }

      if (loadedCompleteRef.current) {
        if (current.status === 'empty') {
          return current
        }

        return createWidgetState({
          status: 'empty',
          complete: true,
        })
      }

      if (current.status === 'limited') {
        return current
      }

      return createWidgetState({
        status: 'limited',
        complete: false,
      })
    })

    return nextClass
  }, [])

  const loadNextClass = useCallback(async ({ background = false } = {}) => {
    if (isStatic) {
      return
    }

    abortControllerRef.current?.abort()

    if (!hasResources) {
      loadedEventsRef.current = []
      loadedCompleteRef.current = true
      lastRefreshAtRef.current = 0
      loadingRef.current = false
      setWidgetState(createWidgetState({ status: 'unconfigured' }))
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller
    loadingRef.current = true

    if (!background) {
      setWidgetState((current) => (current.nextClass
        ? current
        : createWidgetState({ status: 'loading' })))
    }

    try {
      const result = await loadUpcomingClasses({
        selection,
        signal: controller.signal,
        lookaheadDays,
      })

      if (controller.signal.aborted) {
        return
      }

      loadedEventsRef.current = result.events
      loadedCompleteRef.current = result.complete
      lastRefreshAtRef.current = Date.now()
      persistNextClassCache(cacheKey, result)
      publishBriefingSource('classes', { cacheKey, loadedAt: lastRefreshAtRef.current })

      if (result.nextClass) {
        setWidgetState(createWidgetState({
          status: 'ready',
          nextClass: result.nextClass,
          complete: true,
        }))
        return
      }

      setWidgetState(createWidgetState({
        status: result.complete ? 'empty' : 'limited',
        complete: result.complete,
      }))
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        return
      }

      lastRefreshAtRef.current = Date.now()
      // The briefing keeps whatever the cache still holds.
      publishBriefingSource('classes', { cacheKey, loadedAt: lastRefreshAtRef.current })
      setWidgetState((current) => {
        // A failed background refresh keeps the class already on screen.
        if (background && current.status === 'ready' && current.nextClass) {
          return current
        }

        loadedEventsRef.current = []
        loadedCompleteRef.current = true
        return createWidgetState({
          status: 'error',
          errorMessage: getWidgetErrorMessage(error),
          errorKind: getRequestErrorKind(error),
        })
      })
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }

      loadingRef.current = false
    }
  }, [cacheKey, isStatic, hasResources, selection, lookaheadDays])

  useEffect(() => {
    abortControllerRef.current?.abort()
    loadedEventsRef.current = []
    loadedCompleteRef.current = true
    lastRefreshAtRef.current = 0
    quietUntilRef.current = 0
    loadingRef.current = false

    if (isStatic) {
      setWidgetState(createWidgetState({
        status: 'ready',
        nextClass: staticNextClass ?? buildFakeNextClass(),
      }))

      return undefined
    }

    const cachedResult = readCachedNextClass(cacheKey)

    const cachedNextClass = cachedResult ? findNextClass(cachedResult.events) : null
    const quietRemainingMs = cachedNextClass && autoLoad
      ? Math.max(0, NEXT_CLASS_LOGIN_QUIET_MS - getRecentEntLoginAgeMs())
      : 0
    let quietTimeoutId = 0

    if (cachedResult) {
      loadedEventsRef.current = cachedResult.events
      loadedCompleteRef.current = cachedResult.complete
      lastRefreshAtRef.current = cachedResult.cachedAt

      const nextClass = findNextClass(cachedResult.events)
      if (nextClass) {
        setWidgetState(createWidgetState({
          status: 'ready',
          nextClass,
          complete: true,
        }))
      } else {
        setWidgetState(createWidgetState({
          status: cachedResult.complete ? 'empty' : 'limited',
          complete: cachedResult.complete,
        }))
      }
    } else if (!hasResources) {
      setWidgetState(createWidgetState({ status: 'unconfigured' }))
    } else if (!autoLoad) {
      setWidgetState(createWidgetState({ status: 'paused' }))
    }

    if (quietRemainingMs > 0) {
      quietUntilRef.current = Date.now() + quietRemainingMs
      quietTimeoutId = window.setTimeout(() => {
        quietUntilRef.current = 0
        if (!loadingRef.current) {
          void loadNextClass({ background: true })
        }
      }, quietRemainingMs)
    } else if (autoLoad) {
      void loadNextClass()
    }

    return () => {
      window.clearTimeout(quietTimeoutId)
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      loadingRef.current = false
    }
  }, [autoLoad, cacheKey, isStatic, staticNextClass, hasResources, loadNextClass, resourceKey])

  useEffect(() => {
    function updateWidgetState() {
      const liveNextClass = isStatic
        ? widgetState.nextClass
        : loadedEventsRef.current.length > 0
          ? syncNextClassFromLoadedEvents()
          : widgetState.nextClass

      if (liveNextClass?.start) {
        setTimeLabel(getTimeRemainingLabel(liveNextClass.start, liveNextClass.end))
      } else {
        setTimeLabel('')
      }

      if (
        !isStatic
        && autoLoad
        && hasResources
        && visibleRef.current
        && !loadingRef.current
        && Date.now() >= quietUntilRef.current
      ) {
        const shouldRefresh = Date.now() - lastRefreshAtRef.current >= NEXT_CLASS_REFRESH_MS

        if (shouldRefresh) {
          void loadNextClass({ background: true })
        }
      }
    }

    updateWidgetState()

    const intervalId = window.setInterval(updateWidgetState, NEXT_CLASS_TICK_MS)
    return () => window.clearInterval(intervalId)
  }, [autoLoad, isStatic, hasResources, loadNextClass, syncNextClassFromLoadedEvents, widgetState.nextClass])

  useEffect(() => {
    if (isStatic || !autoLoad || !hasResources) {
      return undefined
    }

    function handleForegroundRefresh() {
      if (document.visibilityState === 'hidden' || loadingRef.current) {
        return
      }

      if (Date.now() < quietUntilRef.current) {
        syncNextClassFromLoadedEvents()
        return
      }

      if (Date.now() - lastRefreshAtRef.current >= NEXT_CLASS_REFRESH_MS) {
        void loadNextClass({ background: true })
        return
      }

      syncNextClassFromLoadedEvents()
    }

    window.addEventListener('focus', handleForegroundRefresh)
    document.addEventListener('visibilitychange', handleForegroundRefresh)

    return () => {
      window.removeEventListener('focus', handleForegroundRefresh)
      document.removeEventListener('visibilitychange', handleForegroundRefresh)
    }
  }, [autoLoad, isStatic, hasResources, loadNextClass, syncNextClassFromLoadedEvents])

  useEffect(() => {
    if (widgetState.status !== 'ready' || !nextClass) {
      setWide(false)
      return
    }

    setWide(false)
  }, [nextClassKey, widgetState.status, nextClass])

  useEffect(() => {
    if (widgetState.status !== 'ready' || !nextClass) {
      return undefined
    }

    let frameId = 0
    const measure = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        measureWideLayout()
      })
    }

    measure()
    window.addEventListener('resize', measure)

    return () => {
      window.removeEventListener('resize', measure)
      window.cancelAnimationFrame(frameId)
    }
  }, [displayTimeRange, firstGroup, measureWideLayout, nextClass, nextClassKey, timeLabel, widgetState.status])

  // The course's colour as the planning gives it (the same one on its
  // page: eventAccents, handed out in the order the courses are seen).
  const accentEvents = useMemo(() => (nextClass?.title ? [{ title: nextClass.title }] : []), [nextClass?.title])
  const accentFor = useEventAccents(accentEvents)
  const showsClass = widgetState.status === 'ready' && Boolean(nextClass)
  const exactDateLabel = formatExactDateLabel(nextClass?.start)
  const shouldShowExactDateTooltip = Boolean(exactDateLabel && timeLabel && timeLabel !== 'En cours')
  const opensInApp = Boolean(onOpenPlanning)
  const statusCopy = getStatusCopy(widgetState, lookaheadDays, { opensInApp })
  // Also takes the full row on phones, where a class shares it with the grade.
  // There the card is a size container: at half width the title gets two
  // lines, teacher and group go (@max-[240px]) and the time range wraps.
  const isStatusWide = ['unconfigured', 'limited', 'empty', 'paused'].includes(widgetState.status)
  const nextClassDay = widgetState.status === 'ready' && nextClass?.start ? toDayKey(nextClass.start) : null
  const openPlanning = useCallback(() => {
    if (onOpenPlanning) {
      onOpenPlanning(nextClassDay)
      return
    }

    if (!ADE_HREF) {
      return
    }

    window.open(ADE_HREF, '_blank', 'noopener,noreferrer')
  }, [nextClassDay, onOpenPlanning])
  const handleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    openPlanning()
  }, [openPlanning])

  // Hidden when the planning can't be loaded; the background refresh brings
  // the card back once ADE answers again.
  if (widgetState.status === 'error') {
    return null
  }

  return (
    <article
      className={`next-class-widget widget-card relative z-0 hover:z-10 shadow-md flex-[0_1_190px] h-[140px] p-4 border border-white card-corners overflow-visible text-base leading-6 min-w-0 max-2xl:flex-[1_1_calc(50%-6px)] max-2xl:min-w-[min(320px,100%)] max-md:h-[132px] max-md:p-3 max-xs:h-[140px] max-xs:min-w-0 max-xs:@container flex flex-col gap-[6px] text-text ${preview ? '' : 'cursor-pointer'} ${isStatusWide ? 'max-xs:flex-[1_1_100%]' : 'max-xs:flex-[1_1_calc(50%-4px)]'} ${wide ? '2xl:flex-[0_1_380px]' : isStatusWide ? '2xl:flex-[0_1_300px]' : ''} ${visible ? 'widget-card-visible' : ''}`}
      style={showsClass ? accentStyle(accentFor(nextClass.title)) : undefined}
      aria-label={opensInApp ? 'Prochain cours, voir le planning' : 'Prochain cours ouvrir ADE'}
      onClick={preview ? undefined : openPlanning}
      onKeyDown={preview ? undefined : handleKeyDown}
      role={preview ? undefined : opensInApp ? 'button' : 'link'}
      tabIndex={preview ? undefined : 0}
    >
      {/* The course's wash, as the planning's blocks wear it, in a layer of
          its own clipped to the card's corners (the card lets its date
          tooltip hang out). */}
      {showsClass ? (
        <span className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]" aria-hidden="true">
          <span className="latest-grade-wash planning-accent-fill" />
        </span>
      ) : null}
      {/* The "opens another site" arrow: none when the card opens the
          Planning page, as on "Dernière note". */}
      {opensInApp || preview ? null : <Icon icon="carbon:arrow-up-right" className="grade-corner-arrow absolute top-3 right-3 w-[14px] h-[14px] text-text opacity-0 transition-opacity duration-150 ease-in-out shrink-0" aria-hidden="true" />}
      <div className="flex items-center gap-[5px] min-w-0">
        <span className="m-0 min-w-0 leading-[1.06] text-base font-medium text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[15px]">Prochain cours</span>
      </div>

      <div className="flex-1 flex flex-col justify-between min-h-0">
        {showsClass ? (
          <>
            <div className="flex items-center gap-2 flex-1 min-h-0 my-1.5 max-xs:my-1">
              <div className="flex self-stretch items-center">
                <div className="planning-accent-fill w-[6px] h-full corners-[25px] shrink-0" aria-hidden="true" />
              </div>
              <div className="flex flex-col justify-center gap-[3px] min-w-0 flex-1">
                <span ref={titleRef} className="block m-0 min-w-0 leading-[1.06] text-[15px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[14px] max-xs:whitespace-normal max-xs:line-clamp-2" title={nextClass.title}>{nextClass.title}</span>
                <div className="flex flex-col gap-[2px] min-w-0">
                  {nextClass.location ? (
                    <span className="flex items-center gap-[3px] min-w-0 text-text-muted">
                      <Icon icon="ph:map-pin-simple" className="w-[14px] h-[14px] shrink-0" aria-hidden="true" />
                      <span ref={locationRef} className="block min-w-0 leading-[1.06] text-[13px] overflow-hidden text-ellipsis whitespace-nowrap" title={nextClass.location}>{nextClass.location}</span>
                    </span>
                  ) : null}
                  {nextClass.teacher ? (
                    <span className="flex items-center gap-[3px] min-w-0 text-text-muted max-xs:@max-[240px]:hidden">
                      <Icon icon="ph:user-square" className="w-[14px] h-[14px] shrink-0" aria-hidden="true" />
                      <span ref={teacherRef} className="block min-w-0 leading-[1.06] text-[13px] overflow-hidden text-ellipsis whitespace-nowrap" title={nextClass.teacher}>{nextClass.teacher}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 min-w-0">
              <div className="flex flex-col gap-[2px] min-w-0">
                <div className="flex items-center gap-[7px] min-w-0 max-xs:flex-wrap max-xs:gap-y-[3px]">
                  <span
                    className={`relative inline-flex min-w-0 items-center gap-[5px] ${shouldShowExactDateTooltip ? 'group/next-class cursor-help' : ''}`}
                    title={shouldShowExactDateTooltip ? exactDateLabel : undefined}
                  >
                    <Icon icon="carbon:time" className="w-[15px] h-[15px] shrink-0" aria-hidden="true" />
                    <span ref={timeLabelRef} className="block min-w-0 leading-[1.06] text-[15px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[14px]">{timeLabel}</span>
                    {shouldShowExactDateTooltip ? (
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 inline-flex -translate-x-1/2 translate-y-1 scale-95 whitespace-nowrap rounded-full border border-white/70 bg-[rgba(17,24,39,0.92)] px-3 py-1.5 text-[12px] font-medium leading-none text-white opacity-0 shadow-[0_12px_32px_rgba(17,24,39,0.18)] transition-[opacity,transform] duration-180 ease-out invisible group-hover/next-class:visible group-hover/next-class:translate-y-0 group-hover/next-class:scale-100 group-hover/next-class:opacity-100">
                        {exactDateLabel}
                      </span>
                    ) : null}
                  </span>
                  {displayTimeRange ? (
                    <span ref={timeRangeRef} className="block min-w-0 leading-[1.06] text-[15px] font-semibold tabular-nums overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[14px]">{displayTimeRange}</span>
                  ) : null}
                </div>
              </div>
              {firstGroup ? (
                <span ref={groupRef} className="block leading-[1.06] text-[12px] font-semibold text-text-muted shrink-0 max-w-[38%] overflow-hidden text-ellipsis whitespace-nowrap text-right max-xs:@max-[240px]:hidden" title={firstGroup}>{firstGroup}</span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col justify-center gap-1 py-1 min-w-0">
            <div className="flex items-center gap-[7px] min-w-0">
              {statusCopy.icon ? (
                <Icon icon={statusCopy.icon} className="w-[18px] h-[18px] shrink-0 opacity-70" aria-hidden="true" />
              ) : null}
              <span className="m-0 min-w-0 leading-[1.1] text-base font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[15px]" title={statusCopy.title}>{statusCopy.title}</span>
            </div>
            {statusCopy.body ? (
              <p className="m-0 text-sm leading-[1.35] opacity-70 line-clamp-2" title={statusCopy.body}>{statusCopy.body}</p>
            ) : null}
            {statusCopy.action ? (
              <span className="inline-flex items-center gap-1 text-[13px] font-semibold opacity-80">
                {statusCopy.action}
                <Icon icon={opensInApp ? 'carbon:arrow-right' : 'carbon:arrow-up-right'} className="w-[13px] h-[13px] shrink-0" aria-hidden="true" />
              </span>
            ) : null}
          </div>
        )}
      </div>
    </article>
  )
}

export default WidgetNextClass
