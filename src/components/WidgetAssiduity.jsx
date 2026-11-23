import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import assiduityIcon from '../assets/home-icons/assiduity.png'
import { buildAbsenceReport, formatDuration } from '../gradesReport'
import {
  buildSemesterTimeline,
  countAbsencesByStatus,
  formatTimeLeft,
  listOpenJustifications,
  parseDay,
  readJustificationWindow,
  sumAbsenceHours,
} from '../assiduity'
import { ABSENCE_STATUS_LABELS } from '../absenceMail'
import { accentStyle, courseKey } from '../eventAccents'
import { isModuleCode, normalizeModuleCode, titleModuleCodes } from '../moduleTeachers'
import { readAssigned } from '../usePlanningWeeks'
import SmoothSurface from './SmoothSurface'
import { Skeleton } from 'skullet/react'
import { useSkeletonsForced } from '../skeletonSamples'

// « Accueil »'s « Assiduité » card: the newest semester's absences from
// the relevé (buildAbsenceReport, the passerelle's rules), as the
// « Assiduité » page tops them. The hours not justified, big (red when
// some); the hours missed and the lateness; the semester as a line, each
// absence a mark on its day, today a tick; the soonest delay still open
// to justify one (when the department's notice gives one). The whole card
// opens « Assiduité » (HomeDraftPage). Nothing when the department doesn't
// publish absences, or without a relevé.

const CARD_CLASSES = 'widget-card widget-card-visible @container/assiduity flex flex-col gap-3 border border-white bg-widget-bg p-4 text-text shadow-md card-corners max-md:p-3'

function Header() {
  return (
    <div className="flex min-w-0 items-center gap-[5px]">
      <img src={assiduityIcon} alt="" width="22" height="22" draggable="false" className="mr-[3px] size-[22px] shrink-0 select-none" aria-hidden="true" />
      <span className="min-w-0 truncate text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Assiduité</span>
    </div>
  )
}

// While the relevé loads: the figures' skeleton (skullet), measured from
// sample ones, so nothing moves when they come in.
export function AssiduityPlaceholder() {
  return (
    <article className={CARD_CLASSES} aria-label="Assiduité, chargement" aria-busy="true">
      <Header />
      <Skeleton loading label="Chargement de l’assiduité" className="mt-auto">
        <div className="flex min-w-0 flex-col gap-[5px]">
          <div className="flex items-end gap-[6px] leading-[1.06]">
            <span className="font-display text-[37px] font-bold leading-none whitespace-nowrap max-md:text-[clamp(28px,8vw,34px)]">2h</span>
            <span className="pb-[3px] text-[15px] font-semibold leading-[1.06] whitespace-nowrap max-md:text-[14px]">non justifiées</span>
          </div>
          <span className="min-w-0 truncate text-[14px] font-medium leading-[1.2] text-text-muted max-md:text-[13px]">6h manquées · 1 retard</span>
        </div>
      </Skeleton>
    </article>
  )
}

const DAY_SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
const PILLS = {
  unjustified: 'status-tag status-tag--error text-error',
  justified: 'status-tag status-tag--carved text-text-secondary',
  late: 'status-tag status-tag--carved status-tag--dashed text-text-secondary',
}
const MARK_REACH = 24
const POPOVER_WIDTH = 272
const markBottom = (mark) => 8 + mark.stack * 11
const canJustify = (entry) => entry.status === 'unjustified' || entry.status === 'late'

function formatDay(value) {
  const day = parseDay(value)
  const text = day ? DAY_SHORT.format(day).replace('.', '') : ''
  return text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1)
}

// The course's accent as the planning gave it (eventAccents, kept in this
// browser): the planning's title carries the module's code (« R5.11 … »),
// the relevé's absence names it. shortcut: nothing until the planning was
// opened once, the ENT's blue then; upgrade by fetching the week.
function accentIndexFor(assigned, entry) {
  const code = normalizeModuleCode(entry.moduleCode)
  const keys = Object.keys(assigned)
  const key = (code && keys.find((item) => titleModuleCodes(item).some((titleCode) => isModuleCode(titleCode, code))))
    ?? keys.find((item) => item === courseKey(entry.subjectTitle))
  return key != null ? assigned[key] : 0
}

