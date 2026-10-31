import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { getBriefingSources, publishBriefingSource } from '../briefingSources'
import { buildDailyBriefing } from '../dailyBriefing'
import { isWidgetAvailable } from '../dashboardWidgets'
import { getGrades, getMoodleDeadlines, getRecentMail, listGradedEvaluations } from '../entApi'
import { accentStyle } from '../eventAccents'
import { GRADES_FEATURE_ENABLED } from '../gradeFeatureState'
import { buildHomeFeed, buildWeekStrip, formatHour, formatTodayLabel, pickAgendaDay } from '../homeDraft'
import { buildNavItems, openNavItemLink } from '../navItems'
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
// new home screen, to be reshaped by usage data. A draft, not the dashboard:
// the agenda, « À traiter » and the week strip read the same sources as the
// dashboard cards (and their caches); the blocks tagged « Exemple » are
// mock-ups with made-up content. Each wired block follows its feature's
// gating, as its dashboard card does, so it shows for every university and
// for the demo account (the server answers it).

// The next-class cache is fresh enough under this age (the dashboard card
// refreshes every 5 min while shown).
const CLASSES_REFRESH_MS = 10 * 60 * 1000
const NO_CLASSES = []
const CARD_CLASSES = 'widget-card widget-card-visible card-corners border shadow-md bg-widget-bg text-text min-w-0'

const FEED_ICONS = {
  deadline: 'carbon:task',
  grade: 'carbon:chart-pie',
  mail: 'carbon:email',
}

const FEED_KIND_LABELS = {
  deadline: 'Devoir',
  grade: 'Note',
  mail: 'Mail',
}

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

function DraftTag({ children = 'Exemple' }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-brand-subtle px-2 font-body text-[11px] font-semibold leading-none text-text-secondary">
      {children}
    </span>
  )
}

function CardHeader({ title, aside = null, tag = null }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <h2 className="m-0 min-w-0 truncate font-body text-base font-medium leading-[1.2] text-text-muted">{title}</h2>
      {tag}
      {aside ? <div className="ml-auto flex shrink-0 items-center gap-2">{aside}</div> : null}
    </div>
  )
}

function TextButton({ children, onClick, icon = 'carbon:arrow-right' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1 rounded-full border-0 bg-transparent px-2.5 font-body text-[13px] font-semibold text-text-secondary cursor-pointer transition-colors duration-150 hover:bg-brand-subtle hover:text-text"
    >
      {children}
      <Icon icon={icon} className="size-3.5" aria-hidden="true" />
    </button>
  )
}

function ShimmerRows({ count = 3 }) {
  return (
    <div className="grid gap-2" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={`h-12 corners-[14px] ${SHIMMER_CLASSES}`} />
      ))}
    </div>
  )
}

function EmptyLine({ icon, title, detail = null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-center" role="status">
      <Icon icon={icon} className="size-6 text-text-muted" aria-hidden="true" />
      <p className="m-0 font-body text-[15px] font-semibold text-text">{title}</p>
      {detail ? <p className="m-0 max-w-[300px] font-body text-[13px] font-medium leading-[1.35] text-text-muted">{detail}</p> : null}
    </div>
  )
}

function ShortcutRow({ items, onSelect }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label="Raccourcis">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="listitem"
          disabled={item.disabled}
          title={item.disabled ? item.disabledTitle : undefined}
          onClick={() => onSelect(item)}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-widget-bg px-4 font-body text-[15px] font-semibold text-text cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon icon={item.icon} className="size-[17px]" aria-hidden="true" />
          {item.label}
          {item.href ? <Icon icon="carbon:arrow-up-right" className="size-3 text-text-muted" aria-label="Ouvre un autre site" /> : null}
        </button>
      ))}
    </div>
  )
}

