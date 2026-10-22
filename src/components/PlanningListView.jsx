import { useEffect, useRef } from 'react'
import { Icon } from '@iconify/react'
import { accentStyle } from '../eventAccents'
import { SIGNAL_STYLES } from '../mailSignalStyles'
import { agendaDayText, durationText, formatTime, weekRangeText } from '../planningDates'
import { isOngoing, listWeekDays } from '../planningEvents'
import PlanningNote from './PlanningNote'

// The phone's tab bar over the page's bottom (and its margin).
const TAB_BAR_ROOM = 100

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// "En cours", in the brand colour as the grid's "Maint." mark.
function OngoingBadge({ className = '' }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center rounded-full bg-brand px-2 font-body text-[12px] font-semibold leading-none text-bg ${className}`}>
      En cours
    </span>
  )
}

function MetaLabel({ icon, text }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Icon icon={icon} className="size-[15px] shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  )
}

// A class in the list, drawn as the grid's blocks (a widget card under the
// course's wash, its accent bar): its hours and length, its title, then its
// room, teacher and group. On a wide screen the hours stand in a column of
// their own, as an agenda's. A button opening the class's sheet.
function PlanningListCard({ event, accent, ongoing, onOpen }) {
  const hours = `${formatTime(event.start)} – ${formatTime(event.end)}`
  const duration = durationText(event.start, event.end)
  const meta = [
    event.location ? { icon: 'ph:map-pin-simple', text: event.location } : null,
    event.teacher ? { icon: 'ph:user-square', text: event.teacher } : null,
    event.group ? { icon: 'ph:users-three', text: event.group } : null,
  ].filter(Boolean)
  return (
    <button
      type="button"
      className="planning-list-card widget-card widget-card-visible isolate relative flex w-full min-w-0 items-stretch gap-3 overflow-hidden rounded-[20px] border bg-widget-bg p-[13px] text-left text-text cursor-pointer 4xl:gap-4 4xl:px-4"
      style={accentStyle(accent)}
      onClick={() => onOpen(event)}
      aria-label={`${formatTime(event.start)} à ${formatTime(event.end)}, ${event.title}${meta.map((part) => `, ${part.text}`).join('')}, ${duration}${ongoing ? ', en cours' : ''}${event.notice ? `, ${event.notice.label}` : ''}`}
    >
      <span className="latest-grade-wash planning-accent-fill" aria-hidden="true" />
      <span className="planning-list-bar planning-accent-fill" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col gap-1 4xl:flex-row 4xl:items-center 4xl:gap-5">
        <span className="flex min-w-0 items-center gap-1.5 font-body leading-[1.2] 4xl:w-[118px] 4xl:shrink-0 4xl:flex-col 4xl:items-start 4xl:gap-1">
          <span className="text-[13.5px] font-semibold tabular-nums text-text-secondary 4xl:text-[15px] 4xl:text-text">{hours}</span>
          <span className="text-[13px] font-medium text-text-muted 4xl:text-[13.5px]">
            <span className="4xl:hidden" aria-hidden="true">· </span>
            {duration}
          </span>
          {ongoing ? <OngoingBadge className="ml-auto 4xl:hidden" /> : null}
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="line-clamp-2 font-body text-[16px] font-semibold leading-[1.25] text-text [overflow-wrap:anywhere]">{event.title}</span>
          {meta.length ? (
            <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-body text-[13.5px] font-medium leading-[1.35] text-text-muted">
              {meta.map((part) => <MetaLabel key={part.icon} icon={part.icon} text={part.text} />)}
            </span>
          ) : null}
          {event.notice ? (
            <span className={`inline-flex min-w-0 max-w-full items-center gap-1 justify-self-start rounded-full px-2 py-1 font-body text-[12.5px] font-semibold leading-none ${SIGNAL_STYLES[event.notice.kind].tint}`} aria-hidden="true">
              <Icon icon={SIGNAL_STYLES[event.notice.kind].icon} className="size-3.5 shrink-0" />
              <span className="truncate">{event.notice.label}</span>
            </span>
          ) : null}
        </span>
        {ongoing ? <OngoingBadge className="max-4xl:hidden" /> : null}
      </span>
    </button>
  )
}

// A day's heading, titled as the sections of Mes notes ("Aujourd’hui ·
// dimanche 18 octobre", "Mardi 20 octobre"), its number of classes at the
// end. On a wide screen it stands in a column left of its classes.
function DayHeading({ day, todayKey, count }) {
  const { title, detail } = agendaDayText(day, todayKey)
  return (
    <div className="flex min-w-0 items-center gap-2 4xl:flex-col 4xl:items-start 4xl:gap-1.5 4xl:pt-[13px]">
      <div className="flex min-w-0 items-center gap-[5px] text-brand 4xl:items-start">
        <Icon icon="carbon:calendar" className="size-[17px] shrink-0 4xl:mt-px" aria-hidden="true" />
        <h2 className="m-0 min-w-0 truncate font-body text-base font-medium leading-[1.06] 4xl:whitespace-normal">
          {title}
          {detail ? (
            <span className="text-text-muted">
              <span className="4xl:hidden"> · </span>
              <span className="4xl:mt-1.5 4xl:block">{detail}</span>
            </span>
          ) : null}
        </h2>
      </div>
      {count ? <span className="ml-auto shrink-0 font-body text-[13px] font-medium leading-none text-text-muted 4xl:ml-[22px]">{count} cours</span> : null}
    </div>
  )
}

// The planning as a list, a week at a time (the week of `monday`, Monday
// first), as an agenda: each day with classes under its heading, its
// classes as cards in order; today and the selected day get a heading even
// without any ("Aucun cours"), and a week without a class says so once, by
// its state. A week shows from its start (Monday under the page's top);
// a day then picked in it (the strip, "Aujourd’hui") is scrolled to just
// under the page's top (`active`: the page in view, not a neighbour in
// the pager).
function PlanningListView({ monday, selectedDay, events, statusOn, accentFor, now, todayKey, active, onOpen, onRetry = null, onOpenAccount = null }) {
  const days = listWeekDays(events, monday, { todayKey, selectedDay })
  const listRef = useRef(null)
  // The day last scrolled for: only another one picked scrolls to it (the
  // week's classes arriving, or React running the effect again, don't).
  const handledDayRef = useRef(null)
  const targetDay = days.some((entry) => entry.day === selectedDay) ? selectedDay : null

  useEffect(() => {
    if (!active) return
    const list = listRef.current
    if (!list) return
    // Shown (the list opened, a week landed on): its start, from Monday;
    // a day picked in it since (the strip, "Aujourd’hui"): that day, once
    // it's listed.
    if (handledDayRef.current === null) handledDayRef.current = selectedDay
    const picked = selectedDay !== handledDayRef.current
    if (picked && !targetDay) return
    if (picked) handledDayRef.current = selectedDay
    const target = picked ? list.querySelector(`[data-day="${targetDay}"]`) ?? list : list
    // The page's top stays on top: the day lands just under it.
    const header = target.closest('.planning-page')?.querySelector('.planning-top')
    const headerHeight = header?.offsetHeight ?? 0
    const { top, bottom } = target.getBoundingClientRect()
    // Already under the top, in the screen's upper half or whole above a
    // phone's tab bar: left as it is.
    if (top >= headerHeight - 1 && (top < Math.max(headerHeight + 1, window.innerHeight / 2) || bottom <= window.innerHeight - TAB_BAR_ROOM)) return
    if (target === list && top >= headerHeight - 1) return
    target.style.scrollMarginTop = `${headerHeight + 12}px`
    target.scrollIntoView({ block: 'start', behavior: !picked || prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [active, targetDay, selectedDay])

  // A week without any class: its state as the grid's pages say it
  // (PlanningNote), with its way out (Réessayer, Mon compte).
  if (days.length === 0) {
    const kind = statusOn(monday)
    return (
      <div ref={listRef} className="planning-list" role="region" aria-label={`Semaine du ${weekRangeText(monday)}`}>
        <div className="planning-list-note">
          <PlanningNote
            kind={kind}
            text={kind === 'loaded' ? 'Aucun cours cette semaine' : null}
            onRetry={onRetry ? () => onRetry(monday) : null}
            onOpenAccount={onOpenAccount}
          />
        </div>
      </div>
    )
  }

  return (
    <div ref={listRef} className="planning-list" role="region" aria-label={`Semaine du ${weekRangeText(monday)}`}>
      {days.map(({ day, events: dayEvents }) => (
        <section key={day} data-day={day} className="planning-list-day">
          <DayHeading day={day} todayKey={todayKey} count={dayEvents.length} />
          {dayEvents.length ? (
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0 4xl:gap-2.5">
              {dayEvents.map((event) => (
                <li key={event.id} className="flex min-w-0">
                  <PlanningListCard event={event} accent={accentFor(event.title)} ongoing={isOngoing(event, now)} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="planning-list-free">
              <Icon icon="carbon:sun" className="size-4 shrink-0" aria-hidden="true" />
              <span>Aucun cours</span>
            </p>
          )}
        </section>
      ))}
    </div>
  )
}

export default PlanningListView