// What a mark says, in the planning's colours: day, hours, subject, status,
// then « Justifier » and « Voir plus ». It is portalled (the card clips)
// and stays while the pointer is on it.
function MarkPopover({ entry, accent, anchor, onOpen, onEnter, onLeave }) {
  const justifiable = Boolean(onOpen) && canJustify(entry)
  const stop = (event) => event.stopPropagation()
  const left = Math.min(Math.max(anchor.x, 8 + POPOVER_WIDTH / 2), window.innerWidth - 8 - POPOVER_WIDTH / 2)
  return createPortal(
    <div
      role="group"
      aria-label="Détail de l’absence"
      className="assiduity-line-tip glass-solid fixed z-[70] isolate flex flex-col gap-2 overflow-hidden rounded-[18px] py-3 pl-4 pr-3 text-text shadow-lg"
      style={{
        ...accentStyle(accent),
        width: POPOVER_WIDTH,
        left,
        transform: 'translateX(-50%)',
        ...(anchor.above ? { bottom: window.innerHeight - anchor.top + 10 } : { top: anchor.bottom + 10 }),
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={stop}
      onKeyDown={stop}
    >
      <span className="latest-grade-wash planning-accent-fill" aria-hidden="true" />
      <span className="planning-accent-fill absolute inset-y-0 left-0 w-[4px]" aria-hidden="true" />
      <span className="font-body text-[12px] font-medium leading-none text-text-muted">
        {formatDay(entry.date)} · {entry.start} – {entry.end}
      </span>
      <span className="line-clamp-2 font-body text-[14px] font-semibold leading-[1.25]">{entry.subjectTitle ?? 'Matière non précisée'}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-[12px] font-medium leading-none text-text-secondary">
        <span className={`inline-flex items-center rounded-full px-2 py-[5px] font-semibold ${PILLS[entry.status] ?? PILLS.justified}`}>{ABSENCE_STATUS_LABELS[entry.status]}</span>
        {entry.status !== 'late' && entry.hours > 0 ? <span>{formatDuration(entry.hours)}</span> : null}
        {entry.teacher ? <span className="min-w-0 truncate">{entry.teacher}</span> : null}
      </span>
      {onOpen ? (
        <span className="mt-1 flex items-center gap-2">
          {justifiable ? (
            <button type="button" onClick={() => onOpen(entry.id, 'justify')} className="lent-button justify-button relative inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full px-3">
              <SmoothSurface />
              <Icon icon="ph:seal-check" className="size-[15px]" aria-hidden="true" />
              <span className="font-body text-[13px] font-medium leading-none">Justifier</span>
            </button>
          ) : null}
          <button type="button" onClick={() => onOpen(entry.id, 'view')} className="inline-flex h-[30px] cursor-pointer items-center gap-1 rounded-full px-2 font-body text-[13px] font-medium leading-none text-text-secondary hover:text-text">
            Voir plus
            <Icon icon="ph:arrow-right" className="size-[13px]" aria-hidden="true" />
          </button>
        </span>
      ) : null}
    </div>,
    document.body,
  )
}

// The semester line, small. A mark hovered (the nearest to the pointer, as
// on the page), tapped or focused opens its popover; the rest of the card
// stays the link.
function MiniLine({ timeline, entriesById, assigned, onOpen }) {
  const trackRef = useRef(null)
  const closeTimer = useRef(null)
  const [anchor, setAnchor] = useState(null)
  const cancelClose = useCallback(() => window.clearTimeout(closeTimer.current), [])
  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setAnchor(null), 140)
  }, [])
  const show = (id) => {
    cancelClose()
    const rect = trackRef.current?.getBoundingClientRect()
    const mark = timeline.marks.find((item) => item.id === id)
    if (!rect || !mark) return
    setAnchor({ id, x: rect.left + (mark.position / 100) * rect.width, top: rect.top, bottom: rect.bottom, above: rect.top > 230 })
  }
  const nearestMark = (event) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return null
    let best = null
    for (const mark of timeline.marks) {
      const distance = Math.hypot(event.clientX - (rect.left + (mark.position / 100) * rect.width), event.clientY - (rect.bottom - markBottom(mark) - 5))
      if (distance <= MARK_REACH && (!best || distance < best.distance)) best = { id: mark.id, distance }
    }
    return best?.id ?? null
  }
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!anchor) return undefined
    const close = () => setAnchor(null)
    const onKey = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor])
  const shown = anchor ? entriesById.get(anchor.id) : null

  return (
    <div className="relative px-[5px]">
      <div
        ref={trackRef}
        className={`relative h-[30px] ${anchor ? 'cursor-pointer' : ''}`}
        onPointerMove={(event) => {
          const id = nearestMark(event)
          if (id) { if (id !== anchor?.id) show(id) } else scheduleClose()
        }}
        onPointerLeave={scheduleClose}
        onClick={(event) => {
          // A mark's button from the keyboard (detail 0) is handled by its
          // focus; a pointer on a mark opens its popover, not the page.
          if (event.detail === 0) return
          const id = nearestMark(event)
          if (id) {
            event.stopPropagation()
            show(id)
          }
        }}
      >
        <span className="assiduity-track absolute inset-x-0 bottom-[8px] h-[6px] rounded-full" aria-hidden="true" />
        <span className="assiduity-elapsed assiduity-fill absolute left-0 bottom-[8px] h-[6px] rounded-full" style={{ width: `${timeline.elapsed}%` }} aria-hidden="true" />
        {timeline.today != null ? (
          <span className="assiduity-today absolute bottom-[2px] h-[18px] w-[4px] -translate-x-1/2 rounded-full" style={{ left: `${timeline.today}%` }} aria-hidden="true" />
        ) : null}
        {timeline.marks.map((mark, index) => {
          const entry = entriesById.get(mark.id)
          return (
            <span key={mark.id} className="absolute" style={{ left: `${mark.position}%`, bottom: `${markBottom(mark)}px` }}>
              <button
                type="button"
                className={`assiduity-mark is-${mark.status} ${anchor?.id === mark.id ? 'is-active' : ''}`}
                style={{ '--mark-order': index }}
                aria-label={entry ? `${formatDay(entry.date)}, ${entry.start}, ${entry.subjectTitle ?? ABSENCE_STATUS_LABELS[entry.status]}` : mark.date}
                onFocus={() => show(mark.id)}
                onBlur={scheduleClose}
              />
            </span>
          )
        })}
      </div>
      <div className="relative h-[12px]" aria-hidden="true">
        {timeline.months.map((month) => (
          <span key={month.key} className="absolute top-0 whitespace-nowrap font-body text-[10px] font-semibold uppercase leading-none tracking-[0.04em] text-text-muted" style={{ left: `${month.position}%` }}>
            {month.label}
          </span>
        ))}
      </div>
      {shown ? <MarkPopover entry={shown} accent={accentIndexFor(assigned, shown)} anchor={anchor} onOpen={onOpen} onEnter={cancelClose} onLeave={scheduleClose} /> : null}
    </div>
  )
}

