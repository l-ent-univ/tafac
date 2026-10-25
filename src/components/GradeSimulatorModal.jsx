import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { pickInkOn, shadeHex } from '../colorContrast'
import { formatUeCode } from '../gradesSubjects'
import { describeRevealForAnalytics } from '../gradesAnalytics'
import { addCustomEvaluations } from '../gradeSimulation'
import { readSemesterUes } from '../semesterUes'
import { useUeColor } from '../useUeColor'
import { buildSegmentPath, pointAt } from '../ueRingGeometry'
import LentButton from './LentButton'
import GradeSimulatorReveal from './GradeSimulatorReveal'
import GradeSimulatorUe from './GradeSimulatorUe'
import CloseButton from './CloseButton'

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

const ARROW_CLASSES = 'absolute top-3 z-10 inline-flex size-11 items-center justify-center rounded-full border border-border bg-widget-bg p-0 text-text cursor-pointer transition-colors duration-150 hover:bg-bg-subtle max-sm:top-2'

// The dial: the UE ring, large, its top only showing over the sheet's
// bottom edge. A thicker band than the card's, narrower gaps.
const DIAL_OUTER = 60
const DIAL_INNER = 34
const DIAL_MID = (DIAL_OUTER + DIAL_INNER) / 2
// Wider than the visible gap: each segment's rounding stroke eats into it.
const DIAL_GAP = 2.6
const FULL_TURN = 2 * Math.PI
// The UE ribbon's look (UeBadge, Figma "UE button"), scaled from the badge
// (outer radius ≈ 95) to the dial's: its edge, its corner rounding and its
// shadows [dx, dy, blur, opacity], down and to the left.
const BADGE_SCALE = DIAL_OUTER / 95
const SHADOWS = [[-1, 1, 2, 0.36], [-4, 6, 3.5, 0.31], [-9, 13, 5, 0.18], [-16, 24, 5.5, 0.05], [-25, 37, 6.5, 0.01]]
  .map(([dx, dy, blur, opacity]) => [dx * BADGE_SCALE, dy * BADGE_SCALE, blur * BADGE_SCALE, opacity])

// Springs the UE's badge into where it stands, from `from` (another box,
// where it was: the dial's segment, the reveal's middle), as .ue-picked-fly.
function flyBadge(badge, from) {
  const to = badge.getBoundingClientRect()
  badge.style.setProperty('--fly-x', `${from.left + from.width / 2 - (to.left + to.width / 2)}px`)
  badge.style.setProperty('--fly-y', `${from.top + from.height / 2 - (to.top + to.height / 2)}px`)
  badge.style.setProperty('--fly-s', String(from.width / to.width))
  badge.classList.add('ue-picked-fly')
}

// The UE on top of the dial after `turn` steps.
function readUeAt(ues, turn) {
  const count = ues.length
  return count ? ues[((turn % count) + count) % count] : null
}

// The middle line of a segment, gaps trimmed, clockwise: what its code
// is set on, so it bends with the ribbon.
function buildMidArc(start, end) {
  const trim = DIAL_GAP / 2 / DIAL_MID
  const [x1, y1] = pointAt(start + trim, DIAL_MID)
  const [x2, y2] = pointAt(end - trim, DIAL_MID)
  const largeArc = end - start - 2 * trim > Math.PI ? 1 : 0
  return `M${x1},${y1}A${DIAL_MID},${DIAL_MID} 0 ${largeArc} 1 ${x2},${y2}`
}

