import { useEffect, useMemo, useState } from 'react'
import { getBriefingSources, publishBriefingSource } from '../briefingSources'
import { isWidgetAvailable } from '../dashboardWidgets'
import { getGrades, getMoodleDeadlines, getRecentMail, listGradedEvaluations } from '../entApi'
import { accentStyle } from '../eventAccents'
import { GRADES_FEATURE_ENABLED } from '../gradeFeatureState'
import { buildDueList, buildGradeList, buildUnreadList, formatHour, formatTodayLabel, pickAgendaDay } from '../homeDraft'
import { readSeenEvaluationIds } from '../seenGrades'
import {
  NEXT_CLASS_LOOKAHEAD_DAYS,
  buildNextClassCacheEntryKey,
  buildResourceIdsFromSelection,
  fetchUpcomingEvents,
  persistNextClassCache,
  readNextClassCache,
} from '../upcomingClasses'
import { useEventAccents } from '../usePlanningWeeks'
import ServiceNotice from './ServiceNotice'
import { SHIMMER_CLASSES, formatReceivedAt, openInNewTab } from './widgetListUtils'

// « Accueil » (sidebar, below « Toutes les applications »): a canvas for a
// new home screen, to be reshaped by usage data. One column, no cards: the
// day's classes, « À rendre », « Notes », « Non lus ». Each block reads the
// same source as its dashboard card (and its cache) and follows the same
// gating, so it shows for every university and for the demo account.

// The next-class cache is fresh enough under this age (the dashboard card
// refreshes every 5 min while shown).
const CLASSES_REFRESH_MS = 10 * 60 * 1000
const NO_CLASSES = []
function useNow(intervalMs = 60 * 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

// Upcoming classes through the dashboard's next-class cache: what's there
// when fresh, else one request, written back for the dashboard to reuse.
function useUpcomingClasses({ enabled, selection, sessionUser, lookaheadDays }) {
  const resourceKey = buildResourceIdsFromSelection(selection).join('|')
  const cacheKey = buildNextClassCacheEntryKey(sessionUser, resourceKey, lookaheadDays)
  const [state, setState] = useState(() => {
    if (!enabled) return { status: 'unavailable', events: [], complete: true }
    if (!resourceKey) return { status: 'unconfigured', events: [], complete: true }
    const cached = readNextClassCache(cacheKey)
    return cached ? { status: 'ok', events: cached.events, complete: cached.complete } : { status: 'loading', events: [], complete: true }
  })

  useEffect(() => {
    if (!enabled || !resourceKey || !cacheKey) return undefined
    const cached = readNextClassCache(cacheKey)
    if (cached && Date.now() - cached.cachedAt < CLASSES_REFRESH_MS) return undefined

    const controller = new AbortController()
    fetchUpcomingEvents({ selection, lookaheadDays, signal: controller.signal })
      .then((result) => {
        persistNextClassCache(cacheKey, result)
        publishBriefingSource('classes', { cacheKey, loadedAt: Date.now() })
        if (!controller.signal.aborted) setState({ status: 'ok', events: result.events, complete: result.complete })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((current) => (current.status === 'ok' ? current : { status: 'error', events: [], complete: true }))
      })
    return () => controller.abort()
  }, [cacheKey, enabled, lookaheadDays, resourceKey, selection])

  return state
}

// Moodle deadlines: the « Échéances » card's last answer when it has one.
function useDeadlines(enabled) {
  const [state, setState] = useState(() => {
    if (!enabled) return { status: 'unavailable', items: [], moodleHref: null }
    const shared = getBriefingSources().deadlines
    return shared?.status === 'ok' ? shared : { status: 'loading', items: [], moodleHref: null }
  })

  useEffect(() => {
    if (!enabled || getBriefingSources().deadlines?.status === 'ok') return undefined
    let active = true
    getMoodleDeadlines().then((result) => {
      if (active) setState(result)
    })
    return () => {
      active = false
    }
  }, [enabled])

  return state
}

function useRecentMail(enabled) {
  const [state, setState] = useState(() => (enabled
    ? { status: 'loading', messages: [], unreadCount: null, webmailHref: null }
    : { status: 'unavailable', messages: [], unreadCount: null, webmailHref: null }))

  useEffect(() => {
    if (!enabled) return undefined
    const controller = new AbortController()
    getRecentMail({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && result.status !== 'aborted') setState(result)
    })
    return () => controller.abort()
  }, [enabled])

  return state
}

