import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { courseWindow, courseWindowMondays, filterCourseDays, listCourseDays, pickCourseStartDay } from '../mailCourseAttach'
import { agendaDayText, parseDayKey, toDayKey } from '../planningDates'
import { isOngoing } from '../planningEvents'
import { usePlanningWeeks, useEventAccents } from '../usePlanningWeeks'
import MailAttachDrawer, { ATTACH_CARD_CLASS, AttachDrawerError, AttachDrawerNote } from './MailAttachDrawer'
import { PlanningListCard } from './PlanningListView'
import { SHIMMER_CLASSES } from './widgetListUtils'

// The planning service's name (planning.providerName), ADE by default.
const PROVIDER = universityConfig.planning?.providerName ?? 'ADE'
// From this many classes, a search field over the list.
const SEARCH_FROM = 7
const SKELETON_CARDS = 4
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

// A day's heading, as the planning list's (« Aujourd’hui · mardi 28
// octobre », « Jeudi 30 octobre »), its number of classes at the end;
// always over its cards (the drawer is narrow).
function DayHeading({ day, todayKey, count }) {
  const { title, detail } = agendaDayText(day, todayKey)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 items-center gap-[5px] text-brand">
        <Icon icon="carbon:calendar" className="size-[17px] shrink-0" aria-hidden="true" />
        <h3 className="m-0 min-w-0 truncate font-body text-base font-medium leading-[1.06]">
          {title}
          {detail ? <span className="text-text-muted"> · {detail}</span> : null}
        </h3>
      </div>
      <span className="ml-auto shrink-0 font-body text-[13px] font-medium leading-none text-text-muted">{count} cours</span>
    </div>
  )
}

// « Un cours… » of the composer's trombone: a drawer as « Une note… »'s
// (MailAttachDrawer), the classes of the week before and the week after
// today in it, by day as the planning's list shows them (its cards, the
// course's colours), opened on today (or the next day with classes), a
// search field once they're many. The weeks are the Planning page's own
// (usePlanningWeeks: its cache for the visit, else asked now), card
// skeletons meanwhile, « Réessayer » when they didn't come.
// `planning`: { selection, user }, App's (the student's group, both
// universities' sources: ADE's groups, TEMPO's own timetable).
// `onPick({ event, accent })`: the composer puts it in the mail (and
// closes the drawer).
function MailCoursePicker({ planning, onPick, onClose }) {
  const [todayKey] = useState(() => toDayKey(Date.now()))
  const [now] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  const { events, statusOn, load, retry } = usePlanningWeeks({ selection: planning?.selection ?? null, user: planning?.user ?? null })
  const accentFor = useEventAccents(events)
  const mondays = useMemo(() => courseWindowMondays(todayKey), [todayKey])
  useEffect(() => {
    for (const monday of mondays) load(monday)
  }, [mondays, load])

  const days = useMemo(() => listCourseDays(events, todayKey), [events, todayKey])
  const shown = useMemo(() => filterCourseDays(days, query, todayKey), [days, query, todayKey])
  const count = days.reduce((sum, entry) => sum + entry.events.length, 0)
  const statuses = mondays.map((monday) => statusOn(monday))
  const isLoading = statuses.includes('loading')
  const window_ = courseWindow(todayKey)
  const [fromLabel, toLabel] = [window_.from, window_.to].map((day) => SHORT_DAY_FORMAT.format(parseDayKey(day)))
  const range = `${fromLabel} – ${toLabel}`
  const subtitle = count ? `${count} cours · ${range}` : range
  const hasSearch = count >= SEARCH_FROM

  // Opened on today's classes (the week before above them), once they're
  // there; not again as the search changes the list.
  const scrollRef = useRef(null)
  const scrolledRef = useRef(false)
  const startDay = pickCourseStartDay(days, todayKey)
  useLayoutEffect(() => {
    const box = scrollRef.current
    if (scrolledRef.current || !box || !startDay || isLoading) return
    scrolledRef.current = true
    const section = box.querySelector(`[data-day="${startDay}"]`)
    if (section) box.scrollTop += section.getBoundingClientRect().top - box.getBoundingClientRect().top - 4
  }, [startDay, isLoading])

  const pick = (event) => onPick({ event, accent: accentFor(event.title) })
  const firstShown = shown[0]?.events[0] ?? null

  let body
  if (statuses.includes('unconfigured')) {
    body = <AttachDrawerNote>Indique ton groupe de TD/TP dans Mon compte pour voir tes cours</AttachDrawerNote>
  } else if (!count && isLoading) {
    body = (
      <ul className="mx-auto grid w-full max-w-[760px] list-none gap-2 p-0" aria-label="Chargement des cours" aria-busy="true">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <li key={index} className="widget-card widget-card-visible grid gap-2 card-corners-sm border bg-widget-bg p-[13px]">
            <span className={`h-3 w-[30%] rounded-full ${SHIMMER_CLASSES}`} />
            <span className={`h-3.5 ${index % 2 ? 'w-[55%]' : 'w-[75%]'} rounded-full ${SHIMMER_CLASSES}`} />
            <span className={`h-3 w-[45%] rounded-full ${SHIMMER_CLASSES}`} />
          </li>
        ))}
      </ul>
    )
  } else if (!count && statuses.includes('unavailable')) {
    body = (
      <AttachDrawerError
        text={`${PROVIDER} n’a pas répondu. Vérifie ta connexion, puis réessaie`}
        onRetry={() => mondays.forEach((monday) => statusOn(monday) === 'unavailable' && retry(monday))}
      />
    )
  } else if (!count) {
    body = <AttachDrawerNote>{statuses.every((status) => status === 'no-timetable') ? `${PROVIDER} n’a aucun cours pour toi` : `Aucun cours entre le ${fromLabel} et le ${toLabel}`}</AttachDrawerNote>
  } else if (!shown.length) {
    body = <AttachDrawerNote>Aucun cours trouvé</AttachDrawerNote>
  } else {
    body = (
      <div className="mx-auto grid w-full max-w-[760px] gap-6">
        {shown.map(({ day, events: dayEvents }) => (
          <section key={day} data-day={day} className="grid min-w-0 gap-3">
            <DayHeading day={day} todayKey={todayKey} count={dayEvents.length} />
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
              {dayEvents.map((event) => (
                <li key={event.id} className="flex min-w-0">
                  <PlanningListCard event={event} accent={accentFor(event.title)} ongoing={isOngoing(event, now)} onOpen={pick} className={ATTACH_CARD_CLASS} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  return (
    <MailAttachDrawer
      titleId="mail-course-picker-title"
      title="Joindre un cours"
      subtitle={subtitle}
      search={hasSearch ? { value: query, onChange: setQuery, placeholder: 'Rechercher un cours' } : null}
      onSubmit={() => {
        if (firstShown) pick(firstShown)
      }}
      onClose={onClose}
      scrollRef={scrollRef}
    >
      {body}
    </MailAttachDrawer>
  )
}

export default MailCoursePicker
