import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import calendarIcon from '../assets/home-icons/calendar.png'
import personIcon from '../assets/home-icons/person.png'
import { buildAbsenceReport, buildGradesReport, formatDuration, summarizeAbsencesBySubject } from '../gradesReport'
import {
  buildSemesterTimeline,
  countAbsencesByStatus,
  findEvaluationsDuringAbsences,
  formatTimeLeft,
  groupAbsencesByMonth,
  listOpenJustifications,
  parseDay,
  readJustificationWindow,
  sumAbsenceHours,
} from '../assiduity'
import { ABSENCE_STATUS_LABELS } from '../absenceMail'
import { trackAssiduityAction, trackJustifyStep, useAssiduityPageReport } from '../analytics'
import { advanceJustifyReach, describeAssiduityLoad, toAssiduityPageSource } from '../assiduityAnalytics'
import { assignSubjectIcons } from '../subjectIcons'
import { copyToClipboard, useContextMenu } from '../useContextMenu'
import { useHistorySheet } from '../useHistorySheet'
import { useScodocReleve } from '../useScodocReleve'
import { GradesNotice } from './GradesNotice'
import JustifyAbsenceSheet from './JustifyAbsenceSheet'
import LoadingDots from './LoadingDots'
import PageEmptyState from './PageEmptyState'
import SemesterSelect from './SemesterSelect'
import ServiceNotice from './ServiceNotice'
import { r } from '../register.js'

// « Assiduité »: the absences and lateness ScoDoc holds for the semester
// picked next to the title (shared with « Mes notes »), from the relevé's
// absence report (buildAbsenceReport, the passerelle's rules). At the top,
// the totals and the semester as a line, each absence a mark on it; then
// what is still to justify (when the department's notice gives a delay),
// the hours per subject, the full list. A mark, or a subject, leads to its
// absences in the list.

const CARD = 'widget-card widget-card-visible shadow-md border border-white card-corners bg-widget-bg text-text min-w-0'
const SECTION_TITLE = 'flex items-center gap-[5px] text-brand'
const DAY_SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
const DAY_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const RANGE_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

// How each status reads: its pill, its mark on the semester line.
const STATUS_STYLES = {
  unjustified: { pill: 'bg-error-bg text-error border-transparent', icon: 'ph:warning-circle' },
  justified: { pill: 'bg-bg-subtle text-text-secondary border-border', icon: 'ph:check-circle' },
  late: { pill: 'bg-transparent text-text-secondary border-dashed border-border-input', icon: 'ph:clock' },
}

const FILTERS = [
  { value: 'all', label: 'Toutes' },
  { value: 'unjustified', label: 'Non justifiées' },
  { value: 'justified', label: 'Justifiées' },
  { value: 'late', label: 'Retards' },
]

const capitalize = (text) => (text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text)

function formatDay(value, format = DAY_SHORT) {
  const day = parseDay(value)
  return day ? format.format(day).replace('.', '') : ''
}

function describeEntry(entry) {
  return [
    capitalize(formatDay(entry.date, DAY_LONG)),
    `${entry.start} – ${entry.end}`,
    entry.subjectTitle,
    ABSENCE_STATUS_LABELS[entry.status],
  ].filter(Boolean).join(', ')
}

// The time, once a minute: the countdowns stay true while the page is open.
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function SectionTitle({ id, icon, children, count = null }) {
  return (
    <div className={SECTION_TITLE}>
      <Icon icon={icon} className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
      <h2 id={id} className="m-0 font-body text-base font-medium leading-[1.06]">{children}</h2>
      {count != null ? <span className="font-body text-[14px] font-medium leading-[1.06] text-text-muted">{count}</span> : null}
    </div>
  )
}