// Graded evaluations (shared in-memory grades answer) and the ids « Mes
// notes » last showed on this device.
function useGradedEvaluations(enabled, sessionUser) {
  const [state, setState] = useState(() => (enabled ? { status: 'loading', grades: [], seenIds: null } : { status: 'unavailable', grades: [], seenIds: null }))

  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    getGrades().then((data) => {
      if (!active) return
      const grades = listGradedEvaluations(data)
      if (!Array.isArray(grades)) {
        setState({ status: 'error', grades: [], seenIds: null })
        return
      }
      const seenIds = grades[0] ? readSeenEvaluationIds(sessionUser, grades[0].semesterId) : null
      setState({ status: 'ok', grades, seenIds })
    })
    return () => {
      active = false
    }
  }, [enabled, sessionUser])

  return state
}

function Section({ title, count = null, note = null, children }) {
  return (
    <section className="grid gap-1" aria-label={title}>
      <h2 className="m-0 pb-1 font-body text-[13px] font-semibold leading-[1.3] text-text-muted">
        {title}
        {count ? <span className="tabular-nums"> · {count}</span> : null}
        {note ? <span className="font-medium"> · {note}</span> : null}
      </h2>
      {children}
    </section>
  )
}

// A row of a section: a button when it opens something, hairline above.
function Row({ onClick = null, muted = false, children }) {
  const className = `flex w-full min-w-0 items-baseline gap-4 border-0 border-t border-solid border-border bg-transparent py-2.5 text-left font-body text-[15px] leading-[1.3] text-text max-md:gap-3 ${muted ? 'opacity-50' : ''}`
  if (!onClick) return <div className={className}>{children}</div>
  return (
    <button type="button" onClick={onClick} className={`${className} cursor-pointer transition-colors duration-150 hover:text-text-secondary`}>
      {children}
    </button>
  )
}

function Line({ children }) {
  return <p className="m-0 border-t border-solid border-border py-2.5 font-body text-[15px] font-medium text-text-muted">{children}</p>
}

function Loading() {
  return (
    <div className="grid gap-2 border-t border-solid border-border pt-3" aria-hidden="true">
      <div className={`h-4 w-3/4 rounded ${SHIMMER_CLASSES}`} />
      <div className={`h-4 w-1/2 rounded ${SHIMMER_CLASSES}`} />
    </div>
  )
}

function ClassesSection({ state, agenda, now, onOpenPlanningDay }) {
  const accentFor = useEventAccents(agenda?.classes ?? NO_CLASSES)
  const title = agenda ? agenda.label : 'Aujourd’hui'
  const note = agenda && !agenda.isToday && agenda.freeToday ? 'pas de cours aujourd’hui' : null

  let rows
  if (state.status === 'loading') rows = <Loading />
  else if (state.status === 'unconfigured') rows = <Line>Choisis ton groupe dans Mon compte</Line>
  else if (state.status === 'error') rows = <Line>Planning indisponible pour le moment</Line>
  else if (!agenda) rows = <Line>Aucun cours dans les deux prochaines semaines</Line>
  else {
    rows = agenda.classes.map((item) => {
      const minutes = Math.round((item.start - now) / 60000)
      const status = item.status === 'now'
        ? 'en cours'
        : item.status === 'next' && agenda.isToday && minutes <= 90
          ? `dans ${minutes} min`
          : null
      return (
        <Row key={item.key} muted={item.status === 'past'} onClick={onOpenPlanningDay ? () => onOpenPlanningDay(agenda.dayKey) : null}>
          <span className="w-12 shrink-0 font-semibold tabular-nums">{formatHour(item.start)}</span>
          <span className="planning-accent-fill w-[3px] shrink-0 self-stretch rounded-full" style={accentStyle(accentFor(item.title))} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-semibold" title={item.title}>{item.title}</span>
          {item.location ? <span className="shrink-0 truncate text-text-muted max-md:max-w-[30%]">{item.location}</span> : null}
          {status ? <span className="shrink-0 font-semibold text-brand">{status}</span> : null}
        </Row>
      )
    })
  }

  return <Section title={title} note={note}>{rows}</Section>
}

function DueSection({ state, items, fallbackHref }) {
  let rows
  if (state.status === 'loading') rows = <Loading />
  else if (state.status !== 'ok') rows = <Line>Moodle indisponible pour le moment</Line>
  else if (items.length === 0) rows = <Line>Rien à rendre cette semaine</Line>
  else {
    rows = items.map((item) => (
      <Row key={item.id} onClick={() => openInNewTab(item.source?.href || fallbackHref)}>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{item.title}</span>
          {item.detail ? <span className="text-text-muted"> · {item.detail}</span> : null}
        </span>
        <span className={`shrink-0 tabular-nums ${item.urgent ? 'font-semibold text-error' : 'text-text-muted'}`}>{item.meta}</span>
      </Row>
    ))
  }
  return <Section title="À rendre">{rows}</Section>
}