function AgendaCard({ state, agenda, now, onOpenPlanningDay }) {
  const accentFor = useEventAccents(agenda?.classes ?? NO_CLASSES)
  const title = agenda ? agenda.label : 'Aujourd’hui'
  const aside = onOpenPlanningDay
    ? <TextButton onClick={() => onOpenPlanningDay(agenda?.dayKey ?? null)}>Planning</TextButton>
    : null

  let body
  if (state.status === 'loading') {
    body = <ShimmerRows count={3} />
  } else if (state.status === 'unconfigured') {
    body = <EmptyLine icon="carbon:calendar-settings" title="Groupe non choisi" detail="Choisis ton groupe dans Mon compte pour voir tes cours" />
  } else if (state.status === 'error') {
    body = <EmptyLine icon="carbon:warning" title="Planning indisponible" detail="Réessaie dans quelques minutes" />
  } else if (!agenda) {
    body = <EmptyLine icon="carbon:calendar" title="Rien de prévu" detail="Aucun cours dans les deux prochaines semaines" />
  } else {
    body = (
      <ol className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
        {agenda.classes.map((item) => {
          const minutesToStart = Math.round((item.start - now) / 60000)
          const badge = item.status === 'now'
            ? 'En cours'
            : item.status === 'next' && agenda.isToday && minutesToStart <= 90
              ? `Dans ${minutesToStart} min`
              : null
          return (
            <li
              key={item.key}
              className={`relative flex items-stretch gap-3 corners-[16px] px-3 py-2.5 ${item.status === 'now' || item.status === 'next' ? 'bg-bg-subtle' : ''} ${item.status === 'past' ? 'opacity-50' : ''}`}
            >
              <div className="w-[64px] shrink-0 pt-px font-body tabular-nums">
                <p className="m-0 text-[15px] font-semibold leading-[1.2]">{formatHour(item.start)}</p>
                <p className="m-0 text-[12px] font-medium leading-[1.3] text-text-muted">{formatHour(item.end)}</p>
              </div>
              <span className="planning-accent-fill w-[4px] shrink-0 rounded-full" style={accentStyle(accentFor(item.title))} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate font-body text-[15px] font-semibold leading-[1.25]" title={item.title}>{item.title}</p>
                {item.location || item.teacher ? (
                  <p className="m-0 truncate font-body text-[13px] font-medium leading-[1.35] text-text-muted">
                    {[item.location, item.teacher].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
              </div>
              {badge ? (
                <span className="self-center shrink-0 rounded-full bg-brand px-2 py-0.5 font-body text-[11px] font-semibold leading-[1.4] text-bg">{badge}</span>
              ) : null}
            </li>
          )
        })}
      </ol>
    )
  }

  return (
    <article className={`${CARD_CLASSES} flex flex-col gap-3 p-5 max-md:p-4`} aria-label="Cours">
      <CardHeader title={title} aside={aside} />
      {agenda && !agenda.isToday && agenda.freeToday ? (
        <p className="m-0 -mt-1 font-body text-[13px] font-medium text-text-muted">Pas de cours aujourd’hui</p>
      ) : null}
      {body}
    </article>
  )
}

function FeedCard({ items, isLoading, sources, now, onOpenItem }) {
  return (
    <article className={`${CARD_CLASSES} flex flex-col gap-3 p-5 max-md:p-4`} aria-label="À traiter">
      <CardHeader
        title="À traiter"
        aside={items.length ? <span className="font-body text-[13px] font-semibold tabular-nums text-text-muted">{items.length}</span> : null}
      />
      {isLoading && items.length === 0 ? (
        <ShimmerRows count={3} />
      ) : items.length === 0 ? (
        <EmptyLine icon="carbon:checkmark-outline" title="Rien à traiter" detail="Devoirs, nouvelles notes et mails non lus s’affichent ici" />
      ) : (
        <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1 p-0">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenItem(item)}
                className="flex w-full items-center gap-3 corners-[16px] border-0 bg-transparent px-3 py-2.5 text-left text-text cursor-pointer transition-colors duration-150 hover:bg-bg-subtle"
              >
                <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${item.urgent ? 'bg-error-bg text-error' : 'bg-brand-subtle text-text'}`}>
                  <Icon icon={FEED_ICONS[item.kind]} className="size-[17px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-[15px] font-semibold leading-[1.25]">{item.title}</span>
                  <span className="block truncate font-body text-[13px] font-medium leading-[1.35] text-text-muted">
                    {[FEED_KIND_LABELS[item.kind], item.detail].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={`shrink-0 font-body text-[13px] font-semibold tabular-nums ${item.urgent ? 'text-error' : 'text-text-muted'}`}>
                  {item.kind === 'mail' ? formatReceivedAt(item.receivedAt, now) : item.meta}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {sources.length ? (
        <p className="m-0 mt-auto font-body text-[12px] font-medium text-text-muted">Sources : {sources.join(', ')}</p>
      ) : null}
    </article>
  )
}

function WeekStripCard({ days, onOpenPlanningDay }) {
  return (
    <article className={`${CARD_CLASSES} flex flex-col gap-3 p-5 max-md:p-4`} aria-label="Sept prochains jours">
      <CardHeader title="Sept prochains jours" />
      <ol className="m-0 grid list-none grid-cols-7 gap-1.5 p-0 max-md:grid-cols-4">
        {days.map((day) => {
          const content = (
            <>
              <span className="font-body text-[12px] font-semibold text-text-muted">{day.weekday}</span>
              <span className="font-display text-[22px] font-bold leading-none tabular-nums">{day.dayNumber}</span>
              <span className="font-body text-[12px] font-semibold leading-[1.3]">
                {day.classCount ? `${day.classCount} cours` : 'Libre'}
              </span>
              <span className="font-body text-[11px] font-medium leading-[1.3] text-text-muted tabular-nums">
                {day.classCount ? `${day.firstStart} – ${day.lastEnd}` : ' '}
              </span>
              {day.deadlineCount ? (
                <span className="mt-0.5 inline-flex items-center gap-1 font-body text-[11px] font-semibold text-error">
                  <span className="size-1.5 rounded-full bg-error" aria-hidden="true" />
                  {day.deadlineCount} devoir{day.deadlineCount > 1 ? 's' : ''}
                </span>
              ) : null}
            </>
          )
          const className = `flex h-full w-full flex-col items-start gap-1 corners-[16px] border px-2.5 py-2.5 text-left text-text ${day.isToday ? 'border-brand/25 bg-bg-subtle' : 'border-border bg-transparent'}`
          return (
            <li key={day.dayKey}>
              {onOpenPlanningDay ? (
                <button type="button" onClick={() => onOpenPlanningDay(day.dayKey)} className={`${className} cursor-pointer transition-colors duration-150 hover:bg-bg-subtle`}>
                  {content}
                </button>
              ) : (
                <div className={className}>{content}</div>
              )}
            </li>
          )
        })}
      </ol>
    </article>
  )
}

// Mock-ups: blocks the dashboard doesn't have, to try out on the canvas.
// Made-up content, tagged « Exemple ».
function MockCards() {
  return (
    <>
      <article className={`${CARD_CLASSES} flex flex-col gap-2 p-5 max-md:p-4`} aria-label="Restau U (exemple)">
        <CardHeader title="Restau U" tag={<DraftTag />} />
        <p className="m-0 font-body text-[17px] font-semibold leading-[1.25]">Lasagnes végétariennes</p>
        <p className="m-0 font-body text-[13px] font-medium text-text-muted">Ouvert jusqu’à 14h · 3,30 €</p>
      </article>
      <article className={`${CARD_CLASSES} flex flex-col gap-2 p-5 max-md:p-4`} aria-label="Salles libres (exemple)">
        <CardHeader title="Salles libres" tag={<DraftTag />} />
        <p className="m-0 font-body text-[17px] font-semibold leading-[1.25]">B12, B14, C03</p>
        <p className="m-0 font-body text-[13px] font-medium text-text-muted">Libres jusqu’à 15h30</p>
      </article>
      <article className="card-corners flex flex-col items-start justify-center gap-1.5 border border-dashed border-border-input p-5 text-text max-md:p-4" aria-label="Emplacement libre">
        <Icon icon="carbon:add-large" className="size-5 text-text-muted" aria-hidden="true" />
        <p className="m-0 font-body text-[15px] font-semibold">Emplacement libre</p>
        <p className="m-0 font-body text-[13px] font-medium text-text-muted">À remplir d’après les données d’usage</p>
      </article>
    </>
  )
}

function HomeDraftPage({
  userName = '',
  sessionUser = null,
  establishment = null,
  gradesSupported = true,
  selection = null,
  lookaheadDays = NEXT_CLASS_LOOKAHEAD_DAYS,
  onNavigatePage = null,
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
  const deadlineItems = deadlines.status === 'ok' ? deadlines.items : null
  const agenda = useMemo(() => (classEvents ? pickAgendaDay(classEvents, now) : null), [classEvents, now])
  const weekDays = useMemo(() => buildWeekStrip(classEvents ?? [], deadlineItems ?? [], now), [classEvents, deadlineItems, now])
  const feed = useMemo(() => buildHomeFeed({
    deadlines: deadlineItems,
    mails: mail.status === 'ok' ? mail.messages : null,
    grades: grades.status === 'ok' ? grades.grades : null,
    seenGradeIds: grades.seenIds,
    now,
  }), [deadlineItems, grades, mail, now])
  const briefing = useMemo(() => buildDailyBriefing({
    classes: classEvents ? { events: classEvents, complete: classes.complete } : null,
    deadlines: deadlineItems,
    now,
  }), [classEvents, classes.complete, deadlineItems, now])

  const isFeedLoading = [deadlines, mail, grades].some((state) => state.status === 'loading')
  const feedSources = [
    hasDeadlines ? 'Moodle' : null,
    hasGrades ? 'Mes notes' : null,
    hasMail ? 'Messagerie' : null,
  ].filter(Boolean)
  // Without any of its sources (a university with none of them), no card.
  const hasFeed = feedSources.length > 0

  // The sidebar's own items (already gated per university), this page and
  // the dashboard's scroll target aside.
  const shortcuts = buildNavItems(establishment, { gradesSupported })
    .filter((item) => item.id !== 'home' && item.id !== 'applications')
  const handleShortcut = (item) => {
    if (item.disabled) return
    if (item.href) {
      openNavItemLink(item, 'home')
      return
    }
    if (item.page) onNavigatePage?.(item.page, 'other')
  }

  const handleOpenFeedItem = (item) => {
    if (item.kind === 'deadline') {
      openInNewTab(item.source?.href || deadlines.moodleHref)
      return
    }
    if (item.kind === 'grade') {
      if (onOpenGrade) onOpenGrade(item.source)
      else onNavigatePage?.('grades', 'other')
      return
    }
    if (item.kind === 'mail') {
      if (onOpenMail && item.source?.id) onOpenMail(item.source.id)
      else openInNewTab(item.source?.href || mail.webmailHref)
    }
  }

  const displayName = userName?.trim()
  const showWeekStrip = hasClasses || hasDeadlines

  return (
    <section className="home-draft-page w-full grid gap-4 pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5 max-md:gap-3" aria-labelledby="home-draft-title">
      <div className="page-top-band grid gap-4 -mx-6 -mt-4 px-6 pt-4 pb-6 4xl:-mt-5 4xl:pt-5 max-md:-mx-3 max-md:-mt-3 max-md:gap-3 max-md:px-3 max-md:pt-5 max-md:pb-4">
        <ServiceNotice />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 id="home-draft-title" className="m-0 text-2xl font-bold leading-[1.15] max-md:text-[26px] max-md:tracking-[-0.01em]">Accueil</h1>
          <DraftTag>Brouillon</DraftTag>
          <p className="m-0 ml-auto font-body text-[15px] font-medium text-text-muted">{formatTodayLabel(now)}</p>
        </div>
        <div className="grid gap-1">
          <p className="m-0 font-display text-[34px] font-bold leading-[1.1] tracking-[-0.01em] max-md:text-[28px]">
            {displayName ? `Salut ${displayName}` : 'Salut'}
          </p>
          {briefing ? (
            <p className="m-0 font-body text-[17px] font-medium leading-[1.35] text-text-secondary max-md:text-[15px]">{briefing}</p>
          ) : null}
        </div>
        <ShortcutRow items={shortcuts} onSelect={handleShortcut} />
      </div>

      {hasClasses || hasFeed ? (
        <div className={`grid gap-4 max-md:gap-3 ${hasClasses && hasFeed ? 'xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : ''}`}>
          {hasClasses ? <AgendaCard state={classes} agenda={agenda} now={now} onOpenPlanningDay={onOpenPlanningDay} /> : null}
          {hasFeed ? <FeedCard items={feed} isLoading={isFeedLoading} sources={feedSources} now={now} onOpenItem={handleOpenFeedItem} /> : null}
        </div>
      ) : null}

      {showWeekStrip ? <WeekStripCard days={weekDays} onOpenPlanningDay={onOpenPlanningDay} /> : null}

      <div className="grid gap-4 max-md:gap-3 xl:grid-cols-3">
        <MockCards />
      </div>
    </section>
  )
}

export default HomeDraftPage
