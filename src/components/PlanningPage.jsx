import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { flushPlanningNavigation, trackPlanningAction, trackPlanningNavigation, usePlanningPageReport } from '../analytics'
import { describePlanningLoad, toPlanningPageSource, toPlanningView } from '../planningAnalytics'
import { addDays, daysBetween, startOfWeek, toDayKey } from '../planningDates'
import { weekColumns } from '../planningEvents'
import { usePlanningWeeks, useEventAccents } from '../usePlanningWeeks'
import { useHistorySheet } from '../useHistorySheet'
import { classCopyText } from '../contextMenuItems'
import { prepareCourseMail } from '../courseMail'
import { copyToClipboard, useContextMenu } from '../useContextMenu'
import PlanningDayPage from './PlanningDayPage'
import PlanningEventSheet from './PlanningEventSheet'
import PlanningHeader from './PlanningHeader'
import PlanningListView from './PlanningListView'
import SwipePager from './SwipePager'

// The view (one day, two side by side, or the week's list), kept in this
// browser.
const VIEW_KEY = 'l-ent:planning-view'
const PHONE_VIEWS = ['day', 'twoDays', 'list']
// From the sidebar's breakpoint (4xl), where the page has the room for a
// week: the week, one day or the list, kept apart from the phone's view.
const WIDE_VIEW_KEY = 'l-ent:planning-wide-view'
const WIDE_VIEWS = ['day', 'week', 'list']
const WIDE_QUERY = '(min-width: 1024px)'
// The days a page spans, by view (the week shows five or seven of its
// seven, see weekColumns; the list, the week's days with classes).
const VIEW_DAYS = { day: 1, twoDays: 2, week: 7, list: 7 }
const compareDays = (left, right) => daysBetween(right, left)
const stepWeeks = (monday, count) => addDays(monday, 7 * count)

function readView() {
  try {
    const stored = localStorage.getItem(VIEW_KEY)
    return PHONE_VIEWS.includes(stored) ? stored : 'day'
  } catch {
    return 'day'
  }
}

function readWideView() {
  try {
    const stored = localStorage.getItem(WIDE_VIEW_KEY)
    return WIDE_VIEWS.includes(stored) ? stored : 'week'
  } catch {
    return 'week'
  }
}

function storeView(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the view lasts for the visit.
  }
}

function subscribeWide(onChange) {
  const query = window.matchMedia(WIDE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

// Whether the window is wide enough for the sidebar, and the week.
function useWideLayout() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false)
}

// The time, once a minute: the now line and what "today" is.
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

// Blocks measure their text: once the display font is in, again.
function useFontsReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    document.fonts?.ready.then(() => {
      if (alive) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])
  return ready
}