function GradesSection({ state, items, onOpenGrade }) {
  if (state.status === 'ok' && items.length === 0) return null
  let rows
  if (state.status === 'loading') rows = <Loading />
  else if (state.status !== 'ok') rows = <Line>Notes indisponibles pour le moment</Line>
  else {
    rows = items.map((item) => (
      <Row key={item.id} onClick={onOpenGrade ? () => onOpenGrade(item.source) : null}>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{item.title}</span>
          {item.detail ? <span className="text-text-muted"> · {item.detail}</span> : null}
        </span>
        {item.isNew ? <span className="shrink-0 text-[13px] font-semibold text-brand">nouvelle</span> : null}
        <span className="shrink-0 font-semibold tabular-nums">{item.meta}</span>
      </Row>
    ))
  }
  return <Section title="Notes">{rows}</Section>
}

function UnreadSection({ state, items, now, onOpenMail }) {
  const count = state.status === 'ok' ? (state.unreadCount ?? items.length) : null
  let rows
  if (state.status === 'loading') rows = <Loading />
  else if (state.status !== 'ok') rows = <Line>Messagerie indisponible pour le moment</Line>
  else if (items.length === 0) rows = <Line>Aucun mail non lu</Line>
  else {
    rows = items.map((item) => (
      <Row
        key={item.id}
        onClick={() => {
          if (onOpenMail && item.source?.id) onOpenMail(item.source.id)
          else openInNewTab(item.source?.href || state.webmailHref)
        }}
      >
        <span className="w-44 shrink-0 truncate font-semibold max-md:w-[38%]">{item.detail || 'Expéditeur inconnu'}</span>
        <span className="min-w-0 flex-1 truncate text-text-secondary">{item.title}</span>
        <span className="shrink-0 tabular-nums text-text-muted">{formatReceivedAt(item.receivedAt, now)}</span>
      </Row>
    ))
  }
  return <Section title="Non lus" count={count}>{rows}</Section>
}

function HomeDraftPage({
  sessionUser = null,
  establishment = null,
  gradesSupported = true,
  selection = null,
  lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS,
  onOpenPlanningDay = null,
  onOpenMail = null,
  onOpenGrade = null,
}) {
  const now = useNow()
  const hasClasses = isWidgetAvailable('nextClass', establishment)
  const hasDeadlines = isWidgetAvailable('deadlines', establishment)
  const hasMail = isWidgetAvailable('mail', establishment)
  const hasGrades = GRADES_FEATURE_ENABLED && gradesSupported && isWidgetAvailable('latestGrade', establishment)

  const classes = useUpcomingClasses({ enabled: hasClasses, selection, sessionUser, lookaheadDays })
  const deadlines = useDeadlines(hasDeadlines)
  const mail = useRecentMail(hasMail)
  const grades = useGradedEvaluations(hasGrades, sessionUser)

  const classEvents = classes.status === 'ok' ? classes.events : null
  const agenda = useMemo(() => (classEvents ? pickAgendaDay(classEvents, now) : null), [classEvents, now])
  const dueItems = useMemo(() => buildDueList(deadlines.status === 'ok' ? deadlines.items : null, now), [deadlines, now])
  const gradeItems = useMemo(() => buildGradeList(grades.status === 'ok' ? grades.grades : null, grades.seenIds), [grades])
  const unreadItems = useMemo(() => buildUnreadList(mail.status === 'ok' ? mail.messages : null), [mail])

  return (
    <section className="home-draft-page w-full px-6 pt-8 pb-10 max-md:px-4 max-md:pt-5" aria-labelledby="home-draft-title">
      <div className="mx-auto grid max-w-[680px] gap-9 max-md:gap-7">
        <ServiceNotice />
        <h1 id="home-draft-title" className="m-0 font-display text-[28px] font-bold leading-[1.15] tracking-[-0.01em]">{formatTodayLabel(now)}</h1>
        {hasClasses ? <ClassesSection state={classes} agenda={agenda} now={now} onOpenPlanningDay={onOpenPlanningDay} /> : null}
        {hasDeadlines ? <DueSection state={deadlines} items={dueItems} fallbackHref={deadlines.moodleHref} /> : null}
        {hasGrades ? <GradesSection state={grades} items={gradeItems} onOpenGrade={onOpenGrade} /> : null}
        {hasMail ? <UnreadSection state={mail} items={unreadItems} now={now} onOpenMail={onOpenMail} /> : null}
      </div>
    </section>
  )
}

export default HomeDraftPage
