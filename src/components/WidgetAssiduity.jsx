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
  readJustificationWindow,
  sumAbsenceHours,
} from '../assiduity'
import { ABSENCE_STATUS_LABELS } from '../absenceMail'
import { STATUS_STYLES, canJustify, capitalize, describeEntry, formatDay } from '../assiduityDisplay'
import { accentStyle, courseKey } from '../eventAccents'
import { isModuleCode, normalizeModuleCode, titleModuleCodes } from '../moduleTeachers'
import { readAssigned } from '../usePlanningWeeks'
import SmoothSurface from './SmoothSurface'
import Tooltip from './Tooltip'
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

// `onOpen`: the title is then the card's link to the page, a real button
// (the marks are buttons too, and a control can't sit inside a link).
function Header({ onOpen = null }) {
  const title = <span className="min-w-0 truncate text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Assiduité</span>
  return (
    <div className="flex min-w-0 items-center gap-[5px]">
      <img src={assiduityIcon} alt="" width="22" height="22" draggable="false" className="mr-[3px] size-[22px] shrink-0 select-none" aria-hidden="true" />
      {onOpen ? (
        <button
          type="button"
          aria-label="Assiduité, voir la page"
          className="-mx-1 flex min-w-0 cursor-pointer items-center rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        >
          {title}
        </button>
      ) : title}
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

const MARK_REACH = 24
const POPOVER_WIDTH = 288
// The app's secondary button (glass-solid, as the sidebar's round buttons).
const MARK_ACTION = 'glass-solid inline-flex h-[28px] shrink-0 cursor-pointer items-center rounded-full border text-text transition-[background-color] duration-150 hover:bg-brand-subtle'
const markBottom = (mark) => 8 + mark.stack * 11

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
// then « Justifier » (where the page can justify: `justifies`), the
// planning and « Voir plus ». It is portalled (the card clips) and stays
// while the pointer or the focus is on it.
function MarkPopover({ entry, accent, anchor, popoverRef, justifies, onOpen, onOpenPlanning, onEnter, onLeave, onFocusOut, onKeyDown }) {
  const justifiable = Boolean(onOpen) && justifies && canJustify(entry)
  const stop = (event) => event.stopPropagation()
  const left = Math.min(Math.max(anchor.x, 8 + POPOVER_WIDTH / 2), window.innerWidth - 8 - POPOVER_WIDTH / 2)
  return createPortal(
    <div
      ref={popoverRef}
      id="assiduity-mark-popover"
      role="dialog"
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
      onFocus={onEnter}
      onBlur={onFocusOut}
      onClick={stop}
      onKeyDown={(event) => {
        stop(event)
        onKeyDown(event)
      }}
    >
      <span className="latest-grade-wash planning-accent-fill" aria-hidden="true" />
      <span className="planning-accent-fill absolute inset-y-0 left-0 w-[4px]" aria-hidden="true" />
      <span className="font-body text-[12px] font-medium leading-none text-text-muted">
        {capitalize(formatDay(entry.date))} · {entry.start} – {entry.end}
      </span>
      <span className="line-clamp-2 font-body text-[14px] font-semibold leading-[1.25]">{entry.subjectTitle ?? 'Matière non précisée'}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-[12px] font-medium leading-none text-text-secondary">
        <span className={`inline-flex items-center rounded-full px-2 py-[5px] font-semibold ${(STATUS_STYLES[entry.status] ?? STATUS_STYLES.justified).pill}`}>{ABSENCE_STATUS_LABELS[entry.status]}</span>
        {entry.status !== 'late' && entry.hours > 0 ? <span>{formatDuration(entry.hours)}</span> : null}
        {entry.teacher ? <span className="min-w-0 truncate">{entry.teacher}</span> : null}
      </span>
      {onOpen || onOpenPlanning ? (
        // One row of real buttons, all the same height: « Justifier » first
        // when it applies, then the planning (a round icon, it wouldn't fit
        // spelled out) and « Voir plus ». Labels sit in a <span>: the global
        // `button { font: inherit }` (index.css) outranks utilities on the
        // button itself.
        <span className="mt-1 flex items-center gap-1.5">
          {justifiable ? (
            <button type="button" onClick={() => onOpen(entry.id, 'justify')} className="lent-button justify-button relative mr-auto inline-flex h-[28px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5">
              <SmoothSurface />
              <Icon icon="ph:seal-check" className="size-[14px]" aria-hidden="true" />
              <span className="font-body text-[13px] font-medium leading-none">Justifier</span>
            </button>
          ) : null}
          {onOpenPlanning ? (
            <button type="button" onClick={() => onOpenPlanning(entry.date.slice(0, 10), entry)} className={`${MARK_ACTION} group relative justify-center size-[28px]`} aria-label="Voir sur le planning">
              <Icon icon="ph:calendar-blank" className="size-[14px]" aria-hidden="true" />
              <Tooltip title="Voir sur le planning" side="top" />
            </button>
          ) : null}
          {onOpen ? (
            <button type="button" onClick={() => onOpen(entry.id, 'view')} className={`${MARK_ACTION} gap-1 pl-3 pr-2.5`}>
              <span className="font-body text-[13px] font-medium leading-none">Voir plus</span>
              <Icon icon="ph:arrow-right" className="size-[14px]" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>,
    document.body,
  )
}

// The semester line, small. A mark hovered (the nearest to the pointer, as
// on the page), tapped or focused opens its popover; the rest of the card
// opens the page. From the keyboard: a mark focused shows its popover,
// Enter or Space moves into it, Tab past its last button goes on to the
// next mark, Escape comes back to the mark.
function MiniLine({ timeline, entriesById, assigned, justifies, onOpen, onOpenPlanning }) {
  const trackRef = useRef(null)
  const popoverRef = useRef(null)
  const markRefs = useRef(new Map())
  const closeTimer = useRef(null)
  // A mark focused by the popover itself (Escape, Tab out): not reopened.
  const quietFocus = useRef(false)
  const [anchor, setAnchor] = useState(null)
  const cancelClose = useCallback(() => window.clearTimeout(closeTimer.current), [])
  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setAnchor(null), 140)
  }, [])
  // Where a mark is on screen, for the popover; null when it isn't.
  const place = useCallback((id) => {
    const rect = trackRef.current?.getBoundingClientRect()
    const mark = timeline.marks.find((item) => item.id === id)
    if (!rect || !mark || rect.bottom < 0 || rect.top > window.innerHeight) return null
    return { x: rect.left + (mark.position / 100) * rect.width, top: rect.top, bottom: rect.bottom, above: rect.top > 230 }
  }, [timeline])
  const show = (id, { enter = false } = {}) => {
    cancelClose()
    const at = place(id)
    if (at) setAnchor({ id, enter, ...at })
  }
  const focusMark = (id) => {
    quietFocus.current = true
    markRefs.current.get(id)?.focus()
    quietFocus.current = false
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
  // Entered from the keyboard: the focus on its first button.
  useEffect(() => {
    if (anchor?.enter) popoverRef.current?.querySelector('button')?.focus()
  }, [anchor])
  // Closed by Escape, or a tap or click anywhere else (a touch screen has
  // no pointer to leave it). A scroll carries it with its mark (Tab to a
  // mark out of sight scrolls to it), closed once the line is out of sight.
  const anchorId = anchor?.id ?? null
  useEffect(() => {
    if (anchorId == null) return undefined
    const close = () => setAnchor(null)
    const follow = () => {
      const at = place(anchorId)
      setAnchor((current) => (at && current?.id === anchorId ? { ...current, ...at, enter: false } : null))
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      if (popoverRef.current?.contains(document.activeElement)) focusMark(anchorId)
      close()
    }
    const onPointerDown = (event) => {
      if (popoverRef.current?.contains(event.target) || trackRef.current?.contains(event.target)) return
      close()
    }
    window.addEventListener('scroll', follow, true)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [anchorId, place])
  // The focus leaving the popover for anything but its mark.
  const onPopoverFocusOut = (event) => {
    if (popoverRef.current?.contains(event.relatedTarget)) return
    if (event.relatedTarget && event.relatedTarget === markRefs.current.get(anchor?.id)) return
    scheduleClose()
  }
  // Escape: back on the mark. Tab past the last button: back on the mark,
  // the browser's Tab then goes on from there (the next mark). Shift+Tab
  // before the first: the mark.
  const onPopoverKeyDown = (event) => {
    if (!anchor) return
    // Its keys stop here (the card would act on them): Escape too.
    if (event.key === 'Escape') {
      focusMark(anchor.id)
      setAnchor(null)
      return
    }
    if (event.key !== 'Tab') return
    const buttons = [...(popoverRef.current?.querySelectorAll('button') ?? [])]
    if (!buttons.length) return
    if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
      focusMark(anchor.id)
      setAnchor(null)
    } else if (event.shiftKey && document.activeElement === buttons[0]) {
      event.preventDefault()
      focusMark(anchor.id)
    }
  }
  const shown = anchor ? entriesById.get(anchor.id) : null
  const hasActions = Boolean(onOpen || onOpenPlanning)

  return (
    <div className="relative px-[5px]">
      <div
        ref={trackRef}
        className={`relative h-[30px] ${anchor ? 'cursor-pointer' : ''}`}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse') return
          const id = nearestMark(event)
          if (id) { if (id !== anchor?.id) show(id) } else scheduleClose()
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') scheduleClose()
        }}
        onClick={(event) => {
          // A mark's button from the keyboard (detail 0): its own onClick.
          // A pointer on a mark opens its popover, not the page.
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
          const open = anchor?.id === mark.id
          return (
            <span key={mark.id} className="absolute" style={{ left: `${mark.position}%`, bottom: `${markBottom(mark)}px` }}>
              <button
                ref={(node) => {
                  if (node) markRefs.current.set(mark.id, node)
                  else markRefs.current.delete(mark.id)
                }}
                type="button"
                className={`assiduity-mark is-${mark.status} ${open ? 'is-active' : ''}`}
                style={{ '--mark-order': index }}
                aria-label={entry ? describeEntry(entry) : mark.date}
                aria-haspopup={hasActions ? 'dialog' : undefined}
                aria-expanded={hasActions ? open : undefined}
                aria-controls={open ? 'assiduity-mark-popover' : undefined}
                onFocus={() => {
                  if (!quietFocus.current) show(mark.id)
                }}
                onBlur={(event) => {
                  if (popoverRef.current?.contains(event.relatedTarget)) return
                  scheduleClose()
                }}
                onClick={(event) => {
                  // Enter or Space: into the popover, not the page.
                  if (event.detail !== 0) return
                  event.stopPropagation()
                  if (hasActions) show(mark.id, { enter: true })
                }}
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
      {shown ? (
        <MarkPopover
          entry={shown}
          accent={accentIndexFor(assigned, shown)}
          anchor={anchor}
          popoverRef={popoverRef}
          justifies={justifies}
          onOpen={onOpen}
          onOpenPlanning={onOpenPlanning}
          onEnter={cancelClose}
          onLeave={(event) => {
            if (event.pointerType === 'mouse') scheduleClose()
          }}
          onFocusOut={onPopoverFocusOut}
          onKeyDown={onPopoverKeyDown}
        />
      ) : null}
    </div>
  )
}

// `payload`: the grades answer (the relevé's semester, its `absences`);
// `status`: 'loading', 'ok', 'empty', 'error' (HomeDraftPage's grades).
// `onOpen(entryId, 'justify' | 'view')`: « Justifier » / « Voir plus » of a
// mark's popover, to the Assiduité page (null: the popover has no buttons);
// `justifies`: the page can justify (it writes the mail, so with the
// Messagerie), else no « Justifier »; `onOpenPage`: the title opens the
// page; `onOpenPlanning(day, entry)`: the popover's planning button (the class
// of the absence is lit up there).
function WidgetAssiduity({ payload, releve, config, status, onOpen = null, justifies = false, onOpenPage = null, onOpenPlanning = null }) {
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
      <Header onOpen={onOpenPage} />
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
        {timeline ? <div className="min-w-0 flex-1"><MiniLine timeline={timeline} entriesById={entriesById} assigned={assigned} justifies={justifies} onOpen={onOpen} onOpenPlanning={onOpenPlanning} /></div> : null}
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