function StatusPill({ status, className = '' }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.justified
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-[9px] py-[5px] font-body text-[12px] font-semibold leading-none ${style.pill} ${className}`}>
      <Icon icon={style.icon} className="size-[13px]" aria-hidden="true" />
      {ABSENCE_STATUS_LABELS[status]}
    </span>
  )
}

// The semester's totals: the hours not justified first (what may cost
// something), then the justified ones and the lateness; under them, the
// hours missed as one bar split by status.
function TotalsCard({ totals, sums, counts }) {
  const missed = sums.justified + sums.unjustified
  const figures = [
    { key: 'unjustified', label: 'Non justifiées', value: totals?.unjustified ?? String(counts.unjustified), tone: sums.unjustified > 0 || counts.unjustified > 0 ? 'text-error' : 'text-text' },
    { key: 'justified', label: 'Justifiées', value: totals?.justified ?? String(counts.justified), tone: 'text-text' },
    { key: 'late', label: counts.late > 1 ? 'Retards' : 'Retard', value: totals?.late ?? String(counts.late), tone: 'text-text' },
  ]
  const unjustifiedShare = missed > 0 ? (sums.unjustified / missed) * 100 : 0

  return (
    <article className={`${CARD} flex flex-[1_1_300px] flex-col gap-4 p-4 md:max-w-[443px] max-md:p-3`} aria-labelledby="assiduity-totals-title">
      <div className="flex items-center gap-[5px] min-w-0">
        <img src={personIcon} alt="" width="22" height="22" draggable="false" className="mr-[3px] size-[22px] shrink-0 select-none" aria-hidden="true" />
        <h2 id="assiduity-totals-title" className="m-0 min-w-0 truncate text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Ce semestre</h2>
        {missed > 0 ? (
          <span className="ml-auto shrink-0 font-body text-[13px] font-medium leading-none text-text-muted">{formatDuration(missed)} manquées</span>
        ) : null}
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3 max-md:gap-2">
        {figures.map((figure) => (
          <div key={figure.key} className="flex min-w-0 flex-col gap-[6px]">
            <dt className="truncate font-body text-[13px] font-semibold leading-none text-text-muted">{figure.label}</dt>
            <dd className={`m-0 truncate font-display text-[34px] font-bold leading-none max-md:text-[clamp(24px,7.5vw,30px)] ${figure.tone}`}>{figure.value}</dd>
          </div>
        ))}
      </dl>
      {/* The hours missed, the unjustified part in red. */}
      {missed > 0 ? (
        <div className="relative h-[6px] overflow-hidden rounded-full bg-brand-subtle" aria-hidden="true">
          <span className="assiduity-bar absolute inset-y-0 left-0 rounded-full bg-text-30" style={{ width: '100%' }} />
          <span className="assiduity-bar absolute inset-y-0 left-0 rounded-full bg-error" style={{ width: `${unjustifiedShare}%` }} />
        </div>
      ) : null}
    </article>
  )
}

// The semester from its first day to its last, months under it, the part
// gone shaded up to today, each absence a mark on its day (a red dot not
// justified, a soft one justified, a ring for a lateness; a day's marks
// stacked). A mark leads to its absence in the list.
// A pointer picks the mark nearest to it on the whole line (marks a few
// days apart sit closer than a finger); the marks' own buttons are for the
// keyboard and screen readers.
const MARK_REACH = 24
const markBottom = (mark) => 9 + mark.stack * 11

function SemesterLine({ timeline, entriesById, onPick, activeId }) {
  const [hovered, setHovered] = useState(null)
  const trackRef = useRef(null)
  const nearestMark = (event) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return null
    let best = null
    for (const mark of timeline.marks) {
      const x = rect.left + (mark.position / 100) * rect.width
      const y = rect.bottom - markBottom(mark) - 5
      const distance = Math.hypot(event.clientX - x, event.clientY - y)
      if (distance <= MARK_REACH && (!best || distance < best.distance)) best = { id: mark.id, distance }
    }
    return best?.id ?? null
  }
  const shown = hovered ? entriesById.get(hovered) : null
  const markPosition = hovered ? timeline.marks.find((mark) => mark.id === hovered)?.position ?? 50 : 50

  return (
    <article className={`${CARD} flex flex-[3_1_380px] flex-col gap-3 p-4 max-md:flex-[1_1_100%] max-md:p-3`} aria-labelledby="assiduity-line-title">
      <div className="flex items-center gap-[5px] min-w-0">
        <img src={calendarIcon} alt="" width="22" height="22" draggable="false" className="mr-[3px] size-[22px] shrink-0 select-none" aria-hidden="true" />
        <h2 id="assiduity-line-title" className="m-0 min-w-0 truncate text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Au fil du semestre</h2>
        <span className="ml-auto shrink-0 font-body text-[13px] font-medium leading-none text-text-muted">
          {RANGE_DAY.format(timeline.start).replace('.', '')} – {RANGE_DAY.format(timeline.end).replace('.', '')}
        </span>
      </div>
      <div className="relative my-auto px-[6px]">
        {/* The mark hovered or focused, said above the line. */}
        <div className="relative h-[30px]" aria-hidden="true">
          {shown ? (
            <span
              className="assiduity-line-tip absolute bottom-[6px] max-w-[min(260px,100%)] -translate-x-1/2 truncate rounded-full border border-border bg-context-bg px-2.5 py-[6px] font-body text-[12px] font-semibold leading-none text-text shadow-md"
              style={{ left: `clamp(70px, ${markPosition}%, calc(100% - 70px))` }}
            >
              {capitalize(formatDay(shown.date))} · {shown.start} · {shown.subjectTitle ?? ABSENCE_STATUS_LABELS[shown.status]}
            </span>
          ) : null}
        </div>
        <div
          ref={trackRef}
          className={`relative h-[38px] ${hovered ? 'cursor-pointer' : ''}`}
          onPointerMove={(event) => setHovered(nearestMark(event))}
          onPointerLeave={() => setHovered(null)}
          onClick={(event) => {
            // A mark's button activated from the keyboard: already handled.
            if (event.detail === 0) return
            const id = nearestMark(event)
            if (id) onPick(id)
          }}
        >
          {/* The track, the part of the semester gone, today. */}
          <span className="absolute inset-x-0 bottom-[10px] h-[4px] rounded-full border border-dashed border-border-input" aria-hidden="true" />
          <span className="assiduity-elapsed absolute left-0 bottom-[10px] h-[4px] rounded-full bg-brand-subtle" style={{ width: `${timeline.elapsed}%` }} aria-hidden="true" />
          {timeline.today != null ? (
            <span className="absolute bottom-[4px] flex -translate-x-1/2 flex-col items-center" style={{ left: `${timeline.today}%` }} aria-hidden="true">
              <span className="h-[16px] w-[2px] rounded-full bg-brand" />
            </span>
          ) : null}
          <ul className="m-0 list-none p-0" aria-label="Absences sur le semestre">
            {timeline.marks.map((mark, index) => {
              const entry = entriesById.get(mark.id)
              return (
                <li key={mark.id} className="absolute" style={{ left: `${mark.position}%`, bottom: `${markBottom(mark)}px` }}>
                  <button
                    type="button"
                    className={`assiduity-mark is-${mark.status} ${activeId === mark.id || hovered === mark.id ? 'is-active' : ''}`}
                    style={{ '--mark-order': index }}
                    aria-label={entry ? describeEntry(entry) : mark.date}
                    onFocus={() => setHovered(mark.id)}
                    onBlur={() => setHovered((current) => (current === mark.id ? null : current))}
                    onClick={(event) => {
                      if (event.detail === 0) onPick(mark.id)
                    }}
                  />
                </li>
              )
            })}
          </ul>
        </div>
        {/* Month names under the line, where each starts. */}
        <div className="relative h-[14px]" aria-hidden="true">
          {timeline.months.map((month) => (
            <span
              key={month.key}
              className="absolute top-0 whitespace-nowrap font-body text-[11px] font-semibold uppercase leading-none tracking-[0.04em] text-text-muted"
              style={{ left: `${month.position}%` }}
            >
              {month.label}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}

// Time left on one unjustified absence, as a ring that empties.
function CountdownRing({ share }) {
  const radius = 17
  const length = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="20" cy="20" r={radius} fill="none" strokeWidth="4" className="stroke-error-bg" />
      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        className="assiduity-ring stroke-error"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - Math.max(0.03, share))}
      />
    </svg>
  )
}

// The unjustified absences the department's delay still covers, soonest
// first: how long is left, until when.
// A card opens « Justifier » (`canJustify`), else its absence in the list.
function ToJustify({ open, subjectIcon, canJustify: offersJustify, onPick }) {
  return (
    <section className="grid gap-3" aria-labelledby="assiduity-justify-title">
      <SectionTitle id="assiduity-justify-title" icon="ph:hourglass-medium">À justifier</SectionTitle>
      <ul className="m-0 flex list-none gap-3 overflow-x-auto snap-x snap-mandatory -mx-6 px-6 scroll-px-6 pt-2 pb-7 -mt-2 -mb-7 favorites-scroll-hide max-md:gap-2 max-md:-mx-3 max-md:px-3 max-md:scroll-px-3">
        {open.map(({ entry, deadline, hoursLeft, share }) => (
          <li key={entry.id} className="flex w-[300px] shrink-0 snap-start max-md:w-[272px]">
            <button
              type="button"
              onClick={() => onPick(entry)}
              className={`${CARD} flex w-full cursor-pointer items-center gap-3 p-3 text-left`}
            >
              <CountdownRing share={share} />
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span className="font-display text-[19px] font-bold leading-[1.1] text-error">{formatTimeLeft(hoursLeft)}</span>
                <span className="flex min-w-0 items-center gap-[5px] font-body text-[13px] font-semibold leading-[1.3] text-text-secondary">
                  {subjectIcon(entry.subjectTitle) ? <Icon icon={subjectIcon(entry.subjectTitle)} className="size-[14px] shrink-0" aria-hidden="true" /> : null}
                  <span className="truncate">{entry.subjectTitle ?? 'Absence'}</span>
                </span>
                <span className="font-body text-[12px] font-medium leading-[1.3] text-text-muted">
                  Jusqu’au {DAY_SHORT.format(deadline).replace('.', '')} à {deadline.getHours()}h{String(deadline.getMinutes()).padStart(2, '0')}
                </span>
              </span>
              {offersJustify ? (
                <span className="ml-auto inline-flex h-[30px] shrink-0 items-center gap-1 self-center rounded-full bg-brand px-3 text-bg" aria-hidden="true">
                  <span className="font-body text-[13px] font-semibold leading-none">Justifier</span>
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Hours missed per subject, most first, the unjustified part in red; a
// subject narrows the list below to its absences.
function SubjectBreakdown({ subjects, subjectIcon, selected, onSelect }) {
  const maxHours = Math.max(...subjects.map((subject) => subject.hours), 0.0001)
  return (
    <section className="grid gap-3" aria-labelledby="assiduity-subjects-title">
      <SectionTitle id="assiduity-subjects-title" icon="ph:books">Par matière</SectionTitle>
      <ul className={`${CARD} m-0 grid list-none gap-0 p-2`}>
        {subjects.map((subject) => {
          const isSelected = selected === subject.key
          const icon = subjectIcon(subject.subject)
          const details = [
            subject.count ? `${subject.count} absence${subject.count > 1 ? 's' : ''}` : null,
            subject.late ? `${subject.late} retard${subject.late > 1 ? 's' : ''}` : null,
          ].filter(Boolean).join(' · ')
          return (
            <li key={subject.key}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(isSelected ? null : subject.key)}
                className={`assiduity-subject flex w-full cursor-pointer items-center gap-3 rounded-[14px] border-0 p-2 text-left text-text transition-colors ${isSelected ? 'bg-brand-subtle' : 'bg-transparent hover:bg-bg-subtle'}`}
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-text" aria-hidden="true">
                  <Icon icon={icon ?? 'ph:book'} className="size-[18px]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 truncate font-body text-[15px] font-semibold leading-[1.2]">{subject.subject}</span>
                    {subject.moduleCode ? <span className="shrink-0 font-body text-[12px] font-medium text-text-muted max-xs:hidden">{subject.moduleCode}</span> : null}
                    <span className="ml-auto shrink-0 font-display text-[16px] font-bold leading-none">
                      {subject.hours > 0 ? formatDuration(subject.hours) : '—'}
                    </span>
                  </span>
                  {subject.hours > 0 ? (
                    <span className="relative block h-[4px] overflow-hidden rounded-full bg-brand-subtle" aria-hidden="true">
                      <span className="assiduity-bar absolute inset-y-0 left-0 rounded-full bg-text-30" style={{ width: `${(subject.hours / maxHours) * 100}%` }} />
                      <span className="assiduity-bar absolute inset-y-0 left-0 rounded-full bg-error" style={{ width: `${(subject.unjustifiedHours / maxHours) * 100}%` }} />
                    </span>
                  ) : null}
                  <span className="flex min-w-0 items-center gap-2 font-body text-[12px] font-medium leading-none text-text-muted">
                    <span className="truncate">{details}</span>
                    {subject.unjustifiedHours > 0 ? (
                      <span className="ml-auto shrink-0 font-semibold text-error">dont {formatDuration(subject.unjustifiedHours)} non justifiée{subject.unjustifiedHours > 1 ? 's' : ''}</span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Whether « Justifier » is offered: an absence not justified, a lateness.
const canJustify = (entry) => entry.status === 'unjustified' || entry.status === 'late'

// One absence of the list: its day, its hours, its subject and teacher,
// its status; the evaluations held meanwhile and what they became;
// « Justifier » when it isn't, the walkthrough that writes the mail
// (JustifyAbsenceSheet).
function AbsenceRow({ entry, icon, evaluations, highlighted, menuProps, onJustify }) {
  const day = parseDay(entry.date)
  return (
    <li
      id={`absence-${entry.id}`}
      {...menuProps(entry.id)}
      className={`assiduity-row flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0 ${highlighted ? 'is-highlighted' : ''}`}
    >
      <span className="flex w-[40px] shrink-0 flex-col items-center pt-[2px] leading-none" aria-hidden="true">
        <span className="font-display text-[22px] font-bold text-text">{day ? day.getDate() : '—'}</span>
        <span className="mt-1 font-body text-[11px] font-semibold uppercase text-text-muted">{day ? day.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '') : ''}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <span className="sr-only">{capitalize(formatDay(entry.date, DAY_LONG))}</span>
        <span className="flex min-w-0 items-center gap-[6px]">
          {icon ? <Icon icon={icon} className="size-4 shrink-0 text-text-secondary" aria-hidden="true" /> : null}
          <span className="min-w-0 truncate font-body text-[15px] font-semibold leading-[1.25] text-text" title={entry.subject ?? undefined}>{entry.subjectTitle ?? 'Matière non précisée'}</span>
        </span>
        <span className="font-body text-[13px] font-medium leading-[1.3] text-text-secondary">
          {entry.start} – {entry.end}
          {entry.status !== 'late' && entry.hours > 0 ? ` · ${formatDuration(entry.hours)}` : ''}
          {entry.endDate ? ` · jusqu’au ${formatDay(entry.endDate)}` : ''}
          {entry.teacher ? ` · ${entry.teacher}` : ''}
        </span>
        {evaluations?.length ? (
          <span className="flex flex-wrap gap-1.5 pt-[2px]">
            {evaluations.map((evaluation) => (
              <span key={evaluation.id} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-bg-subtle px-2 py-[4px] font-body text-[12px] font-medium leading-none text-text-secondary">
                <Icon icon="ph:exam" className="size-[13px] shrink-0" aria-hidden="true" />
                <span className="truncate">{evaluation.description}</span>
                <span className="shrink-0 font-semibold text-text">· {evaluation.grade.kind === 'number' ? `${evaluation.grade.label}/20` : evaluation.grade.label}</span>
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 max-xs:flex-col max-xs:items-end">
        <StatusPill status={entry.status} />
        {onJustify && canJustify(entry) ? (
          // Its touch area 44px past the drawn 30px.
          <button
            type="button"
            onClick={() => onJustify(entry)}
            aria-label={`Justifier ${entry.status === 'late' ? 'ce retard' : 'cette absence'} du ${formatDay(entry.date, DAY_LONG)}`}
            className="justify-button relative inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full border-0 bg-brand px-3 text-bg after:absolute after:-inset-[7px]"
          >
            <Icon icon="ph:seal-check" className="size-[15px]" aria-hidden="true" />
            <span className="font-body text-[13px] font-semibold leading-none">Justifier</span>
          </button>
        ) : null}
      </div>
    </li>
  )
}

function AbsenceHistory({ entries, filter, onFilter, subject, onClearSubject, highlightId, subjectIcon, evaluationsByEntry, onJustify }) {
  const counts = useMemo(() => countAbsencesByStatus(entries), [entries])
  const bySubject = subject ? entries.filter((entry) => (entry.moduleCode ?? entry.subjectTitle ?? entry.subject ?? '') === subject.key) : entries
  const visible = filter === 'all' ? bySubject : bySubject.filter((entry) => entry.status === filter)
  const options = FILTERS.filter((option) => option.value === 'all' || counts[option.value] > 0)
  const menuProps = useContextMenu((key) => {
    const entry = entries.find((item) => item.id === key)
    if (!entry) return null
    return [
      onJustify && canJustify(entry) ? { id: 'justify', label: 'Justifier', icon: 'ph:seal-check', onSelect: () => onJustify(entry, 'menu') } : null,
      { id: 'copy', label: 'Copier', icon: 'ph:copy', onSelect: () => void copyToClipboard(describeEntry(entry)) },
    ].filter(Boolean)
  })

  return (
    <section className="grid gap-3" aria-labelledby="assiduity-history-title">
      <SectionTitle id="assiduity-history-title" icon="ph:clock-counter-clockwise" count={visible.length}>Historique</SectionTitle>
      {options.length > 2 || subject ? (
        <div className="-mx-6 flex gap-2 overflow-x-auto px-6 favorites-scroll-hide max-md:-mx-3 max-md:px-3" role="group" aria-label="Filtrer les absences">
          {subject ? (
            <button
              type="button"
              onClick={onClearSubject}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-brand px-3 py-[7px] font-body text-[13px] font-semibold leading-none text-bg"
              aria-label={`Retirer le filtre ${subject.subject}`}
            >
              <span className="font-body text-[13px] font-semibold leading-none">{subject.subject}</span>
              <Icon icon="ph:x-bold" className="size-[12px]" aria-hidden="true" />
            </button>
          ) : null}
          {options.length > 2 ? options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => onFilter(option.value)}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-[7px] font-body text-[13px] font-semibold leading-none transition-colors ${filter === option.value ? 'border-transparent bg-brand-subtle text-text' : 'border-border bg-transparent text-text-secondary hover:bg-bg-subtle'}`}
            >
              <span className="font-body text-[13px] font-semibold leading-none">{option.label}</span>
              <span className="font-body text-[13px] font-medium leading-none text-text-muted">{counts[option.value]}</span>
            </button>
          )) : null}
        </div>
      ) : null}
      {visible.length ? (
        <div className={`${CARD} overflow-hidden p-0`}>
          {groupAbsencesByMonth(visible).map((group) => (
            <div key={group.key}>
              <h3 className="m-0 border-b border-border bg-bg-subtle/60 px-3 py-2 font-body text-[13px] font-semibold text-text-secondary">{group.label}</h3>
              <ul className="m-0 list-none p-0">
                {group.entries.map((entry) => (
                  <AbsenceRow
                    key={entry.id}
                    entry={entry}
                    icon={subjectIcon(entry.subjectTitle)}
                    evaluations={evaluationsByEntry[entry.id]}
                    highlighted={highlightId === entry.id}
                    menuProps={menuProps}
                    onJustify={onJustify}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 font-body text-[14px] font-medium text-text-muted">Rien avec ces filtres</p>
      )}
    </section>
  )
}

// `onComposeMail(request)`: App's, the mail page opened on a prefilled
// composer (« Justifier »); null without the in-app mail page, and the
// action isn't offered. `absenceReasons`: the establishment's own reasons
// for « Justifier » (client.js › establishments.byId, `absenceReasons`).
// `findsClassTeacher`: the in-app Planning, where the composer looks for
// the teacher of an absence's class (Cc) when ScoDoc names none.
// `arrivalSource`: how the student got here, for the anonymous analytics
// (src/assiduityAnalytics.js); the page mounts once per arrival.
function AssiduityPage({ arrivalSource = 'other', onComposeMail = null, absenceReasons = [], findsClassTeacher = false }) {
  const { base, semesters, activeId, selectSemester, entry, releve, config } = useScodocReleve()
  const status = base.status === 'error' ? base : entry
  const now = useMinuteClock()
  const absences = useMemo(
    () => (status.status === 'ok' && releve ? buildAbsenceReport(entry.payload, releve, config) : null),
    [status.status, entry.payload, releve, config],
  )
  const gradesReport = useMemo(() => (releve ? buildGradesReport(releve, { config }) : null), [releve, config])
  const entries = useMemo(() => (absences?.visible ? absences.entries : []), [absences])
  const entriesById = useMemo(() => new Map(entries.map((item) => [item.id, item])), [entries])
  const sums = useMemo(() => sumAbsenceHours(entries), [entries])
  const counts = useMemo(() => countAbsencesByStatus(entries), [entries])
  const subjects = useMemo(() => summarizeAbsencesBySubject(entries), [entries])
  const evaluationsByEntry = useMemo(() => (gradesReport?.status === 'ok' ? findEvaluationsDuringAbsences(gradesReport, entries) : {}), [gradesReport, entries])
  const timeline = useMemo(() => buildSemesterTimeline({
    start: releve?.semestre?.date_debut,
    end: releve?.semestre?.date_fin,
    entries,
    now,
  }), [releve, entries, now])
  const windowHours = useMemo(() => readJustificationWindow(absences?.notice), [absences])
  const openJustifications = useMemo(() => listOpenJustifications(entries, windowHours, now), [entries, windowHours, now])
  // The subjects' icons, as « Mes notes » gives them (by module code).
  const subjectIcon = useMemo(() => assignSubjectIcons(
    [...(gradesReport?.resources ?? []), ...(gradesReport?.saes ?? [])]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((module) => module.title)
      .concat(subjects.map((subject) => subject.subject)),
    universityConfig.appIconStyle,
  ), [gradesReport, subjects])

  // Anonymous analytics: page_viewed, then how the semester it opens on
  // loaded (categories only, never what the absences are).
  useAssiduityPageReport(toAssiduityPageSource(arrivalSource), describeAssiduityLoad({
    status: status.status,
    errorKind: status.errorKind,
    unavailable: status.unavailable,
    hasReleve: Boolean(releve),
    visible: Boolean(absences?.visible),
    count: entries.length,
  }))
  // The semester menu: only an actual change counts.
  const changeSemester = (id) => {
    if (id !== activeId) trackAssiduityAction('semester_changed')
    selectSemester(id)
  }

  const [filter, setFilter] = useState('all')
  const [subjectKey, setSubjectKey] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const selectedSubject = subjects.find((subject) => subject.key === subjectKey) ?? null
  // Another semester: its own list, unfiltered.
  useEffect(() => {
    setFilter('all')
    setSubjectKey(null)
    setHighlightId(null)
  }, [activeId])

  // A mark of the line, or a card of « À justifier »: its absence in the
  // list, shown whatever the filters, scrolled to and lit up a moment.
  const highlightTimer = useRef(null)
  const pickEntry = useCallback((id) => {
    const picked = entriesById.get(id)
    if (!picked) return
    setFilter((current) => (current === 'all' || current === picked.status ? current : 'all'))
    setSubjectKey((current) => (current == null || current === (picked.moduleCode ?? picked.subjectTitle ?? picked.subject ?? '') ? current : null))
    setHighlightId(id)
    window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 2200)
    window.requestAnimationFrame(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      document.getElementById(`absence-${id}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    })
  }, [entriesById])
  useEffect(() => () => window.clearTimeout(highlightTimer.current), [])

  const selectSubject = (key) => {
    if (key) trackAssiduityAction('subject_filtered')
    setSubjectKey(key)
    if (key) setFilter('all')
  }
  const changeFilter = (value) => {
    if (value !== filter && value !== 'all') trackAssiduityAction('status_filtered')
    setFilter(value)
  }
  // A mark of the semester line picked (the countdown cards' fallback,
  // without « Justifier », isn't one).
  const pickMark = (id) => {
    trackAssiduityAction('mark_picked')
    pickEntry(id)
  }

  // « Justifier »: the walkthrough over the page (its own history entry,
  // so Back closes it), for one absence; it hands the mail to the
  // Messagerie's composer. Not offered without the in-app Messagerie.
  const justifySheet = useHistorySheet('tafacAbsenceJustify')
  const [justifyEntry, setJustifyEntry] = useState(null)
  // `from`: a row's button, a countdown card, the right-click menu.
  const openJustify = useMemo(() => (onComposeMail ? (item, from = 'row') => {
    trackAssiduityAction('justify_opened', { from })
    setJustifyEntry(item)
    justifySheet.open()
  } : null), [onComposeMail, justifySheet])
  // Anonymous analytics of the walkthrough (justify_step): `opened` and
  // `closed` follow the sheet itself, however it closes (its buttons,
  // Escape, Back, the mail written), `closed` with the furthest step
  // reached; the sheet reports the steps in between (onStep). Never the
  // reason given.
  const isJustifyShown = justifySheet.isOpen && Boolean(justifyEntry)
  const justifyReachedRef = useRef(null)
  useEffect(() => {
    if (isJustifyShown) {
      justifyReachedRef.current = 'reason'
      trackJustifyStep('opened')
    } else if (justifyReachedRef.current) {
      trackJustifyStep('closed', { reached: justifyReachedRef.current })
      justifyReachedRef.current = null
    }
  }, [isJustifyShown])
  const reportJustifyStep = useCallback((step, { reach = null, proof = null } = {}) => {
    if (reach) justifyReachedRef.current = advanceJustifyReach(justifyReachedRef.current, reach)
    trackJustifyStep(step, proof ? { proof } : {})
  }, [])

  const isReady = status.status === 'ok' && absences?.visible
  let body = null
  if (status.status === 'error') {
    body = <p className="m-0 font-body text-[15px] font-medium text-text-secondary" role="alert">{status.error}</p>
  } else if (status.status === 'loading') {
    body = <LoadingDots label="Chargement des absences" className="justify-self-start py-2 text-text-muted" />
  } else if (!releve) {
    body = (
      <PageEmptyState key={activeId} icon="ph:file" title="Aucun relevé pour ce semestre">
        ScoDoc n’a encore rien publié ici
      </PageEmptyState>
    )
  } else if (!absences?.visible) {
    body = (
      <PageEmptyState key={activeId} icon="ph:eye-slash" title="Absences non publiées">
        {r('Ton département ne publie pas les absences sur ScoDoc', 'Votre département ne publie pas les absences sur ScoDoc')}
      </PageEmptyState>
    )
  } else if (!entries.length) {
    body = (
      <PageEmptyState key={activeId} icon="ph:check-circle" title="Aucune absence">
        Aucune absence ni aucun retard enregistré ce semestre
      </PageEmptyState>
    )
  } else {
    body = (
      <div key={activeId} className="semester-fade grid gap-8 max-md:gap-6">
        {openJustifications.length ? (
          <ToJustify open={openJustifications} subjectIcon={subjectIcon} canJustify={Boolean(openJustify)} onPick={openJustify ? (item) => openJustify(item, 'countdown') : (item) => pickEntry(item.id)} />
        ) : null}
        {subjects.length > 1 ? (
          <SubjectBreakdown subjects={subjects} subjectIcon={subjectIcon} selected={subjectKey} onSelect={selectSubject} />
        ) : null}
        <AbsenceHistory
          entries={entries}
          filter={filter}
          onFilter={changeFilter}
          subject={selectedSubject}
          onClearSubject={() => setSubjectKey(null)}
          highlightId={highlightId}
          subjectIcon={subjectIcon}
          evaluationsByEntry={evaluationsByEntry}
          onJustify={openJustify}
        />
      </div>
    )
  }

  return (
    <section className="assiduity-page w-full grid gap-4 pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5 max-md:gap-3" aria-labelledby="assiduity-page-title">
      {/* The page's top, tinted apart from the list below: title, the
          semester's totals and its line, the department's rule. On a phone
          it tops the screen (no app top bar here), a little more room
          above. */}
      <div className="page-top-band grid gap-5 -mx-6 -mt-4 px-6 pt-4 pb-6 4xl:-mt-5 4xl:pt-5 max-md:-mx-3 max-md:-mt-3 max-md:gap-4 max-md:px-3 max-md:pt-5 max-md:pb-4">
        {/* The university's outage notice, as on every tab. */}
        <ServiceNotice />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 max-md:flex-nowrap max-md:items-center max-md:gap-x-2">
          <h1 id="assiduity-page-title" className="m-0 leading-[1.15] text-2xl font-bold max-md:mr-auto max-md:flex max-md:min-h-10 max-md:min-w-0 max-md:items-center max-md:text-[26px] max-md:tracking-[-0.01em]">Assiduité</h1>
          <SemesterSelect semesters={semesters} value={activeId} onChange={changeSemester} />
        </div>
        {isReady ? (
          <div key={activeId} className="semester-fade grid gap-4 max-md:gap-3">
            <div className="flex flex-wrap items-stretch gap-3 max-md:gap-2">
              <TotalsCard totals={absences.totals} sums={sums} counts={counts} />
              {timeline ? <SemesterLine timeline={timeline} entriesById={entriesById} onPick={pickMark} activeId={highlightId} /> : null}
            </div>
            {absences.notice ? (
              <GradesNotice icon="ph:info" label="Règle du département" title="Justifier une absence" collapsible>
                {absences.notice}
              </GradesNotice>
            ) : null}
          </div>
        ) : null}
      </div>
      {body}
      {isJustifyShown ? (
        <JustifyAbsenceSheet entry={justifyEntry} extraReasons={absenceReasons} findsClassTeacher={findsClassTeacher} onStep={reportJustifyStep} onCompose={onComposeMail} onClose={justifySheet.close} />
      ) : null}
    </section>
  )
}

export default AssiduityPage