// The semester's UEs as a dial of UE ribbons (the grade view's skeuomorphic
// UE parts, UeBadge), each with its code on it: the UE picked sits on top,
// centred. The arrows turn the dial one UE either way, round and round, and
// it can be dragged round by hand.
// `turn`: steps turned, never wrapped (from the last UE to the first, the
// dial keeps turning the same way instead of spinning back); the UE on top
// is readUeAt(ues, turn).
// `leaving`: on its way out once a UE is picked, without that UE's
// segment (`hiddenCode`, flying off as the badge), `onLeft` when it's gone.
function UeDial({ ues, turn, onTurn, leaving = false, hiddenCode = null, onLeft = null }) {
  const id = useId().replace(/:/g, '')
  const setTurn = onTurn
  // While dragged: how far the dial has been turned by hand, in degrees
  // (clockwise), on top of `turn`. `dragRef`: the pointer's last angle and
  // the total, between events.
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const dialRef = useRef(null)
  const count = ues.length
  const segments = useMemo(() => {
    const step = FULL_TURN / Math.max(ues.length, 1)
    return ues.map((ue, index) => {
      const start = index * step
      const end = (index + 1) * step
      return {
        ...ue,
        ink: pickInkOn(ue.color),
        // Its shadows' colour (UeBadge's shadeHex 0.55).
        shade: shadeHex(ue.color, 0.55),
        path: ues.length === 1
          ? buildSegmentPath(0, FULL_TURN - 0.0001, 0, DIAL_OUTER, DIAL_INNER)
          : buildSegmentPath(start, end, DIAL_GAP, DIAL_OUTER, DIAL_INNER),
        // A lone UE: its code across the top.
        arc: ues.length === 1 ? buildMidArc(-Math.PI / 3, Math.PI / 3) : buildMidArc(start, end),
      }
    })
  }, [ues])
  if (!count) return null

  const stepDeg = 360 / count
  // The picked segment's middle at 12 o'clock, plus the hand's turn.
  const turnStyle = { '--dial-rotation': `${count === 1 ? 0 : -(turn + 0.5) * stepDeg + (drag ?? 0)}deg` }

  // Dragging turns the dial around its centre, following the pointer's
  // angle (0 at 12 o'clock, clockwise); let go, it settles on the nearest
  // UE. Under a few degrees it's a tap, not a drag.
  const readAngle = (event) => {
    const box = dialRef.current.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)
    return (Math.atan2(dx, -dy) * 180) / Math.PI
  }
  const handlePointerDown = (event) => {
    if (count < 2 || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { last: readAngle(event), total: 0, moved: false }
  }
  const handlePointerMove = (event) => {
    const current = dragRef.current
    if (!current) return
    const angle = readAngle(event)
    // The shortest way from the last angle: crossing ±180° isn't a jump.
    current.total += ((angle - current.last + 540) % 360) - 180
    current.last = angle
    if (!current.moved && Math.abs(current.total) < 2) return
    current.moved = true
    setDrag(current.total)
  }
  const handlePointerEnd = () => {
    const current = dragRef.current
    dragRef.current = null
    if (!current?.moved) return
    // Turned clockwise, the UEs on the left come up: back that many.
    setTurn((value) => value - Math.round(current.total / stepDeg))
    setDrag(null)
  }

  return (
    <div
      className={`relative ${leaving ? 'ue-dial-leave pointer-events-none' : ''}`}
      inert={leaving}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onLeft?.()
      }}
    >
      {count > 1 ? (
        <>
          <button type="button" className={`${ARROW_CLASSES} left-6 max-sm:left-4`} aria-label="UE précédente" onClick={() => setTurn((current) => current - 1)}>
            <Icon icon="carbon:chevron-left" className="size-5" aria-hidden="true" />
          </button>
          <button type="button" className={`${ARROW_CLASSES} right-6 max-sm:right-4`} aria-label="UE suivante" onClick={() => setTurn((current) => current + 1)}>
            <Icon icon="carbon:chevron-right" className="size-5" aria-hidden="true" />
          </button>
        </>
      ) : null}
      {/* Cut at the sheet's edges (the ribbons' shadows fall past the dial's
          sides), with room above for its top edge. */}
      <div className="overflow-hidden pt-2">
      <div className="@container relative mx-auto aspect-[100/36] min-h-0 w-[min(560px,88%)]">
        <div
          ref={dialRef}
          className={`ue-dial relative aspect-square w-full touch-none select-none ${count > 1 ? (drag != null ? 'cursor-grabbing is-dragging' : 'cursor-grab') : ''}`}
          aria-hidden="true"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
        {/* The ribbon's shadows, cast by the dial as it stands: always down
            and to the left, each in a dark shade of its UE's colour. Not an
            SVG filter around the turning ribbons (WebKit would blur them
            again on the CPU at every frame of a turn): a blur doesn't care
            which way the ring is turned, so each shadow is its own copy of
            the ring, blurred then turned (by the compositor), and only
            then offset. */}
        {SHADOWS.map(([dx, dy, blur, opacity], index) => (
          <div key={index} className="ue-dial-shadow absolute inset-0" style={{ '--dx': dx, '--dy': dy, '--blur': blur, opacity }}>
            <svg viewBox="0 0 120 120" className="ue-dial-turn block size-full overflow-visible" style={turnStyle}>
              {segments.map((segment) => (
                <path key={segment.code} opacity={segment.code === hiddenCode ? 0 : undefined} d={segment.path} fill={segment.shade} stroke={segment.shade} strokeWidth={0.5} strokeLinejoin="round" />
              ))}
            </svg>
          </div>
        ))}
        <svg viewBox="0 0 120 120" className="ue-dial-turn absolute inset-0 block size-full overflow-visible" style={turnStyle}>
          <defs>
            {/* The ribbon's lit edge: black (no light) at the inner edge,
                grey at the outer one, added to the colour; round, so it
                stays on the outer edge as the dial turns. */}
            <radialGradient id={`${id}-edge`} cx="60" cy="60" r={DIAL_OUTER} gradientUnits="userSpaceOnUse">
              <stop offset={DIAL_INNER / DIAL_OUTER} stopColor="#000000" />
              <stop offset="1" stopColor="#515151" />
            </radialGradient>
            {segments.map((segment, index) => (
              <Fragment key={segment.code}>
                <clipPath id={`${id}-clip${index}`}>
                  <path d={segment.path} />
                </clipPath>
                <path id={`${id}-arc${index}`} d={segment.arc} />
              </Fragment>
            ))}
          </defs>
          {segments.map((segment, index) => (
            <g key={segment.code} opacity={segment.code === hiddenCode ? 0 : undefined}>
              <path data-ue={segment.code} d={segment.path} fill={segment.color} stroke={segment.color} strokeWidth={0.5} strokeLinejoin="round" />
              <path
                d={segment.path}
                fill="none"
                stroke={`url(#${id}-edge)`}
                strokeWidth={0.5}
                clipPath={`url(#${id}-clip${index})`}
                style={{ mixBlendMode: 'plus-lighter' }}
              />
              <text fill={segment.ink} fontSize="8.5" fontWeight="600" letterSpacing="0.15" className="font-display">
                <textPath href={`#${id}-arc${index}`} startOffset="50%" textAnchor="middle" dominantBaseline="central">
                  {formatUeCode(segment.code)}
                </textPath>
              </text>
            </g>
          ))}
        </svg>
        </div>
      </div>
      </div>
    </div>
  )
}

