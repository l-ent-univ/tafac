import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { useWidgetLoadReport } from '../analytics'
import { publishBriefingSource } from '../briefingSources'
import { getMoodleDeadlines } from '../entApi'
import WidgetListStatus from './WidgetListStatus'
import {
  HOUR_MS,
  MINUTE_MS,
  SHIMMER_CLASSES,
  calendarDayDiff,
  formatClockTime,
  openInNewTab,
  parseDate,
  readStoredHref,
  storeHref,
} from './widgetListUtils'

const MAX_VISIBLE_DEADLINES = 2
const DEADLINES_REFRESH_MS = 5 * 60 * 1000
// Anything not handed in and due within this window counts as urgent.
const URGENT_WINDOW_MS = 48 * HOUR_MS
// Last Moodle URL the server gave us, so the card stays clickable when a
// later refresh fails (error payloads carry no moodleHref).
const MOODLE_HREF_KEY = 'l-ent:moodle-href'

// Phones: 44px rows (touch targets), hence the taller card there.
const CARD_CLASSES = 'moodle-deadlines-widget widget-card shadow-md flex-[0_1_360px] h-[140px] p-4 border border-white card-corners overflow-hidden bg-widget-bg text-base leading-6 min-w-0 max-2xl:flex-[1_1_calc(50%-6px)] max-2xl:min-w-0 max-md:h-[124px] max-md:p-3 max-xs:flex-[1_1_100%] max-xs:h-[140px] relative flex flex-col gap-[6px] text-text'
const ROW_CLASSES = 'grid grid-cols-[14px_minmax(0,1fr)_auto] content-center items-center gap-x-[7px] gap-y-[3px] h-[38px] px-1.5 corners-[10px] min-w-0 max-md:h-[36px] max-xs:h-11'

const TYPE_ICONS = {
  assign: 'carbon:document',
  quiz: 'carbon:list-checked',
  forum: 'carbon:forum',
  other: 'carbon:calendar',
}
const TYPE_LABELS = {
  assign: 'Devoir',
  quiz: 'Test',
  forum: 'Forum',
  other: 'Échéance',
}

const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })
const fullDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' })

// Outcome of the first load, for anonymous analytics (widget_loaded).
function getLoadOutcome(state) {
  if (state.status === 'ok') return { status: state.items.length > 0 ? 'ok' : 'empty' }
  if (state.status === 'error') return { status: 'error', errorKind: state.errorKind }
  if (state.status === 'unauthenticated') return { status: 'error', errorKind: 'other' }
  return null
}

function isOverdue(item, due, now) {
  return Boolean(item.overdue) || (due ? due.getTime() < now.getTime() : false)
}

// Handed-in work no longer needs attention once its deadline has passed;
// pending work comes first, already submitted work only fills spare rows.
function prioritizeDeadlines(items, now) {
  return items
    .map((item, index) => ({ item, index, due: parseDate(item.dueAt) }))
    .filter(({ item, due }) => !(item.submitted === true && isOverdue(item, due, now)))
    .sort((a, b) => Number(a.item.submitted === true) - Number(b.item.submitted === true) || a.index - b.index)
    .map(({ item }) => item)
}

function isUrgent(item, now) {
  if (item.submitted === true) return false
  const due = parseDate(item.dueAt)
  return isOverdue(item, due, now) || (due ? due.getTime() - now.getTime() < URGENT_WINDOW_MS : false)
}

