import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { Skeleton } from 'skullet/react'
import { publishBriefingSource } from '../briefingSources'
import { FORCE_SKELETONS, SAMPLE_CLASSES } from '../homeSkeletonSamples'
import { formatHour, pickNextClassesDay } from '../nextClassesDay'
import {
  NEXT_CLASS_LOOKAHEAD_DAYS,
  buildNextClassCacheEntryKey,
  buildResourceIdsFromSelection,
  fetchUpcomingEvents,
  persistNextClassCache,
  readNextClassCache,
} from '../upcomingClasses'
import { useEventAccents } from '../usePlanningWeeks'
import calendarIcon from '../assets/home-icons/calendar.png'
import PlanningEventBlock from './PlanningEventBlock'
import WidgetListStatus from './WidgetListStatus'

// The list follows the clock (a class over leaves it).
const TICK_MS = 60 * 1000
// The shared cache is fresh enough under this age (the « Prochain cours »
// card refreshes every 5 min while shown).
const REFRESH_MS = 10 * 60 * 1000
const NO_CLASSES = []
// Each class as the Planning draws it (PlanningEventBlock): a compact block
// of this height, room over teacher, beside its hours.
const BLOCK_HEIGHT = 76
const TIME_COLUMN = 52
const TIME_GAP = 12
const ROW_GAP = 8
// Filling a cell (`fill`), the blocks grow up to this height to take the
// room left under the last class that fits whole: no blank band above
// « Afficher plus ». A taller block gives its title a second line.
const BLOCK_MAX_HEIGHT = 104
// Sized to its classes (not `fill`): this many at most.
const MAX_CLASSES = 3
// Filling a cell: as many as fit, of this many at most.
const MAX_FILL_CLASSES = 8

// Room under the last class shown for its shadow (over the gap above
// « Afficher plus »), and over the first.
const SHADOW_ROOM = 8
const LIST_PADDING_TOP = 4

// An element's content box, for the blocks' layout (they're sized in
// pixels): its width, and its height when the card fills its cell.
function useElementSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const update = (width, height) => setSize((current) => (
      current.width === width && current.height === height ? current : { width, height }
    ))
    update(element.clientWidth, element.clientHeight)
    const observer = new ResizeObserver(([entry]) => update(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])
  return now
}