// "Simuler" on Mes notes: first the UE, picked on the dial at the bottom,
// then its ressources and SAÉ, where grades can be typed in
// (GradeSimulatorUe), then what they would do (GradeSimulatorReveal). The
// grade detail sheet's shell (GradeDetailModal):
// centred card on wide screens, bottom sheet on phones, focus kept inside, Escape and the
// backdrop close it. `onStep(step, details)`: the steps taken in between
// opening and closing, for the anonymous analytics (GradesPage's).
function GradeSimulatorModal({ report = null, releve = null, config = null, semester = null, subjectIcon = () => null, onStep = () => {}, onClose }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  const semesterLabel = semester?.number != null ? `Semestre ${semester.number}` : null
  // Their colours as painted (useUeColor): the dial, the UE's step and the
  // reveal all take them from here.
  const paintUe = useUeColor()
  const ues = useMemo(
    () => readSemesterUes(releve, config).map((ue) => ({ ...ue, color: paintUe(ue.color) })),
    [releve, config, paintUe],
  )
  const [turn, setTurn] = useState(0)
  const activeUe = readUeAt(ues, turn)
  // Second step, once "Suivant" is pressed: the UE picked. The dial leaves
  // (`dialGone` once it has), its segment flying to the corner as the UE's
  // badge; the sheet keeps the first step's height (`lockedHeight`).
  const [picked, setPicked] = useState(null)
  const [dialGone, setDialGone] = useState(false)
  const [lockedHeight, setLockedHeight] = useState(null)
  const flyFromRef = useRef(null)
  // Evaluation id → grade typed in, on /20, for the next step. Gone when
  // the sheet closes.
  const [overrides, setOverrides] = useState({})
  const editCount = Object.keys(overrides).length
  const setOverride = (id, value) => setOverrides((current) => {
    const next = { ...current }
    if (value == null) delete next[id]
    else next[id] = value
    return next
  })
  // Grades added by hand, subject code → [{ id, coef }]: evaluations ScoDoc
  // doesn't list yet. Their grades go in `overrides` with the others; the
  // relevé the result is worked out from carries them (addCustomEvaluations).
  const [customs, setCustoms] = useState({})
  const customIdRef = useRef(0)
  const customActions = useMemo(() => ({
    add: (code) => {
      customIdRef.current += 1
      const id = `custom-${customIdRef.current}`
      setCustoms((current) => ({ ...current, [code]: [...(current[code] ?? []), { id, coef: 1 }] }))
    },
    setCoef: (id, coef) => setCustoms((current) => Object.fromEntries(Object.entries(current)
      .map(([code, list]) => [code, list.map((custom) => (custom.id === id ? { ...custom, coef } : custom))]))),
    remove: (id) => {
      setCustoms((current) => Object.fromEntries(Object.entries(current)
        .map(([code, list]) => [code, list.filter((custom) => custom.id !== id)])))
      setOverrides((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    },
  }), [])
  const simulatedReleve = useMemo(() => addCustomEvaluations(releve, customs), [releve, customs])
  // Fields holding something that isn't a grade (or a coefficient): no
  // "Suivant" until they're fixed.
  const [invalidKeys, setInvalidKeys] = useState(() => new Set())
  const reportInvalid = useCallback((key, invalid) => setInvalidKeys((current) => {
    if (current.has(key) === invalid) return current
    const next = new Set(current)
    if (invalid) next.add(key)
    else next.delete(key)
    return next
  }), [])
  const hasInvalid = invalidKeys.size > 0
  const badgeRef = useRef(null)
  const pickedTitleRef = useRef(null)

  const goToUe = () => {
    if (!activeUe) return
    const segment = dialogRef.current?.querySelector(`.ue-dial [data-ue="${CSS.escape(activeUe.code)}"]`)
    flyFromRef.current = segment?.getBoundingClientRect() ?? null
    setLockedHeight(dialogRef.current?.getBoundingClientRect().height ?? null)
    setPicked(activeUe)
    onStep('ue_picked')
  }

  // The "poof": the badge starts where the dial's segment was, at its size,
  // and springs into the corner (.ue-picked-fly). Focus follows to the UE's
  // name, the button it came from being gone.
  useLayoutEffect(() => {
    if (!picked) return
    pickedTitleRef.current?.focus({ preventScroll: true })
    const from = flyFromRef.current
    const badge = badgeRef.current
    flyFromRef.current = null
    if (!from || !badge) return
    flyBadge(badge, from)
  }, [picked])

  // Third step, from the footer's "Suivant": the result (GradeSimulatorReveal),
  // the badge flying on from the corner to its middle. The second step stays
  // mounted underneath, hidden, so "Modifier mes notes" finds it as it was
  // (subjects open, grades, scroll), the badge flying back to its corner.
  const [reveal, setReveal] = useState(null)
  const listRef = useRef(null)
  const listScrollRef = useRef(0)
  // The sheet's height before a step changes, to ease it to the new one.
  const heightFromRef = useRef(null)
  // Set on the way back: where the badge flies back from.
  const returnRef = useRef(null)
  const showReveal = () => {
    const height = dialogRef.current?.getBoundingClientRect().height ?? null
    listScrollRef.current = listRef.current?.scrollTop ?? 0
    heightFromRef.current = height
    setLockedHeight(height)
    setReveal({ flyFrom: badgeRef.current?.getBoundingClientRect() ?? null })
  }
  const hideReveal = (from) => {
    heightFromRef.current = dialogRef.current?.getBoundingClientRect().height ?? null
    returnRef.current = { from }
    setReveal(null)
    onStep('back_to_edit')
  }
  // What the reveal shows, as the analytics may know it: which way the UE
  // went, how many grades were changed (bucketed), whether some were added
  // by hand (with a grade typed in). Never a grade nor the UE.
  const reportReveal = (outcome) => {
    const addedGradeCount = Object.values(customs).flat().filter((custom) => overrides[custom.id] != null).length
    onStep('reveal_shown', describeRevealForAnalytics(outcome, { editCount, addedGradeCount }))
  }

  useLayoutEffect(() => {
    // The sheet eases to its new height rather than jumping (the step's
    // locked as a min-height, the reveal can still be taller).
    const dialog = dialogRef.current
    const fromHeight = heightFromRef.current
    heightFromRef.current = null
    if (dialog && fromHeight != null && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const toHeight = dialog.getBoundingClientRect().height
      if (Math.abs(toHeight - fromHeight) > 2) {
        dialog.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
      }
    }
    const back = returnRef.current
    returnRef.current = null
    if (reveal || !back) return
    if (listRef.current) listRef.current.scrollTop = listScrollRef.current
    pickedTitleRef.current?.focus({ preventScroll: true })
    const badge = badgeRef.current
    if (!badge) return
    // Its last flight's class still on: off, then on again, to replay it.
    badge.classList.remove('ue-picked-fly')
    if (!back.from) return
    void badge.offsetWidth
    flyBadge(badge, back.from)
  }, [reveal])

  // Focus in, page scroll locked; focus back on the opener when it closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.setProperty('overflow', 'hidden')
    return () => {
      root.style.setProperty('overflow', previousOverflow)
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.({ preventScroll: true })
    }
  }, [])

  // On the window, capturing: Escape closes the sheet before anything under
  // it (the UE view) hears it; Tab stays inside.
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const isInside = dialogRef.current.contains(document.activeElement)
    if (event.shiftKey && (!isInside || document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (!isInside || document.activeElement === last)) {
      event.preventDefault()
      first.focus()
    }
  }
  const keyHandlerRef = useRef(handleKeyDown)
  useLayoutEffect(() => {
    keyHandlerRef.current = handleKeyDown
  })
  useEffect(() => {
    const listener = (event) => keyHandlerRef.current(event)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  return createPortal(
    <div className="gd-root fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0" role="presentation">
      <div className="weather-modal-backdrop absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="gd-dialog relative isolate flex max-h-[min(860px,calc(100dvh-40px))] w-[min(600px,100%)] flex-col corners-[26px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none max-sm:max-h-[calc(100dvh-16px)] max-sm:rounded-b-none max-sm:border-b-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={picked && lockedHeight ? { minHeight: lockedHeight } : undefined}
      >
        <header className="relative">
          <span className="gd-grabber relative mx-auto hidden h-[4px] w-9 rounded-full bg-text-30 max-sm:block max-sm:translate-y-2" aria-hidden="true" />
          <div className="relative flex items-center gap-3 px-6 pt-5 pb-3 max-sm:px-4 max-sm:pt-[14px]">
            <Icon icon="carbon:calculator" className="size-6 shrink-0 text-text" aria-hidden="true" />
            <span className="grid min-w-0 flex-1 gap-[2px]">
              <h2 id={titleId} className="m-0 truncate font-display text-[20px] font-bold leading-none text-text max-sm:text-[19px]">Simuler mes notes</h2>
              {semesterLabel ? (
                <span className="truncate font-body text-[12.5px] font-medium leading-none text-text-muted">{semesterLabel}</span>
              ) : null}
            </span>
            <CloseButton onClick={onClose} />
          </div>
        </header>
        {picked ? (
          // Second step: the UE picked, small in the corner with its name
          // and average, then its ressources and SAÉ to type grades in.
          <div ref={listRef} hidden={reveal != null} className="min-h-[160px] flex-1 overflow-y-auto overscroll-contain px-6 pb-6 max-sm:px-4 max-sm:pb-[max(24px,env(safe-area-inset-bottom))]">
            <GradeSimulatorUe
              ue={picked}
              report={report}
              overrides={overrides}
              onOverride={setOverride}
              customs={customs}
              customActions={customActions}
              onInvalidChange={reportInvalid}
              subjectIcon={subjectIcon}
              badgeRef={badgeRef}
              titleRef={pickedTitleRef}
            />
          </div>
        ) : null}
        {/* Once a grade is typed in: on to the result. */}
        {picked && editCount && !reveal ? (
          <footer className="semester-fade relative z-10 flex items-center gap-3 rounded-b-[25px] border-t border-border bg-bg px-6 py-3 max-sm:rounded-b-none max-sm:px-4 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]">
            <span className={`min-w-0 flex-1 truncate font-body text-[14px] font-medium ${hasInvalid ? 'text-error' : 'text-text-secondary'}`} aria-live="polite">
              {hasInvalid ? 'Une note n’est pas valide' : `${editCount} ${editCount > 1 ? 'notes modifiées' : 'note modifiée'}`}
            </span>
            <LentButton className="min-h-[44px] px-5 py-[11px] text-[16px]" disabled={hasInvalid} onClick={showReveal}>
              Suivant
              <Icon icon="carbon:arrow-right" className="ml-2 inline-block size-[18px] align-[-4px]" aria-hidden="true" />
            </LentButton>
          </footer>
        ) : null}
        {picked && reveal ? (
          <GradeSimulatorReveal
            ue={picked}
            ues={ues}
            releve={simulatedReleve}
            overrides={overrides}
            flyFrom={reveal.flyFrom}
            onEdit={hideReveal}
            onShown={reportReveal}
            onClose={onClose}
          />
        ) : null}
        {picked ? null : (
          // First step: the UE to simulate, picked on the dial below. The
          // subtitle, its name, follows the dial (read out as it changes);
          // two lines kept for it, so the sheet keeps its size.
          <div className="flex min-h-[160px] flex-1 flex-col items-center justify-center gap-5 overflow-y-auto overscroll-contain px-6 py-4 text-center max-sm:min-h-[24dvh] max-sm:px-4">
            <div className="grid max-w-[420px] gap-2">
              <h3 className="m-0 text-balance font-display text-[24px] font-bold leading-[1.15] text-text max-sm:text-[22px]">
                Choisis l’UE que tu veux simuler
              </h3>
              <p key={activeUe?.code} className="semester-fade m-0 line-clamp-2 min-h-[2.8em] text-balance font-body text-[15px] font-medium leading-[1.4] text-text-secondary" aria-live="polite">
                {activeUe ? activeUe.title || formatUeCode(activeUe.code) : 'Aucune UE'}
              </p>
            </div>
            <LentButton className="min-h-[46px] px-6 py-3 text-[16px]" disabled={!activeUe} onClick={goToUe}>
              Suivant
              <Icon icon="carbon:arrow-right" className="ml-2 inline-block size-[18px] align-[-4px]" aria-hidden="true" />
            </LentButton>
          </div>
        )}
        {/* Flush with the bottom edge, which cuts the dial. Once a UE is
            picked it leaves from where it stands, over the second step. */}
        {picked ? (
          dialGone ? null : (
            <div className="absolute inset-x-0 bottom-0">
              <UeDial ues={ues} turn={turn} onTurn={setTurn} leaving hiddenCode={picked.code} onLeft={() => setDialGone(true)} />
            </div>
          )
        ) : (
          <UeDial ues={ues} turn={turn} onTurn={setTurn} />
        )}
      </section>
    </div>,
    document.body,
  )
}

export default GradeSimulatorModal
