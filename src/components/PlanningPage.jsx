import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { flushPlanningNavigation, trackPlanningAction, trackPlanningNavigation, usePlanningPageReport } from '../analytics'
import { describePlanningLoad, toPlanningPageSource, toPlanningView } from '../planningAnalytics'
import { addDays, daysBetween, startOfWeek, toDayKey } from '../planningDates'
import { weekColumns } from '../planningEvents'
import { siteLabelFromSelection } from '../planningDirectory'
import { directoryTintStyle } from '../directoryTint'
import { usePlanningWeeks, useEventAccents } from '../usePlanningWeeks'
import { useHistorySheet } from '../useHistorySheet'
import { useHistoryValue } from '../useHistoryValue'
import { NEW_MARK_DIRECTORY, useNewMark } from '../useNewMark'
import { classCopyText } from '../contextMenuItems'
import { prepareCourseMail } from '../courseMail'
import { copyToClipboard, useContextMenu } from '../useContextMenu'
import PlanningDayPage from './PlanningDayPage'
import PlanningDirectoryPanel from './PlanningDirectoryPanel'
import PlanningDirectorySheet from './PlanningDirectorySheet'
import PlanningViewedFrame, { PlanningViewedBar } from './PlanningViewedFrame'
import PlanningEventSheet from './PlanningEventSheet'
import PlanningHeader from './PlanningHeader'
import PlanningListView from './PlanningListView'
import PlanningShareSheet from './PlanningShareSheet'
import SidePanelResizeHandle from './SidePanelResizeHandle'
import SwipePager from './SwipePager'
import { createSidePanelSizing, useSidePanelWidth } from '../sidePanelWidth'

// The view (one day, two side by side, or the week's list), kept in this
// browser.
const VIEW_KEY = 'l-ent:planning-view'
const PHONE_VIEWS = ['day', 'twoDays', 'list']
// From the sidebar's breakpoint (4xl), where the page has the room for a
// week: the week, one day or the list, kept apart from the phone's view.
const WIDE_VIEW_KEY = 'l-ent:planning-wide-view'
const WIDE_VIEWS = ['day', 'week', 'list']
const WIDE_QUERY = '(min-width: 1024px)'
// « Salles et personnels »' side panel (PlanningDirectoryPanel): narrower
// than the mail reader by default, a list; dragged from its left edge and
// stored for the device, the week keeping 560px beside it.
const DIRECTORY_SIZING = createSidePanelSizing({
  storageKey: 'l-ent:planning-side-panel-width',
  defaultWidth: 'clamp(360px, 32vw, 480px)',
  min: 320,
  max: 720,
  contentMin: 560,
})
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