// Upcoming classes through the « Prochain cours » card's cache: what's there
// when fresh, else one request, written back for the card and the greeting.
// `retry()` asks again after a failed load.
function useUpcomingClasses({ selection, sessionUser, lookaheadDays }) {
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

// « Prochains cours »: a white card with the classes of the next day that
// has some (pickNextClassesDay), each drawn as the Planning's block beside
// its hours, then « Afficher plus ». Clicking a class opens that day in
// the Planning when the app has it, the link that day (or today).
// `fill`: the card takes its cell's height (set by the cards beside it)
// and shows the classes that fit; otherwise it's as tall as its first
// MAX_CLASSES classes.
function WidgetNextClasses({
  selection = null,
  sessionUser = null,
  lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS,
  onOpenPlanningDay = null,
  fill = false,
}) {
  const now = useNow()
  const [classes, retry] = useUpcomingClasses({ selection, sessionUser, lookaheadDays })
  const day = useMemo(() => (classes.status === 'ok' ? pickNextClassesDay(classes.events, now) : null), [classes, now])
  const loading = classes.status === 'loading'
  const dayClasses = day?.classes ?? NO_CLASSES
  const accentFor = useEventAccents(dayClasses)
  const [boxRef, box] = useElementSize()
  const blockWidth = Math.max(0, box.width - TIME_COLUMN - TIME_GAP)

  // Of `count` classes, how many show and their blocks' height. Filling the
  // cell: those that fit whole, then grown to share what's left.
  const fitClasses = (count) => {
    if (!fill) return { shownCount: Math.min(count, MAX_CLASSES), blockHeight: BLOCK_HEIGHT }
    const room = box.height
    const fitting = Math.max(1, Math.floor((room + ROW_GAP) / (BLOCK_HEIGHT + ROW_GAP)))
    const shownCount = Math.min(count, fitting, MAX_FILL_CLASSES)
    if (shownCount === 0) return { shownCount, blockHeight: BLOCK_HEIGHT }
    const share = Math.floor((room - (shownCount - 1) * ROW_GAP) / shownCount)
    return { shownCount, blockHeight: Math.min(BLOCK_MAX_HEIGHT, Math.max(BLOCK_HEIGHT, share)) }
  }
  const hiddenCount = dayClasses.length - fitClasses(dayClasses.length).shownCount

  let body
  if (classes.status === 'error') {
    // The dashboard's « Prochain cours » hides; here the card keeps its
    // place in the grid, with « Réessayer ».
    body = (
      <WidgetListStatus
        icon="ph:warning"
        title="Planning indisponible"
        body="Impossible de charger tes cours"
        action={{ label: 'Réessayer', onClick: retry }}
      />
    )
  } else if (classes.status === 'unconfigured') {
    body = <WidgetListStatus icon="ph:users" title="Groupe manquant" body="Choisis ton groupe TD ou TP dans « Mon compte »" />
  } else if (!loading && !day) {
    body = <WidgetListStatus icon="ph:calendar-blank" title="Aucun cours à venir" body={`Rien de prévu dans les ${lookaheadDays} prochains jours`} />
  } else {
    const openDay = onOpenPlanningDay && day ? () => onOpenPlanningDay(day.dayKey) : undefined
    const renderClasses = (items) => {
      const { shownCount, blockHeight } = fitClasses(items.length)
      return (
        <ol className="m-0 grid list-none p-0" style={{ gap: ROW_GAP }}>
          {items.slice(0, shownCount).map((item) => (
            <li key={item.key} className="flex items-center" style={{ gap: TIME_GAP }}>
              <span className="shrink-0 text-center font-body tabular-nums" style={{ width: TIME_COLUMN }}>
                <span className="block text-[15px] font-semibold leading-[1.25]">{formatHour(item.start)}</span>
                <span className="block text-[12px] font-medium leading-[1.3] text-text-muted">{formatHour(item.end)}</span>
                {item.isNow ? <span className="mt-1 block text-[12px] font-semibold leading-[1.3] text-brand">En cours</span> : null}
              </span>
              {blockWidth > 0 ? (
                // Coloured, drawn whole in the skeleton (skullet-block).
                <span skullet-block="" className="flex flex-none rounded-[12px]">
                  <PlanningEventBlock
                    event={{ ...item, id: item.key }}
                    accent={accentFor(item.title)}
                    variant="compact"
                    stackFirst
                    width={blockWidth}
                    height={blockHeight}
                    style={{ position: 'relative', flex: 'none' }}
                    onOpen={openDay}
                  />
                </span>
              ) : (
                <span className="flex-1" style={{ height: blockHeight }} aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      )
    }
    // Loading: a skeleton (skullet) of the last classes shown (`id`, kept
    // across visits), of sample classes before there were any.
    body = (
      <Skeleton loading={FORCE_SKELETONS || undefined} data={loading ? null : dayClasses} sample={SAMPLE_CLASSES} id="home-next-classes" label="Chargement des cours">
        {renderClasses}
      </Skeleton>
    )
  }

  return (
    <article
      className="next-classes-widget widget-card widget-card-visible flex min-h-0 min-w-0 flex-[0_1_420px] flex-col gap-2 border border-white bg-widget-bg p-4 text-text shadow-md card-corners max-md:flex-[1_1_100%] max-md:p-3"
      aria-label="Prochains cours"
    >
      <div className="flex min-w-0 items-center gap-2">
        <img src={calendarIcon} alt="" width="22" height="22" draggable="false" className="size-[22px] shrink-0 select-none" aria-hidden="true" />
        <h2 className="m-0 min-w-0 truncate font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[15px]">Prochains cours</h2>
        {day ? <span className="ml-auto shrink-0 font-body text-[13px] font-semibold text-text-secondary">{day.label}</span> : null}
      </div>
      {/* The classes shown, the rest is the Planning's, behind « Afficher
          plus » at the bottom. The padding (cancelled by negative margins)
          leaves the blocks' shadows room up to the card's edges. The
          statuses (none, failed) centre in the room left. */}
      <div className="-mx-4 -mt-1 flex min-h-0 flex-1 flex-col overflow-hidden px-4 max-md:-mx-3 max-md:px-3" style={{ paddingTop: LIST_PADDING_TOP, paddingBottom: SHADOW_ROOM, marginBottom: -SHADOW_ROOM }}>
        <div ref={boxRef} className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
      </div>
      {onOpenPlanningDay ? (
        <button
          type="button"
          onClick={() => onOpenPlanningDay(day?.dayKey ?? null)}
          className="relative inline-flex shrink-0 cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 font-body text-base font-medium leading-[1.06] text-text-muted underline-offset-2 transition-colors duration-150 hover:text-text hover:underline max-md:text-[15px]"
        >
          Afficher plus
          {/* The classes of the day left out of the card. */}
          {hiddenCount > 0 ? <span className="tabular-nums">· {hiddenCount} cours</span> : null}
          <Icon icon="ph:arrow-up-right" className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </article>
  )
}

export default WidgetNextClasses