// Relative, urgency-aware due label: "En retard", "Dans 25 min",
// "Aujourd'hui 23h59", "Demain 12h00", "Ven. 18h00", then "Dans 9 j".
// tone drives the colour: overdue (red), soon (< 48 h, amber), normal, muted.
function getDueInfo(item, now) {
  const due = parseDate(item.dueAt)
  const submitted = item.submitted === true
  if (!due) return { label: '', tone: 'muted', due: null }
  if (isOverdue(item, due, now)) {
    return { label: 'En retard', tone: submitted ? 'muted' : 'overdue', due }
  }

  const msLeft = due.getTime() - now.getTime()
  const dayDiff = calendarDayDiff(due, now)
  const time = formatClockTime(due)
  let label
  if (msLeft < HOUR_MS) {
    label = `Dans ${Math.max(1, Math.ceil(msLeft / MINUTE_MS))} min`
  } else if (dayDiff <= 0) {
    label = `Aujourd’hui ${time}`
  } else if (dayDiff === 1) {
    label = `Demain ${time}`
  } else if (dayDiff < 7) {
    const weekday = weekdayFormatter.format(due)
    label = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${time}`
  } else {
    label = `Dans ${dayDiff} j`
  }

  let tone = 'muted'
  if (!submitted) {
    if (msLeft < URGENT_WINDOW_MS) tone = 'soon'
    else if (dayDiff < 7) tone = 'normal'
  }
  return { label, tone, due }
}

const DUE_TONE_CLASSES = {
  overdue: 'deadline-due-overdue font-semibold',
  soon: 'deadline-due-soon font-semibold',
  normal: 'font-medium text-text-70',
  muted: 'font-medium text-text-muted',
}

function DeadlinesHeader({ urgentCount = 0, hasOverdue = false }) {
  return (
    <div className="flex items-center gap-[5px] min-w-0 pr-5">
      <span className="m-0 min-w-0 leading-[1.06] text-base font-medium text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[15px]">Échéances</span>
      {urgentCount > 0 ? (
        <span
          className={`deadline-pill ${hasOverdue ? 'deadline-pill-overdue' : ''} ml-[3px] inline-flex items-center justify-center min-w-[18px] h-[18px] px-[6px] rounded-full text-[11px] font-semibold leading-none tabular-nums shrink-0`}
          aria-label={`${urgentCount} à rendre sous 48 h`}
          title={hasOverdue ? 'En retard ou à rendre sous 48 h' : 'À rendre sous 48 h'}
        >
          {urgentCount > 99 ? '99+' : urgentCount}
        </span>
      ) : null}
    </div>
  )
}

function DeadlineRowsPlaceholder() {
  return (
    <div className="flex-1 flex flex-col gap-1 -mx-1.5" role="status" aria-label="Chargement des échéances">
      {[['w-[70%]', 'w-[46%]'], ['w-[56%]', 'w-[52%]']].map(([titleWidth, courseWidth]) => (
        <div key={titleWidth} className={ROW_CLASSES} aria-hidden="true">
          <span className={`text-placeholder-shimmer block w-3 h-3 corners-[4px] ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer block h-2.5 rounded-full ${titleWidth} ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer block h-2.5 w-14 rounded-full ${SHIMMER_CLASSES}`} />
          <span />
          <span className={`text-placeholder-shimmer block h-2 rounded-full col-span-2 ${courseWidth} ${SHIMMER_CLASSES}`} />
        </div>
      ))}
    </div>
  )
}

function DeadlineRow({ item, fallbackHref, now }) {
  const href = item.href || fallbackHref
  const title = item.title?.trim() || 'Échéance sans titre'
  const courseName = item.courseName?.trim() || ''
  const submitted = item.submitted === true
  const { label, tone, due } = getDueInfo(item, now)
  const typeLabel = TYPE_LABELS[item.type] ?? TYPE_LABELS.other
  const fullDate = due ? fullDateFormatter.format(due) : ''
  const ariaLabel = [
    `${typeLabel} : ${title}`,
    courseName,
    tone === 'overdue' ? `en retard, à rendre le ${fullDate}` : label,
    submitted ? 'rendu' : null,
  ].filter(Boolean).join(', ')
  const tooltip = [
    title,
    courseName,
    fullDate ? `À rendre : ${fullDate}` : null,
    submitted ? 'Rendu ✓' : null,
  ].filter(Boolean).join('\n')

  const content = (
    <>
      {submitted ? (
        <Icon icon="carbon:checkmark-filled" className="deadline-submitted-icon w-[14px] h-[14px] shrink-0" aria-hidden="true" />
      ) : (
        <Icon
          icon={TYPE_ICONS[item.type] ?? TYPE_ICONS.other}
          className={`w-[14px] h-[14px] shrink-0 ${tone === 'overdue' ? 'deadline-due-overdue' : 'text-text-muted'}`}
          aria-hidden="true"
        />
      )}
      <span className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] leading-[1.06] max-md:text-[14px] ${submitted ? 'font-medium text-text-muted' : 'font-semibold text-text'}`}>{title}</span>
      <span className={`text-[12px] leading-none tabular-nums whitespace-nowrap ${DUE_TONE_CLASSES[tone]}`}>{label}</span>
      <span className="col-start-2 col-span-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[1.06] text-text-muted">{courseName}</span>
    </>
  )

  if (!href) {
    return <li className={ROW_CLASSES} aria-label={ariaLabel} title={tooltip}>{content}</li>
  }

  return (
    <li className="min-w-0">
      <a
        className={`deadline-row ${ROW_CLASSES} no-underline text-inherit transition-[background-color] duration-[120ms] ease-in-out hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        title={tooltip}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </a>
    </li>
  )
}

// `preview`: a getMoodleDeadlines() result to show as is (the landing page,
// which changes it): nothing loaded or reported, no link to Moodle.
function WidgetDeadlines({ visible = false, preview = null }) {
  const [loadedState, setState] = useState({ status: 'loading', moodleHref: null, items: [] })
  const state = preview ?? loadedState
  const [storedMoodleHref, setStoredMoodleHref] = useState(() => readStoredHref(MOODLE_HREF_KEY))
  const [now, setNow] = useState(() => new Date())
  const lastLoadAtRef = useRef(0)
  const loadingRef = useRef(false)
  useWidgetLoadReport('deadlines', preview ? null : getLoadOutcome(state))

  const loadDeadlines = useCallback(async ({ background = false } = {}) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (!background) {
      setState((current) => ({ ...current, status: 'loading' }))
    }

    try {
      const result = await getMoodleDeadlines()
      lastLoadAtRef.current = Date.now()
      setNow(new Date())
      if (result.moodleHref) {
        storeHref(MOODLE_HREF_KEY, result.moodleHref)
        setStoredMoodleHref(result.moodleHref)
      }
      // Keep the last good list on a failed background refresh.
      setState((current) => (background && result.status === 'error' && current.status === 'ok' ? current : result))
    } finally {
      loadingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!preview) void loadDeadlines()
  }, [loadDeadlines, preview])

  // The greeting briefing reuses this list rather than asking Moodle again.
  useEffect(() => {
    publishBriefingSource('deadlines', state)
  }, [state])

  useEffect(() => () => publishBriefingSource('deadlines', null), [])

  // Badge count (due within 48 h), so the busier of mail and deadlines can go first.
  useEffect(() => {
    publishBriefingSource('deadlinesCount', state.status === 'ok'
      ? prioritizeDeadlines(state.items, now).filter((item) => isUrgent(item, now)).length
      : null)
  }, [state, now])

  useEffect(() => () => publishBriefingSource('deadlinesCount', null), [])

  useEffect(() => {
    if (state.status !== 'ok' && state.status !== 'error') return undefined

    // Relative labels ("Dans 25 min", "Demain") go stale between fetches.
    function refreshIfStale() {
      if (document.visibilityState !== 'visible') return
      setNow(new Date())
      if (!preview && Date.now() - lastLoadAtRef.current >= DEADLINES_REFRESH_MS) {
        void loadDeadlines({ background: true })
      }
    }

    const intervalId = window.setInterval(refreshIfStale, 60 * 1000)
    document.addEventListener('visibilitychange', refreshIfStale)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshIfStale)
    }
  }, [loadDeadlines, preview, state.status])

  // Hidden when Moodle can't be reached; the background refresh brings the
  // card back once it answers again.
  if (state.status === 'disabled' || state.status === 'unauthenticated' || state.status === 'error') {
    return null
  }

  const moodleHref = preview ? null : state.moodleHref || storedMoodleHref
  const pending = state.status === 'ok' ? prioritizeDeadlines(state.items, now) : []
  const rows = pending.slice(0, MAX_VISIBLE_DEADLINES)
  const urgentItems = pending.filter((item) => isUrgent(item, now))
  const urgentCount = urgentItems.length
  const hasOverdue = urgentItems.some((item) => isOverdue(item, parseDate(item.dueAt), now))
  const openMoodle = () => openInNewTab(moodleHref)

  return (
    <article
      className={`${CARD_CLASSES} ${moodleHref ? 'cursor-pointer' : ''} ${visible ? 'widget-card-visible' : ''}`}
      aria-label={urgentCount > 0 ? `Échéances Moodle, ${urgentCount} à rendre sous 48 h` : 'Échéances Moodle'}
      aria-busy={state.status === 'loading' || undefined}
      onClick={moodleHref ? openMoodle : undefined}
    >
      {moodleHref ? (
        <a
          className="deadline-corner-link absolute top-[10px] right-[10px] inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-text no-underline focus-visible:outline-2 focus-visible:outline-text max-md:top-2 max-md:right-2"
          href={moodleHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ouvrir Moodle"
          title="Ouvrir Moodle"
          onClick={(event) => event.stopPropagation()}
        >
          <Icon icon="carbon:arrow-up-right" className="w-[14px] h-[14px] shrink-0" aria-hidden="true" />
        </a>
      ) : null}

      <DeadlinesHeader urgentCount={urgentCount} hasOverdue={hasOverdue} />

      {state.status === 'loading' ? <DeadlineRowsPlaceholder /> : null}

      {state.status === 'ok' && rows.length > 0 ? (
        <ul className="flex-1 flex flex-col gap-1 min-h-0 m-0 p-0 list-none -mx-1.5" aria-label="Prochaines échéances Moodle">
          {rows.map((item, index) => (
            <DeadlineRow key={item.id ?? index} item={item} fallbackHref={moodleHref} now={now} />
          ))}
        </ul>
      ) : null}

      {state.status === 'ok' && rows.length === 0 ? (
        <WidgetListStatus icon="carbon:checkmark-outline" title="Aucune échéance à venir" body="Rien à rendre pour l’instant, profites-en !" />
      ) : null}

    </article>
  )
}

export default WidgetDeadlines