// `payload`: the grades answer (the relevé's semester, its `absences`);
// `status`: 'loading', 'ok', 'empty', 'error' (HomeDraftPage's grades).
// `onOpen(entryId, 'justify' | 'view')`: « Justifier » / « Voir plus » of a
// mark's popover, to the Assiduité page (null: the popover has no buttons).
function WidgetAssiduity({ payload, releve, config, status, onOpen = null }) {
  const skeletonsForced = useSkeletonsForced()
  // Read once: the card is redrawn as the page loads, the line stays put.
  const [now] = useState(() => new Date())
  const report = useMemo(() => (releve ? buildAbsenceReport(payload, releve, config) : null), [payload, releve, config])
  const entries = useMemo(() => (report?.visible ? report.entries : []), [report])
  const sums = useMemo(() => sumAbsenceHours(entries), [entries])
  const counts = useMemo(() => countAbsencesByStatus(entries), [entries])
  const timeline = useMemo(() => buildSemesterTimeline({
    start: releve?.semestre?.date_debut,
    end: releve?.semestre?.date_fin,
    entries,
    now,
  }), [releve, entries, now])
  const entriesById = useMemo(() => new Map(entries.map((item) => [item.id, item])), [entries])
  const assigned = useMemo(() => readAssigned(), [])
  const open = useMemo(() => listOpenJustifications(entries, readJustificationWindow(report?.notice), now), [entries, report, now])

  if (status === 'loading' || skeletonsForced) return <AssiduityPlaceholder />
  if (!report?.visible) return null

  const missed = sums.justified + sums.unjustified
  const unjustified = report.totals?.unjustified ?? formatDuration(sums.unjustified)
  const hasUnjustified = sums.unjustified > 0 || counts.unjustified > 0
  const details = entries.length
    ? [
        missed > 0 ? `${formatDuration(missed)} manquées` : null,
        counts.late ? `${counts.late} retard${counts.late > 1 ? 's' : ''}` : null,
      ].filter(Boolean).join(' · ')
    : 'Aucune absence ce semestre'
  const soonest = open[0] ?? null

  return (
    <article
      className={CARD_CLASSES}
      aria-label={`Assiduité : ${unjustified} non justifiées${details ? `, ${details}` : ''}${soonest ? `, ${formatTimeLeft(soonest.hoursLeft)} pour justifier` : ''}`}
    >
      <Header />
      {/* The figures, then the line beside them on a wide card, under them
          on a narrow one. */}
      <div className="mt-auto flex flex-col gap-3 @min-[460px]/assiduity:flex-row @min-[460px]/assiduity:items-end @min-[460px]/assiduity:gap-6">
        <div className="flex min-w-0 shrink-0 flex-col gap-[5px]">
          <div className="flex items-end gap-[6px] leading-[1.06]">
            <span className={`font-display text-[37px] font-bold leading-none whitespace-nowrap max-md:text-[clamp(28px,8vw,34px)] ${hasUnjustified ? 'text-error' : 'text-text'}`}>{unjustified}</span>
            <span className="pb-[3px] text-[15px] font-semibold leading-[1.06] whitespace-nowrap max-md:text-[14px]">non justifiées</span>
          </div>
          <span className="min-w-0 truncate text-[14px] font-medium leading-[1.2] text-text-muted max-md:text-[13px]">{details}</span>
        </div>
        {timeline ? <div className="min-w-0 flex-1"><MiniLine timeline={timeline} entriesById={entriesById} assigned={assigned} onOpen={onOpen} /></div> : null}
      </div>
      {soonest ? (
        <span className="status-tag status-tag--error inline-flex min-w-0 items-center gap-1.5 self-start rounded-full px-2.5 py-[6px] font-body text-[13px] font-semibold leading-none text-error">
          <span className="whitespace-nowrap">{formatTimeLeft(soonest.hoursLeft)} pour justifier</span>
          {soonest.entry.subjectTitle ? <span className="min-w-0 truncate font-medium opacity-80">· {soonest.entry.subjectTitle}</span> : null}
        </span>
      ) : null}
    </article>
  )
}

export default WidgetAssiduity
