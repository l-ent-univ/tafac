import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { accentStyle } from '../eventAccents'
import { formatHour, pickNextClassesDay } from '../nextClassesDay'
import { NEXT_CLASS_LOOKAHEAD_DAYS } from '../upcomingClasses'
import { useEventAccents } from '../usePlanningWeeks'
import { useUpcomingClasses } from '../useUpcomingClasses'
import { useContextMenu } from '../useContextMenu'
import { setSidebarNextClassShown } from '../sidebarNextClassPref'

// The free height it needs above it, past its own: it shows only when the
// sidebar has this much room between the nav and the bottom block.
const BREATHING_ROOM = 56
// The block's height (heading and card) before it's first measured.
const ESTIMATED_HEIGHT = 100
// The time left follows the clock.
const TICK_MS = 30 * 1000

// How soon, short: « Maintenant » under way, « dans 25 min », « dans 2h »
// later today, « demain », then the date (« 16/11 »).
function formatSoon(next, now) {
  if (next.start <= now) return 'Maintenant'
  const minutes = Math.round((next.start - now) / 60000)
  const sameDay = next.start.toDateString() === now.toDateString()
  if (minutes < 60) return `dans ${Math.max(1, minutes)} min`
  if (sameDay) return `dans ${Math.round(minutes / 60)}h`
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (next.start.toDateString() === tomorrow.toDateString()) return 'demain'
  return `${String(next.start.getDate()).padStart(2, '0')}/${String(next.start.getMonth() + 1).padStart(2, '0')}`
}

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])
  return now
}
// The bottom block's gap (gap-3) it adds when it shows.
const STACK_GAP = 12

// The room left in the sidebar (`panel`) between its top block (logo and
// nav, its first child) and its bottom block (`stack`, the card's parent),
// leaving out the card's own height (`own`) when it shows.
function measureFreeRoom(panel, stack, own) {
  const top = panel.firstElementChild
  if (!top || top === stack) return 0
  const style = getComputedStyle(panel)
  const inner = panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  return inner - top.offsetHeight - (stack.offsetHeight - own)
}

// « Prochain cours » in the sidebar, where « Favoris » was: the next class,
// small (the course's colour bar, its title, its hours and room), opening
// its day in the Planning. Not on « Accueil » (its « Prochains cours » card
// is there), and only when the sidebar is tall enough for it with room to
// spare above, so it never crowds the nav. Same classes as that card
// (useUpcomingClasses: its cache, its request).
function SidebarNextClass({ selection, sessionUser, onOpenPlanningDay }) {
  const [classes] = useUpcomingClasses({ selection, sessionUser, lookaheadDays: NEXT_CLASS_LOOKAHEAD_DAYS })
  const now = useNow()
  const day = useMemo(() => (classes.status === 'ok' ? pickNextClassesDay(classes.events, now) : null), [classes, now])
  const next = day?.classes[0] ?? null
  const accentFor = useEventAccents(day?.classes ?? [])
  const slotRef = useRef(null)
  const heightRef = useRef(ESTIMATED_HEIGHT)
  const [fits, setFits] = useState(false)
  // Right click (a long press on a touch screen): hide it, as Réglages can.
  const menuProps = useContextMenu(() => [
    { id: 'hide', label: 'Masquer de la barre latérale', icon: 'ph:eye-slash', onSelect: () => setSidebarNextClassShown(false) },
  ])

  useLayoutEffect(() => {
    const slot = slotRef.current
    const stack = slot?.parentElement
    const panel = slot?.closest('aside')
    if (!slot || !stack || !panel) return undefined
    const check = () => {
      const card = slot.firstElementChild
      if (card) heightRef.current = card.offsetHeight
      const own = card ? card.offsetHeight + STACK_GAP : 0
      setFits(measureFreeRoom(panel, stack, own) >= heightRef.current + STACK_GAP + BREATHING_ROOM)
    }
    const observer = new ResizeObserver(check)
    observer.observe(panel)
    observer.observe(stack)
    if (panel.firstElementChild) observer.observe(panel.firstElementChild)
    check()
    return () => observer.disconnect()
  }, [next])

  const shown = Boolean(next) && fits
  const whenLabel = next ? formatSoon(next, now) : ''
  const meta = next ? [`${formatHour(next.start)} – ${formatHour(next.end)}`, next.location].filter(Boolean).join(' · ') : ''

  return (
    <div ref={slotRef} className="w-full empty:hidden">
      {shown ? (
        <div className="sidebar-next-class-in grid w-full gap-2" {...menuProps()}>
          {/* A discreet label above, how soon on its right. */}
          <div className="flex min-w-0 items-baseline justify-between gap-2 px-1 font-body text-[12px] font-medium leading-none">
            <span className="text-text-muted">Prochain cours</span>
            <span className={`truncate ${next.isNow ? 'font-semibold text-brand' : 'text-text-muted'}`}>{whenLabel}</span>
          </div>
          <button
            type="button"
            onClick={onOpenPlanningDay ? () => onOpenPlanningDay(day.dayKey) : undefined}
            disabled={!onOpenPlanningDay}
            style={accentStyle(accentFor(next.title))}
            className="sidebar-next-class glass-solid relative isolate flex w-full min-w-0 items-stretch gap-2.5 overflow-hidden corners-[16px] p-3 text-left cursor-pointer disabled:cursor-default"
            aria-label={`Prochain cours, ${whenLabel.toLowerCase()} : ${next.title}, ${meta}`}
          >
            {/* The course's colour washing its top, as the events'. */}
            <span className="latest-grade-wash planning-accent-fill" aria-hidden="true" />
            <span className="sidebar-next-class-bar planning-accent-fill w-[3px] shrink-0 rounded-full" aria-hidden="true" />
            <span className="grid min-w-0 gap-[3px]">
              <span className="truncate font-body text-[14px] font-semibold leading-[1.2] text-text">{next.title}</span>
              <span className="truncate font-body text-[12.5px] font-medium leading-[1.2] text-text-muted">{meta}</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default SidebarNextClass