// "Planning": the student's timetable, laid out as the iOS app's in the
// site's style (Mes notes' title band, cards and sheet). One day is
// selected (the single source of truth): the header's week strip and the
// pages of hours follow it, either swiped. A class opens its sheet. On a
// wide screen it spans the page as Mes notes does and shows the week of
// the selected day, Monday first, its days' headers in place of the strip
// (one opens its day). Both also have the list (PlanningListView): the
// selected day's week as an agenda, its pages swiped by weeks, the day
// picked scrolled to.
// `selection`: the student's group (profileStorage), its weeks asked of
// /ade/upcoming (usePlanningWeeks). `showWeekend`: the week's Saturday and
// Sunday even without classes (Mon compte). `onOpenAccount`: Mon compte,
// where a student without a group chooses it. `initialDay`: a day to open on
// ("YYYY-MM-DD", the dashboard's "Prochain cours"), handed back with
// onInitialDayHandled once taken. `arrivalSource`: how the student got here,
// for the anonymous analytics (src/planningAnalytics.js); the page mounts
// once per arrival. `onComposeMail(request)`: App's, the mail page opened
// on a prefilled composer (« Écrire au sujet de ce cours »); null without
// the in-app mail page, and the action isn't offered.
function PlanningPage({ selection = null, user = null, showWeekend = false, onOpenAccount = null, initialDay = null, onInitialDayHandled = () => {}, arrivalSource = 'other', onComposeMail = null }) {
  const now = useNow()
  const todayKey = toDayKey(now)
  const isWide = useWideLayout()
  const [phoneView, setPhoneView] = useState(readView)
  const [wideView, setWideView] = useState(readWideView)
  const view = isWide ? wideView : phoneView
  const isWeek = view === 'week'
  const isList = view === 'list'
  // The week and the list move by weeks, their pages the Mondays.
  const byWeek = isWeek || isList
  const dayCount = VIEW_DAYS[view]
  const [selectedDay, setSelectedDay] = useState(() => initialDay ?? todayKey)
  useEffect(() => {
    if (!initialDay) return
    setSelectedDay(initialDay)
    onInitialDayHandled()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDay])
  const { events, statusOn, errorKindOn, load, retry } = usePlanningWeeks({ selection, user })
  const accentFor = useEventAccents(events)
  // Anonymous analytics: page_viewed, then how the week it opens on loaded
  // (categories only, never its classes or which week it is).
  const [arrivalMonday] = useState(() => startOfWeek(initialDay ?? todayKey))
  const arrivalStatus = statusOn(arrivalMonday)
  usePlanningPageReport(toPlanningPageSource(arrivalSource), toPlanningView(view), describePlanningLoad({
    status: arrivalStatus,
    errorKind: errorKindOn(arrivalMonday),
    hasClasses: arrivalStatus === 'loaded' && events.some((event) => startOfWeek(event.day) === arrivalMonday),
  }))
  // A burst of steps still open is reported as the page goes.
  useEffect(() => flushPlanningNavigation, [])
  useFontsReady()

  const daysRef = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = daysRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  // The page's weeks and its neighbours', so a swipe lands on known days.
  useEffect(() => {
    const mondays = new Set()
    for (let offset = -dayCount; offset < 2 * dayCount; offset += 1) mondays.add(startOfWeek(addDays(selectedDay, offset)))
    for (const monday of mondays) load(monday)
  }, [selectedDay, dayCount, load])

  const sheet = useHistorySheet('tafacPlanningSheet')
  const [openEvent, setOpenEvent] = useState(null)
  // The open class's next 30 days, for its occurrences.
  const occurrenceWeeks = openEvent ? Array.from({ length: 6 }, (_, index) => startOfWeek(addDays(openEvent.day, index * 7))) : []
  useEffect(() => {
    for (const monday of occurrenceWeeks) load(monday)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEvent, load])

  const openSheet = useCallback((event) => {
    trackPlanningAction('course_opened', { view: toPlanningView(view) })
    setOpenEvent(event)
    sheet.open()
  }, [sheet, view])

  // A view picked in the header's switch (wide) or menu (phone), kept.
  const changeView = (next) => {
    if (next !== view) trackPlanningAction('view_changed', { view: toPlanningView(next) })
    if (isWide) {
      storeView(WIDE_VIEW_KEY, next)
      setWideView(next)
      return
    }
    storeView(VIEW_KEY, next)
    setPhoneView(next)
  }

  // A day's header in the week: that day, alone (for this visit: the
  // stored view stays the week). In the list, its day, scrolled to.
  const openDay = (day) => {
    trackPlanningAction('day_opened')
    setSelectedDay(day)
    if (!isList) setWideView('day')
  }

  // « Écrire au sujet de ce cours »: the mail made from the class (its
  // image drawn first, src/courseMail.js), then the mail page. Once at a
  // time: a second press while the image is drawn does nothing.
  const composingRef = useRef(false)
  const writeAboutCourse = useMemo(() => (onComposeMail ? async (event) => {
    if (composingRef.current) return
    composingRef.current = true
    try {
      onComposeMail(await prepareCourseMail({ event, accent: accentFor(event.title) }))
    } finally {
      composingRef.current = false
    }
  } : null), [onComposeMail, accentFor])

  // A class's right-click menu (a long press; `key`: its id): its sheet,
  // its day on its own (from the week), a mail about it, the class as text.
  const eventMenuProps = useContextMenu((id) => {
    const event = events.find((entry) => entry.id === id)
    if (!event) return null
    return [
      { id: 'open', label: 'Voir le détail', icon: 'carbon:view', onSelect: () => openSheet(event) },
      isWeek ? { id: 'day', label: 'Afficher le jour', icon: 'carbon:calendar', onSelect: () => openDay(event.day) } : null,
      writeAboutCourse ? { id: 'write', label: 'Écrire au sujet de ce cours', icon: 'carbon:email', onSelect: () => void writeAboutCourse(event) } : null,
      'separator',
      { id: 'copy', label: 'Copier', icon: 'carbon:copy', onSelect: () => void copyToClipboard(classCopyText(event)) },
    ]
  })

  const stepDays = useCallback((day, count) => addDays(day, count * dayCount), [dayCount])
  // The week's columns, for its pages and their headers alike.
  const shownDay = isWeek ? null : selectedDay
  const columnsFor = useCallback((monday) => weekColumns(events, monday, { showWeekend, shownDay }), [events, showWeekend, shownDay])
  // The week's pages are its Mondays; moving by weeks selects the Monday.
  const pageValue = byWeek ? startOfWeek(selectedDay) : selectedDay
  const stepPage = byWeek ? stepWeeks : stepDays
  // A step through pages, for the analytics: `via` 'arrow', 'keyboard' or
  // 'swipe' (bursts of them count once, see trackPlanningNavigation).
  const reportStep = (via) => trackPlanningNavigation(byWeek ? 'week_changed' : 'day_changed', via)
  // The arrows and keys: a page back or ahead (a week from its Monday, or
  // a day).
  const stepBy = (count, via) => {
    reportStep(via)
    setSelectedDay((day) => (byWeek ? stepWeeks(startOfWeek(day), count) : stepDays(day, count)))
  }

  return (
    <section className="planning-page w-full px-6 pt-4 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5" aria-labelledby="planning-page-title">
      {/* The page's top, tinted apart from the hours as Mes notes' is (the
          band itself behind, so the month's calendar can hang out of it):
          the title row and the week strip, staying on top as the hours
          scroll under. On a phone it tops the screen (no app top bar
          here), a little more room above. */}
      <div className="planning-top -mt-4 pt-4 pb-4 4xl:-mt-5 4xl:pt-5 max-md:-mt-3 max-md:pt-5 max-md:pb-3">
        <span className="page-top-band" aria-hidden="true" />
        <div className="planning-column relative">
          <PlanningHeader
            titleId="planning-page-title"
            selectedDay={selectedDay}
            todayKey={todayKey}
            view={view}
            isWide={isWide}
            columnsFor={columnsFor}
            selection={selection}
            onSelectDay={setSelectedDay}
            onOpenDay={openDay}
            onToday={() => {
              trackPlanningAction('today')
              setSelectedDay(todayKey)
            }}
            onStep={(count) => stepBy(count, 'arrow')}
            onChangeView={changeView}
          />
        </div>
      </div>
      <div
        ref={daysRef}
        className="planning-column planning-days pt-5 max-md:pt-4"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          if (event.target.closest?.('input, select, textarea')) return
          event.preventDefault()
          stepBy(event.key === 'ArrowRight' ? 1 : -1, 'keyboard')
        }}
      >
        {/* A new view settles in over the old one. */}
        <SwipePager
          key={view}
          className={`planning-pager ${isList ? 'is-list' : ''}`}
          value={pageValue}
          step={stepPage}
          compare={compareDays}
          label={byWeek ? 'Semaines' : 'Jours'}
          onSwipe={(day) => {
            reportStep('swipe')
            setSelectedDay(day)
          }}
          renderPage={(start, active) => (isList ? (
            <PlanningListView
              monday={start}
              selectedDay={selectedDay}
              events={events}
              statusOn={statusOn}
              accentFor={accentFor}
              now={now}
              todayKey={todayKey}
              active={active}
              onOpen={openSheet}
              menuProps={eventMenuProps}
              onRetry={retry}
              onOpenAccount={onOpenAccount}
            />
          ) : (
            <PlanningDayPage
              days={isWeek ? columnsFor(start) : Array.from({ length: dayCount }, (_, index) => addDays(start, index))}
              width={width}
              events={events}
              statusOn={statusOn}
              accentFor={accentFor}
              now={now}
              todayKey={todayKey}
              weekBlocks={isWide}
              onOpen={openSheet}
              menuProps={eventMenuProps}
              onRetry={retry}
              onOpenAccount={onOpenAccount}
            />
          ))}
        />
      </div>
      {sheet.isOpen && openEvent ? (
        <PlanningEventSheet
          event={openEvent}
          accent={accentFor(openEvent.title)}
          events={events}
          todayKey={todayKey}
          searching={occurrenceWeeks.some((monday) => statusOn(monday) === 'loading')}
          onClose={sheet.close}
          onWrite={writeAboutCourse ? () => void writeAboutCourse(openEvent) : null}
          onPickDay={(day) => {
            trackPlanningAction('occurrence_opened')
            sheet.close()
            setSelectedDay(day)
          }}
        />
      ) : null}
    </section>
  )
}

export default PlanningPage