// Back to the page's top: whatever scrolls it (the column on a wide
// screen, the window on a phone), gently unless motion is reduced.
function scrollToPageTop(element) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const behavior = reduce ? 'auto' : 'smooth'
  for (let node = element?.parentElement; node; node = node.parentElement) {
    if (node.scrollTop > 0) node.scrollTo({ top: 0, behavior })
  }
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior })
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
// `onSidePanelOpenChange(open)`: « Salles et personnels »' side panel shown
// or not (App folds the sidebar for it, as for the mail reader; a phone has
// a sheet instead). A room or a person picked there shows its timetable in
// place of the student's.
// `onOpenPlanningSettings`: Réglages › Planning, where the student changes
// their group (offered on the panel's « Formations »).
function PlanningPage({ selection = null, user = null, showWeekend = false, onOpenAccount = null, initialDay = null, onInitialDayHandled = () => {}, arrivalSource = 'other', onComposeMail = null, onSidePanelOpenChange = null, onOpenPlanningSettings = null }) {
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
  // « Salles et personnels »: a side panel on a wide screen, its button
  // toggling it. Gone with the wide layout (a phone has its sheet).
  const [isDirectoryWanted, setIsDirectoryWanted] = useState(false)
  const isDirectoryOpen = isDirectoryWanted && isWide
  // A room or a person picked there: its timetable in place of the
  // student's, as a group of its own (its ADE id), framed in its colour
  // with its name on top (PlanningViewedFrame), until « × » there or the
  // panel closes (the student's own back with it).
  const [viewedEntry, setViewedEntry] = useState(null)
  // On a phone, a sheet (PlanningDirectorySheet, its own history entry);
  // the one picked there stays shown once it closes, under a bar of its
  // colour (PlanningViewedBar), on a history entry of its own: « × » there
  // or Back brings the student's own back.
  const directorySheet = useHistorySheet('tafacPlanningDirectorySheet')
  const phoneViewed = useHistoryValue('tafacPlanningViewed')
  const viewed = isWide ? (isDirectoryOpen ? viewedEntry : null) : phoneViewed.value
  const shownSelection = useMemo(
    () => (viewed ? { resourceId: viewed.id, label: viewed.name } : selection),
    [viewed, selection],
  )
  const { events, statusOn, errorKindOn, load, retry } = usePlanningWeeks({ selection: shownSelection, user })
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

  // « Partager »: the selected day's week as an image, in a sheet of its
  // own (its own history entry, as the class's sheet).
  const shareSheet = useHistorySheet('tafacPlanningShareSheet')
  const openShare = useCallback(() => {
    trackPlanningAction('share_opened', { view: toPlanningView(view) })
    shareSheet.open()
  }, [shareSheet, view])
  const shareMonday = startOfWeek(selectedDay)

  const toggleDirectory = useCallback(() => {
    setIsDirectoryWanted((open) => {
      if (!open) trackPlanningAction('directory_opened')
      return !open
    })
    setViewedEntry(null)
  }, [])
  const closeDirectory = useCallback(() => {
    setIsDirectoryWanted(false)
    setViewedEntry(null)
  }, [])
  // The student's own group picked: their own planning, no frame.
  const ownGroupId = selection?.resourceId ? String(selection.resourceId) : null
  const pickDirectoryEntry = useCallback((entry) => {
    trackPlanningAction('directory_picked', { kind: entry.kind })
    setViewedEntry(entry.id === ownGroupId ? null : { id: entry.id, name: entry.name, kind: entry.kind })
  }, [ownGroupId])
  const stopViewing = useCallback(() => setViewedEntry(null), [])
  const [, markDirectorySeen] = useNewMark(NEW_MARK_DIRECTORY)
  const { open: openDirectorySheetEntry, close: closeDirectorySheet } = directorySheet
  const openDirectorySheet = useCallback(() => {
    trackPlanningAction('directory_opened')
    markDirectorySeen()
    openDirectorySheetEntry()
  }, [markDirectorySeen, openDirectorySheetEntry])
  // A phone's pick: the sheet closes onto the planning, then the one picked
  // is shown on its own entry (none for the student's own group).
  const { show: showOnPhone, showAfterBack: showOnPhoneAfterBack } = phoneViewed
  const pickOnPhone = useCallback((entry) => {
    trackPlanningAction('directory_picked', { kind: entry.kind })
    const next = entry.id === ownGroupId ? null : { id: entry.id, name: entry.name, kind: entry.kind }
    if (closeDirectorySheet()) showOnPhoneAfterBack(next)
    else showOnPhone(next)
  }, [ownGroupId, closeDirectorySheet, showOnPhone, showOnPhoneAfterBack])
  // Réglages over the sheet: the sheet goes first.
  const openSettingsFromSheet = useMemo(() => (onOpenPlanningSettings ? () => {
    closeDirectorySheet()
    onOpenPlanningSettings()
  } : null), [onOpenPlanningSettings, closeDirectorySheet])
  // From a phone to a wide screen (an iPad turned), the phone's sheet and
  // what it showed go: the wide screen has its panel. Back the other way,
  // the panel's state waits for the wide layout.
  useEffect(() => {
    if (!isWide) return
    if (phoneViewed.value) showOnPhone(null)
    if (directorySheet.isOpen) closeDirectorySheet()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWide])
  // The directory's tab and search, kept between openings (and from the
  // panel to the sheet).
  const [directoryTab, setDirectoryTab] = useState('room')
  const [directoryQuery, setDirectoryQuery] = useState('')
  const directoryWidth = useSidePanelWidth(DIRECTORY_SIZING)
  // What the panel and the sheet are both handed.
  const directoryProps = {
    user,
    siteLabel: siteLabelFromSelection(selection),
    formationLabel: selection?.programLabel ?? null,
    ownId: ownGroupId,
    shownId: viewed?.id ?? null,
    tab: directoryTab,
    onTabChange: setDirectoryTab,
    query: directoryQuery,
    onQueryChange: setDirectoryQuery,
  }
  useEffect(() => {
    onSidePanelOpenChange?.(isDirectoryOpen)
  }, [isDirectoryOpen, onSidePanelOpenChange])
  useEffect(() => () => onSidePanelOpenChange?.(false), [onSidePanelOpenChange])

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
      { id: 'open', label: 'Voir le détail', icon: 'ph:eye', onSelect: () => openSheet(event) },
      isWeek ? { id: 'day', label: 'Afficher le jour', icon: 'ph:calendar-blank', onSelect: () => openDay(event.day) } : null,
      writeAboutCourse ? { id: 'write', label: 'Écrire au sujet de ce cours', icon: 'ph:envelope-simple', onSelect: () => void writeAboutCourse(event) } : null,
      'separator',
      { id: 'copy', label: 'Copier', icon: 'ph:copy', onSelect: () => void copyToClipboard(classCopyText(event)) },
    ]
  })

  const stepDays = useCallback((day, count) => addDays(day, count * dayCount), [dayCount])
  // The week's columns, for its pages and their headers alike.
  const shownDay = isWeek ? null : selectedDay
  const columnsFor = useCallback((monday) => weekColumns(events, monday, { showWeekend, shownDay }), [events, showWeekend, shownDay])
  // The week's pages are its Mondays; moving by weeks selects the Monday.
  const pageValue = byWeek ? startOfWeek(selectedDay) : selectedDay
  const stepPage = byWeek ? stepWeeks : stepDays
  // Another page of hours (swiped, stepped, picked in the strip): seen
  // from its top, as it slides in. The list scrolls itself to the day.
  const shownPageRef = useRef(pageValue)
  useEffect(() => {
    if (shownPageRef.current === pageValue) return
    shownPageRef.current = pageValue
    if (!isList) scrollToPageTop(daysRef.current)
  }, [pageValue, isList])
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
    <section
      className={`planning-page w-full px-6 pt-4 pb-6 4xl:pt-5 ${directoryWidth.isResizing ? '' : '4xl:transition-[padding-right] 4xl:duration-[340ms] 4xl:ease-[cubic-bezier(0.32,0.72,0,1)]'} max-md:px-3 max-md:pt-3 max-md:pb-5 ${isDirectoryOpen ? '4xl:pr-[calc(var(--side-panel-width)+24px)]' : ''}`}
      style={{ '--side-panel-width': directoryWidth.css }}
      aria-labelledby="planning-page-title"
    >
      {/* The page's top, tinted apart from the hours as Mes notes' is (the
          band itself behind, so the month's calendar can hang out of it):
          the title row and the week strip, staying on top as the hours
          scroll under. On a phone it tops the screen (no app top bar
          here), a little more room above, washed in the colour of the
          room or person shown (PlanningViewedBar). */}
      <div
        className={`planning-top -mt-4 pt-4 pb-4 4xl:-mt-5 4xl:pt-5 max-md:-mt-3 max-md:pt-5 max-md:pb-3 ${!isWide && viewed ? 'is-viewing' : ''}`}
        style={!isWide && viewed ? directoryTintStyle(viewed) ?? undefined : undefined}
      >
        <span className="page-top-band" aria-hidden="true" />
        <div className="planning-column relative">
          <PlanningHeader
            titleId="planning-page-title"
            selectedDay={selectedDay}
            todayKey={todayKey}
            view={view}
            isWide={isWide}
            columnsFor={columnsFor}
            selection={shownSelection}
            onSelectDay={setSelectedDay}
            onOpenDay={openDay}
            onToday={() => {
              trackPlanningAction('today')
              setSelectedDay(todayKey)
            }}
            onStep={(count) => stepBy(count, 'arrow')}
            onChangeView={changeView}
            onShare={openShare}
            isDirectoryOpen={isWide ? isDirectoryOpen : directorySheet.isOpen}
            onOpenDirectory={isWide ? toggleDirectory : openDirectorySheet}
          />
          {!isWide && viewed ? <PlanningViewedBar viewed={viewed} onChange={openDirectorySheet} onStop={() => showOnPhone(null)} /> : null}
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
      {shareSheet.isOpen ? (
        <PlanningShareSheet
          monday={shareMonday}
          days={weekColumns(events, shareMonday, { showWeekend })}
          events={events}
          status={statusOn(shareMonday)}
          accentFor={accentFor}
          group={shownSelection?.label ?? ''}
          selection={shownSelection}
          onClose={shareSheet.close}
          onComposeMail={onComposeMail}
        />
      ) : null}
      {isWide && viewed ? <PlanningViewedFrame viewed={viewed} onStop={stopViewing} /> : null}
      <PlanningDirectoryPanel
        open={isDirectoryOpen}
        onClose={closeDirectory}
        {...directoryProps}
        onOpenGroupSettings={onOpenPlanningSettings}
        onPick={pickDirectoryEntry}
      />
      {directorySheet.isOpen && !isWide ? (
        <PlanningDirectorySheet
          onClose={closeDirectorySheet}
          {...directoryProps}
          onOpenGroupSettings={openSettingsFromSheet}
          onPick={pickOnPhone}
        />
      ) : null}
      {isDirectoryOpen ? (
        <SidePanelResizeHandle
          sizing={DIRECTORY_SIZING}
          width={directoryWidth.width}
          onWidthChange={directoryWidth.onWidthChange}
          onResizingChange={directoryWidth.onResizingChange}
          cssVar="--side-panel-width"
          panelSelector=".side-panel"
          label="Largeur du panneau"
        />
      ) : null}
    </section>
  )
}

export default PlanningPage
