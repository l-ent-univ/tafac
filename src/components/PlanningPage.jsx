import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { flushPlanningNavigation, trackPlanningAction, trackPlanningNavigation, usePlanningPageReport } from '../analytics'
import { Icon } from '@iconify/react'
import { navigateTo } from '../appRoute'
import { SIGNAL_LABELS, groupSiteSignals, noticeForEvent } from '../mailSignals'
import { requestMailMessage } from '../mailSelection'
import { SIGNAL_STYLES, describeDays } from '../mailSignalStyles'
import { describePlanningLoad, toPlanningPageSource, toPlanningView } from '../planningAnalytics'
import { addDays, daysBetween, relativeDayText, startOfWeek, toDayKey } from '../planningDates'
import { weekColumns } from '../planningEvents'
import { usePlanningWeeks, useEventAccents } from '../usePlanningWeeks'
import { useHistorySheet } from '../useHistorySheet'
import { useMailSignals } from '../useMailSignals'
import { INLINE_BUTTON } from './AppPage'
import { GradesNotice } from './GradesNotice'
import PlanningDayPage from './PlanningDayPage'
import PlanningEventSheet from './PlanningEventSheet'
import PlanningHeader from './PlanningHeader'
import PlanningListView from './PlanningListView'
import PlanningTools from './planning/PlanningTools'
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
// once per arrival. `establishment`: the student's site, for the mails
// announcing it blocked or closed (mailSignals).
function PlanningPage({ selection = null, user = null, establishment = null, showWeekend = false, onOpenAccount = null, initialDay = null, onInitialDayHandled = () => {}, arrivalSource = 'other' }) {
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
  const { events: loadedEvents, statusOn, errorKindOn, load, retry } = usePlanningWeeks({ selection, user })
  // Each class with what the student's mails say about it (`notice`: the
  // site blocked, the class cancelled, moved…, see mailSignals).
  const signals = useMailSignals()
  const events = useMemo(() => (signals.length
    ? loadedEvents.map((event) => {
      const notice = noticeForEvent(signals, event, establishment)
      return notice ? { ...event, notice } : event
    })
    : loadedEvents), [loadedEvents, signals, establishment])
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

  // The site blocked or on strike on a day shown (mailSignals): a notice
  // over the days, as Mes notes' (its classes carry their chip).
  const shownStart = byWeek ? startOfWeek(selectedDay) : selectedDay
  const shownDays = Array.from({ length: byWeek ? 7 : dayCount }, (_, index) => addDays(shownStart, index))
  // One notice per kind however many mails announced it, for the days shown.
  const siteNotices = groupSiteSignals(signals, establishment)
    .map((group) => ({ ...group, shown: group.days.filter((day) => shownDays.includes(day)) }))
    .filter(({ shown }) => shown.length)
  const openMail = (signal) => {
    requestMailMessage(signal.id)
    navigateTo('mail', { source: 'other' })
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
            tools={<PlanningTools events={events} monday={startOfWeek(selectedDay)} selection={selection} />}
          />
        </div>
      </div>
      {siteNotices.length ? (
        <div className="planning-column grid gap-2 pt-5 max-md:pt-4">
          {siteNotices.map(({ kind, shown, signals: mails }) => (
            <GradesNotice
              key={kind}
              label={SIGNAL_LABELS[kind]}
              title={SIGNAL_LABELS[kind]}
              badge={mails.length > 1 ? `${mails.length} mails` : null}
              media={(
                <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${SIGNAL_STYLES[kind].tint}`} aria-hidden="true">
                  <Icon icon={SIGNAL_STYLES[kind].icon} className="size-[18px]" />
                </span>
              )}
            >
              <span className="grid justify-items-start gap-2">
                <span>
                  <strong className="font-semibold text-text">{describeDays(shown, todayKey)}</strong>
                  {kind === 'closure'
                    ? ` : tes cours ${shown.length > 1 ? 'de ces jours' : 'de ce jour'} sont sans doute annulés.`
                    : ' : certains cours peuvent ne pas avoir lieu.'}
                  {` Dernier mail : « ${mails[0].subject} ».`}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {shown.length > 1 ? shown.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={`${INLINE_BUTTON} ${day === selectedDay && !byWeek ? 'border-brand! text-brand!' : ''}`}
                      onClick={() => openDay(day)}
                    >
                      {relativeDayText(day, todayKey)}
                    </button>
                  )) : null}
                  <button type="button" className={INLINE_BUTTON} onClick={() => openMail(mails[0])}>
                    Voir le mail
                    <Icon icon="carbon:arrow-right" className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              </span>
            </GradesNotice>
          ))}
        </div>
      ) : null}
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
              onRetry={retry}
              onOpenAccount={onOpenAccount}
            />
          ))}
        />
      </div>
      {sheet.isOpen && openEvent ? (
        <PlanningEventSheet
          event={openEvent}
          establishment={establishment}
          accent={accentFor(openEvent.title)}
          events={events}
          todayKey={todayKey}
          searching={occurrenceWeeks.some((monday) => statusOn(monday) === 'loading')}
          onClose={sheet.close}
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
