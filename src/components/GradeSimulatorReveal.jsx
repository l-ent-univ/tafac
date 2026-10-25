import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { shadeHex } from '../colorContrast'
import { GRADE_SCALE, projectAverages } from '../gradesReport'
import { formatScore, formatUeCode } from '../gradesSubjects'
import { describeMove, describeUeOutcome, formatDelta, parseLinearEasing, sampleEasing, speakOutcome } from '../gradeSimulation'
import { buildSegmentPath, pointAt } from '../ueRingGeometry'
import LentButton from './LentButton'
import UeBadge from './UeBadge'

const CARD_CLASSES = 'widget-card widget-card-visible shadow-md border border-white card-corners bg-widget-bg text-text p-2 min-w-0'

// The gauge: the UE ring again (the dial's ribbon), as a dashboard arc from
// 0 (bottom left) to 20 (bottom right), so 10, the pass mark, is right at
// the top. Drawn in ueRingGeometry's 120×120 box (centre 60,60).
const GAUGE_OUTER = 56
const GAUGE_INNER = 42
const GAUGE_MID = (GAUGE_OUTER + GAUGE_INNER) / 2
const GAUGE_SWEEP = (2 * Math.PI) / 3
// The box shown: room above for the "10", below for the ends' labels.
const VIEW_TOP = -9
const VIEW_HEIGHT = 106
// The UE's badge sits inside the arc, on the same centre: UeBadge's ribbon
// (outer radius ≈ 95.1 around (91.8, 99.1) in its 36…148 × 52 box) scaled
// down to an outer radius a little inside the gauge's.
const BADGE_SCALE = 37 / 95.1
const BADGE_BOX = {
  left: `${((60 - (91.8 - 36) * BADGE_SCALE) / 120) * 100}%`,
  top: `${((60 - 99.1 * BADGE_SCALE - VIEW_TOP) / VIEW_HEIGHT) * 100}%`,
  width: `${((112 * BADGE_SCALE) / 120) * 100}%`,
}
// The ribbon's shadows, as the dial's (UeBadge's, scaled to the gauge).
const SHADOWS = [[-1, 1, 2, 0.36], [-4, 6, 3.5, 0.31], [-9, 13, 5, 0.18], [-16, 24, 5.5, 0.05], [-25, 37, 6.5, 0.01]]
  .map(([dx, dy, blur, opacity]) => [dx * 0.5, dy * 0.5, blur * 0.5, opacity])

// The beats, in ms from the step's start. While the badge flies in, the
// gauge sweeps up to the UE's average as it is; a breath on it, the old
// value marked; then the spring to the simulated one, and the verdict.
const INTRO_START = 280
const INTRO_LENGTH = 680
const MOVE_START = INTRO_START + INTRO_LENGTH + 240
const MOVE_LENGTH = 1100
// The verdict comes as the spring's last, tiny swings play out, not after.
const VERDICT_AT = 0.72

const PASS_MARK = 10
const UP_TONES = new Set(['crossed', 'up', 'closer'])

const COPY = {
  crossed: { title: 'Tu valides l’UE !', text: () => 'Avec ces notes, ta moyenne passe au-dessus de 10.' },
  up: { title: 'Ta moyenne monte', text: () => 'L’UE reste validée, avec plus de marge.' },
  closer: { title: 'Tu te rapproches', text: (missing) => `Plus que ${points(missing)} pour valider l’UE.` },
  down: { title: 'L’UE reste validée', text: () => 'Ta moyenne baisse un peu, mais tu restes au-dessus de 10.' },
  dropped: { title: 'Ça se jouerait de peu', text: (missing) => `Il te manquerait ${points(missing)} pour valider l’UE. Rien n’est joué.` },
  short: { title: 'Encore un effort', text: (missing) => `Il manque ${points(missing)} pour valider l’UE. Tout reste jouable.` },
  same: { title: 'Rien ne bouge', text: () => 'Avec ces notes, la moyenne de l’UE reste la même.' },
}

function points(value) {
  const shown = Math.max(0.01, value)
  return `${formatScore(shown)} point${shown >= 2 ? 's' : ''}`
}

const clampGrade = (value) => Math.min(GRADE_SCALE, Math.max(0, value))
const angleOf = (value) => -GAUGE_SWEEP + (clampGrade(value) / GRADE_SCALE) * 2 * GAUGE_SWEEP
const easeOutCubic = (progress) => 1 - (1 - progress) ** 3
const easeInOutCubic = (progress) => (progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2)

function buildFill(value) {
  return value > 0.02 ? buildSegmentPath(-GAUGE_SWEEP, angleOf(value), 0, GAUGE_OUTER, GAUGE_INNER) : ''
}

// The middle of the band from 0 to `value`, for the gleam passing along it.
function buildMidLine(value) {
  const [x1, y1] = pointAt(-GAUGE_SWEEP, GAUGE_MID)
  const end = angleOf(value)
  const [x2, y2] = pointAt(end, GAUGE_MID)
  return `M${x1},${y1}A${GAUGE_MID},${GAUGE_MID} 0 ${end + GAUGE_SWEEP > Math.PI ? 1 : 0} 1 ${x2},${y2}`
}

// A short line across the band (or just outside it) at a value.
function buildTick(value, from, to) {
  const [x1, y1] = pointAt(angleOf(value), from)
  const [x2, y2] = pointAt(angleOf(value), to)
  return `M${x1},${y1}L${x2},${y2}`
}

// A UE colour lightened toward white.
function tintHex(color, amount) {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return color
  const value = parseInt(match[1], 16)
  return `#${[16, 8, 0].map((shift) => {
    const channel = (value >> shift) & 255
    return Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, '0')
  }).join('')}`
}

// The celebration: little UE ribbons and sparks thrown up from the gauge's
// tip, falling back with a flutter. On a canvas over the whole sheet, gone
// once they've all faded.
function launchBurst(canvas, origin, color, strength) {
  const context = canvas.getContext('2d')
  if (!context) return () => {}
  const ratio = window.devicePixelRatio || 1
  const box = canvas.getBoundingClientRect()
  canvas.width = Math.round(box.width * ratio)
  canvas.height = Math.round(box.height * ratio)
  context.scale(ratio, ratio)
  const palette = [color, color, tintHex(color, 0.35), tintHex(color, 0.6), shadeHex(color, 0.72), '#F2B33D']
  const count = Math.round(26 + strength * 34)
  const pieces = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.3
    const speed = (0.45 + Math.random() * 0.75) * (360 + strength * 360)
    return {
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: (Math.random() - 0.5) * 14,
      flip: Math.random() * Math.PI * 2,
      flipSpeed: 6 + Math.random() * 8,
      rotation: Math.random() * Math.PI * 2,
      size: 5 + Math.random() * 4.5,
      // A third are sparks (four-point stars), the rest ribbons.
      kind: index % 3 === 0 ? 'spark' : 'ribbon',
      color: palette[index % palette.length],
      life: 1300 + Math.random() * 900,
    }
  })
  let frame = 0
  let last = performance.now()
  const start = last
  const draw = (now) => {
    const step = Math.min(0.032, (now - last) / 1000)
    last = now
    const age = now - start
    context.clearRect(0, 0, box.width, box.height)
    let alive = 0
    for (const piece of pieces) {
      if (age > piece.life) continue
      alive += 1
      piece.vy += 1500 * step
      piece.vx *= 1 - 1.6 * step
      piece.vy *= 1 - 1.1 * step
      piece.x += piece.vx * step
      piece.y += piece.vy * step
      piece.rotation += piece.spin * step
      piece.flip += piece.flipSpeed * step
      const fade = Math.min(1, (piece.life - age) / 380)
      context.save()
      context.globalAlpha = fade
      context.translate(piece.x, piece.y)
      context.rotate(piece.rotation)
      context.fillStyle = piece.color
      if (piece.kind === 'spark') {
        const size = piece.size * (0.7 + 0.3 * Math.abs(Math.cos(piece.flip)))
        context.beginPath()
        for (let point = 0; point < 8; point += 1) {
          const radius = point % 2 === 0 ? size : size * 0.32
          const turn = (point * Math.PI) / 4
          context.lineTo(Math.cos(turn) * radius, Math.sin(turn) * radius)
        }
        context.closePath()
        context.fill()
      } else {
        // A bit of ribbon, curved like the UE's, tumbling (its width
        // following the flip).
        context.scale(1, Math.cos(piece.flip))
        context.beginPath()
        context.arc(0, piece.size * 1.6, piece.size * 1.6, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6)
        context.arc(0, piece.size * 1.6, piece.size * 0.95, -Math.PI / 2 + 0.6, -Math.PI / 2 - 0.6, true)
        context.closePath()
        context.fill()
      }
      context.restore()
    }
    if (alive) frame = requestAnimationFrame(draw)
    else context.clearRect(0, 0, box.width, box.height)
  }
  frame = requestAnimationFrame(draw)
  return () => cancelAnimationFrame(frame)
}

// An average rolling from its old value to its new one once `start`; its
// text written here only, frame by frame.
function RollingScore({ from, to, start, delay = 0 }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    element.textContent = to != null ? formatScore(to) : '—'
    if (!start || from == null || to == null || Math.abs(to - from) < 0.005) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    let frame = 0
    const begin = performance.now() + delay
    const tick = (now) => {
      const progress = Math.min(1, Math.max(0, (now - begin) / 900))
      element.textContent = progress < 1 ? (from + (to - from) * easeOutCubic(progress)).toFixed(2) : formatScore(to)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    element.textContent = from.toFixed(2)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [from, to, start, delay])
  return <span ref={ref} />
}

function DeltaChip({ move }) {
  if (move.delta == null) return null
  const up = move.delta > 0
  return (
    <span className={`inline-flex shrink-0 items-center gap-[3px] rounded-full font-display font-bold leading-none px-[7px] py-[4px] text-[12.5px] ${up ? 'bg-success-bg text-success-text' : 'bg-bg-subtle text-text-secondary'}`}>
      <Icon icon={up ? 'carbon:arrow-up' : 'carbon:arrow-down'} className="size-[12px]" aria-hidden="true" />
      {formatDelta(move.delta).slice(1)}
    </span>
  )
}

// One row of the "Et sur le semestre" card: a badge, a label with the
// average as it was under it, the new one rolling to its place, and the
// change.
function MoveRow({ badge, label, move, start, delay }) {
  return (
    <li className="flex min-w-0 items-center gap-3 corners-[14px] px-2 py-[8px] max-sm:gap-[10px]">
      {badge}
      <span className="grid min-w-0 flex-1 gap-[3px]">
        <span className="truncate font-body text-[14.5px] font-semibold leading-[1.3] text-text" title={label}>{label}</span>
        {move.official != null ? (
          <span className="truncate font-body text-[13px] font-medium leading-[1.3] text-text-muted">avant {formatScore(move.official)}</span>
        ) : null}
      </span>
      <span className="inline-flex shrink-0 items-baseline gap-[2px] leading-none">
        <span className="font-display text-[17px] font-bold tabular-nums text-text">
          <RollingScore from={move.official} to={move.value} start={start} delay={delay} />
        </span>
        <span className="font-body text-[12px] font-medium text-text-muted">/20</span>
      </span>
      <DeltaChip move={move} />
    </li>
  )
}

// The simulator's last step: what the grades typed in would do. The UE's
// badge flies from the corner to the middle of a gauge (the UE ring as a
// dashboard, 10 at the top); the gauge sweeps up to the UE's average as it
// is, the old value stays marked, then the ribbon springs to the simulated
// average, the number rolling with it. The verdict follows in words, a
// burst of the UE's ribbons when it goes up; then the general average and
// the other UEs that move. Screen readers get it all at
// once, in words (speakOutcome). `flyFrom`: the corner badge's box.
// `onShown(outcome)`: once per reveal, for the anonymous analytics.
function GradeSimulatorReveal({ ue, ues, releve, overrides, flyFrom = null, onEdit, onShown = () => {}, onClose }) {
  const id = useId().replace(/:/g, '')
  const projection = useMemo(() => projectAverages(releve, overrides), [releve, overrides])
  const own = projection.ues[ue.code] ?? { official: ue.average, projected: null }
  // Validated under 10 (capitalised, compensated, or by the jury: see
  // describeUeValidation): it stays validated whatever its average.
  const validatedAnyway = ue.state === 'validated' && !(own.official >= PASS_MARK)
  const outcome = describeUeOutcome(own.official, own.projected, { capitalized: validatedAnyway })
  const general = describeMove(projection.general.official, projection.general.projected)
  const others = ues
    .filter((entry) => entry.code !== ue.code)
    .map((entry) => ({ ...entry, move: describeMove(projection.ues[entry.code]?.official, projection.ues[entry.code]?.projected) }))
    .filter((entry) => entry.move.changed)
  const spoken = speakOutcome({
    ue: outcome,
    general,
    others: others.map((entry) => ({ label: formatUeCode(entry.code), move: entry.move })),
  })
  const copy = COPY[outcome.tone]
  const isUp = UP_TONES.has(outcome.tone)
  // Once per reveal (the ref outlives StrictMode's second effect run): the
  // grades can't change while it's shown.
  const hasReportedRef = useRef(false)
  useEffect(() => {
    if (hasReportedRef.current) return
    hasReportedRef.current = true
    onShown(outcome)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const from = outcome.official ?? 0
  const to = outcome.value ?? from

  // 'intro': sweeping up to the average as it is; 'move': to the simulated
  // one; 'settled': the verdict.
  const [phase, setPhase] = useState('intro')
  const rootRef = useRef(null)
  const badgeRef = useRef(null)
  const canvasRef = useRef(null)
  const announceRef = useRef(null)
  const fillRef = useRef(null)
  const clipRef = useRef(null)
  const edgeRef = useRef(null)
  const knobRef = useRef(null)
  const numberRef = useRef(null)
  const passRef = useRef(null)

  // The badge flies in from the corner, as it flew there (.ue-picked-fly);
  // focus goes to the result, read out in words.
  useLayoutEffect(() => {
    announceRef.current?.focus({ preventScroll: true })
    const badge = badgeRef.current
    if (!flyFrom || !badge) return
    // Measured where it lands, without a flight already started (effects
    // run twice in development).
    badge.classList.remove('ue-picked-fly')
    const box = badge.getBoundingClientRect()
    badge.style.setProperty('--fly-x', `${flyFrom.left + flyFrom.width / 2 - (box.left + box.width / 2)}px`)
    badge.style.setProperty('--fly-y', `${flyFrom.top + flyFrom.height / 2 - (box.top + box.height / 2)}px`)
    badge.style.setProperty('--fly-s', String(flyFrom.width / box.width))
    void badge.offsetWidth
    badge.classList.add('ue-picked-fly')
  }, [flyFrom])

  // The gauge and its number, frame by frame, written straight to the SVG
  // so they move together. The spring to the new value is the dial's own
  // (--dial-spring, read back from the CSS), past it and back; going down,
  // the gentler one, barely past it.
  useLayoutEffect(() => {
    let current = 'intro'
    const draw = (value, final = false) => {
      const path = buildFill(value)
      fillRef.current?.setAttribute('d', path)
      clipRef.current?.setAttribute('d', path)
      edgeRef.current?.setAttribute('d', path)
      const [x, y] = pointAt(angleOf(value), GAUGE_MID)
      knobRef.current?.setAttribute('transform', `translate(${x} ${y})`)
      // Nothing before the sweep starts ("0.00" would read as a grade).
      if (numberRef.current) numberRef.current.textContent = final ? formatScore(value) : value > 0 ? value.toFixed(2) : ''
      passRef.current?.classList.toggle('is-lit', value >= PASS_MARK - 0.005)
    }
    const enter = (next) => {
      if (current === next) return
      current = next
      setPhase(next)
    }
    if (outcome.value == null) {
      if (numberRef.current) numberRef.current.textContent = '—'
      enter('settled')
      return undefined
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      draw(to, true)
      enter('settled')
      return undefined
    }
    const spring = parseLinearEasing(getComputedStyle(rootRef.current).getPropertyValue(to < from ? '--fly-spring' : '--dial-spring'))
    const moves = Math.abs(to - from) >= 0.005
    // Down, a shorter, quieter move.
    const length = to < from ? MOVE_LENGTH * 0.8 : MOVE_LENGTH
    let frame = 0
    // From the first frame on.
    let start = null
    const tick = (now) => {
      start ??= now
      const time = now - start
      if (time < INTRO_START) {
        draw(0)
      } else if (time < INTRO_START + INTRO_LENGTH) {
        draw(from * easeOutCubic((time - INTRO_START) / INTRO_LENGTH))
      } else if (!moves) {
        draw(to, true)
        enter('settled')
        return
      } else if (time < MOVE_START) {
        draw(from)
        enter('move')
      } else if (time < MOVE_START + length) {
        const progress = (time - MOVE_START) / length
        const eased = spring ? sampleEasing(spring, progress) : easeInOutCubic(progress)
        draw(from + (to - from) * eased)
        enter(progress < VERDICT_AT ? 'move' : 'settled')
      } else {
        draw(to, true)
        enter('settled')
        return
      }
      frame = requestAnimationFrame(tick)
    }
    draw(0)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [from, to, outcome.value])

  // The burst, once settled, going up: bigger when the UE is won.
  useEffect(() => {
    if (phase !== 'settled' || !isUp || !canvasRef.current || !knobRef.current) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    const canvasBox = canvasRef.current.getBoundingClientRect()
    const knobBox = knobRef.current.getBoundingClientRect()
    const origin = { x: knobBox.left + knobBox.width / 2 - canvasBox.left, y: knobBox.top + knobBox.height / 2 - canvasBox.top }
    return launchBurst(canvasRef.current, origin, ue.color, outcome.tone === 'crossed' ? 1 : outcome.tone === 'up' ? 0.7 : 0.3)
  }, [phase, isUp, ue.color, outcome.tone])

  const [knobX, knobY] = pointAt(angleOf(outcome.value ?? 0), GAUGE_MID)
  const missing = outcome.missing

  return (
    <>
      <div
        ref={rootRef}
        className={`ue-reveal min-h-0 flex-1 overscroll-contain px-6 pb-6 max-sm:px-4 ${phase === 'intro' ? 'overflow-hidden' : 'overflow-y-auto'}`}
        data-phase={phase}
        data-tone={outcome.tone}
        style={{ '--ue-color': ue.color }}
      >
        <p ref={announceRef} tabIndex={-1} className="sr-only outline-none">{spoken}</p>
        <div className="flex min-h-full flex-col justify-center gap-5 pt-1" aria-hidden="true">
          <div className="grid justify-items-center gap-4">
            {/* The gauge, the badge inside it and the number in its middle. */}
            <div className="@container relative w-[min(330px,84%)]" style={{ aspectRatio: `120 / ${VIEW_HEIGHT}` }}>
              <svg viewBox={`0 ${VIEW_TOP} 120 ${VIEW_HEIGHT}`} className="absolute inset-0 block size-full overflow-visible">
                <defs>
                  <filter id={`${id}-shadow`} x="-40%" y="-30%" width="160%" height="170%" colorInterpolationFilters="sRGB">
                    <feColorMatrix in="SourceGraphic" type="matrix" values="0.55 0 0 0 0  0 0.55 0 0 0  0 0 0.55 0 0  0 0 0 1 0" result="shade" />
                    {SHADOWS.map(([dx, dy, blur, opacity], index) => (
                      <Fragment key={index}>
                        <feGaussianBlur in="shade" stdDeviation={blur} />
                        <feOffset dx={dx} dy={dy} />
                        <feComponentTransfer result={`shadow${index}`}>
                          <feFuncA type="linear" slope={opacity} />
                        </feComponentTransfer>
                      </Fragment>
                    ))}
                    <feMerge>
                      {SHADOWS.map((_, index) => <feMergeNode key={index} in={`shadow${SHADOWS.length - 1 - index}`} />)}
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <filter id={`${id}-knob`} x="-60%" y="-60%" width="220%" height="220%">
                    <feDropShadow dx="-0.5" dy="0.8" stdDeviation="0.9" floodColor={shadeHex(ue.color, 0.4)} floodOpacity="0.45" />
                  </filter>
                  {/* The gleam's soft edges (blurred, then cut to the ribbon). */}
                  <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2.4" />
                  </filter>
                  <radialGradient id={`${id}-edge`} cx="60" cy="60" r={GAUGE_OUTER} gradientUnits="userSpaceOnUse">
                    <stop offset={GAUGE_INNER / GAUGE_OUTER} stopColor="#000000" />
                    <stop offset="1" stopColor="#515151" />
                  </radialGradient>
                  <clipPath id={`${id}-clip`}>
                    <path ref={clipRef} d="" />
                  </clipPath>
                </defs>
                {/* The track, 0 to 20, and the pass mark at the top. */}
                <path
                  className="ue-reveal-track"
                  d={buildSegmentPath(-GAUGE_SWEEP, GAUGE_SWEEP, 0, GAUGE_OUTER, GAUGE_INNER)}
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth={1}
                  strokeLinejoin="round"
                />
                <g ref={passRef} className="ue-reveal-pass">
                  <path d={buildTick(PASS_MARK, GAUGE_OUTER + 2.2, GAUGE_OUTER + 5.4)} stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
                  <text x="60" y={60 - GAUGE_OUTER - 8.2} textAnchor="middle" fontSize="5.6" fontWeight="700" fill="currentColor" className="font-display">10</text>
                </g>
                <g className="ue-reveal-ends" fontSize="5" fontWeight="600">
                  <text x={pointAt(-GAUGE_SWEEP, GAUGE_MID)[0]} y={pointAt(-GAUGE_SWEEP, GAUGE_MID)[1] + 11.5} textAnchor="middle" className="font-display">0</text>
                  <text x={pointAt(GAUGE_SWEEP, GAUGE_MID)[0]} y={pointAt(GAUGE_SWEEP, GAUGE_MID)[1] + 11.5} textAnchor="middle" className="font-display">20</text>
                </g>
                {/* Going down: what the UE gives up, faint, from the new
                    average to the old one, showing as the ribbon draws back. */}
                {outcome.delta < 0 ? (
                  <path
                    className="ue-reveal-lost"
                    d={buildSegmentPath(angleOf(outcome.value), angleOf(outcome.official), 0, GAUGE_OUTER, GAUGE_INNER)}
                    fill={ue.color}
                  />
                ) : null}
                {/* The ribbon, in the UE's colour, its lit edge as the dial's. */}
                <g filter={`url(#${id}-shadow)`}>
                  <path ref={fillRef} d="" fill={ue.color} stroke={ue.color} strokeWidth={0.6} strokeLinejoin="round" />
                  <path ref={edgeRef} d="" fill="none" stroke={`url(#${id}-edge)`} strokeWidth={0.6} clipPath={`url(#${id}-clip)`} style={{ mixBlendMode: 'plus-lighter' }} />
                </g>
                {/* Once settled going up: a gleam along the ribbon. */}
                {isUp ? (
                  <path
                    className="ue-reveal-gleam"
                    d={buildMidLine(outcome.value ?? 0)}
                    pathLength={1}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={GAUGE_OUTER - GAUGE_INNER + 4}
                    filter={`url(#${id}-soft)`}
                    clipPath={`url(#${id}-clip)`}
                  />
                ) : null}
                {/* Where the average was: a notch through the band and a dot
                    outside it. */}
                {outcome.changed && outcome.official != null ? (
                  <g className="ue-reveal-was">
                    <path d={buildTick(outcome.official, GAUGE_INNER - 0.6, GAUGE_OUTER + 0.6)} stroke="var(--color-bg)" strokeWidth={1.3} />
                    <circle cx={pointAt(angleOf(outcome.official), GAUGE_OUTER + 3.4)[0]} cy={pointAt(angleOf(outcome.official), GAUGE_OUTER + 3.4)[1]} r={1.25} fill="currentColor" />
                  </g>
                ) : null}
                {/* The tip, a knob riding the ribbon; a ring rippling out of
                    it once settled. */}
                <circle className="ue-reveal-ripple" cx={knobX} cy={knobY} r={6} fill="none" stroke={ue.color} strokeWidth={1.4} />
                <g ref={knobRef} transform={`translate(${knobX} ${knobY})`}>
                  <circle className="ue-reveal-knob" r={4.6} fill="#ffffff" filter={`url(#${id}-knob)`} />
                </g>
              </svg>
              <span ref={badgeRef} className="ue-picked absolute block" style={BADGE_BOX}>
                <UeBadge code={ue.code} color={ue.color} className="h-auto w-full" />
              </span>
              <span className="ue-reveal-readout absolute inset-x-[18%] top-[47.5%] grid justify-items-center gap-[1.6cqw]">
                <span className="ue-reveal-number inline-flex items-baseline gap-[0.8cqw] leading-none">
                  {/* Its text written by the gauge's frames only. */}
                  <span ref={numberRef} className="font-display text-[17.5cqw] font-bold tabular-nums tracking-[-0.02em]" />
                  <span className="font-body text-[5.4cqw] font-semibold text-text-muted">/20</span>
                </span>
                <span key={phase === 'intro' ? 'now' : 'then'} className="ue-reveal-caption whitespace-nowrap font-body text-[max(12px,4.2cqw)] font-medium leading-none text-text-muted">
                  {phase === 'intro' ? 'Ta moyenne actuelle' : 'Avec tes notes'}
                </span>
              </span>
            </div>
            <div className="ue-reveal-later grid max-w-[440px] gap-[6px] text-center [--delay:160ms]">
              <h3 className="m-0 text-balance font-display text-[24px] font-bold leading-[1.15] text-text max-sm:text-[22px]">{copy.title}</h3>
              <p className="m-0 text-balance font-body text-[15px] font-medium leading-[1.4] text-text-secondary">
                {copy.text(missing)}
              </p>
            </div>
          </div>
          {general.value != null || others.length ? (
            <section className={`ue-reveal-later ${CARD_CLASSES} [--delay:300ms]`}>
              <h4 className="m-0 px-2 pt-2 pb-[2px] font-body text-[15px] font-medium leading-[1.06] text-text-muted">Et sur le semestre</h4>
              <ul className="m-0 grid list-none gap-0 p-0">
                {general.value != null ? (
                  <MoveRow
                    badge={(
                      <span className="inline-flex size-9 shrink-0 items-center justify-center corners-[11px] bg-brand-subtle">
                        <Icon icon="carbon:chart-line" className="size-[18px] text-text" />
                      </span>
                    )}
                    label="Moyenne générale"
                    move={general}
                    start={phase === 'settled'}
                    delay={380}
                  />
                ) : null}
                {others.map((entry, index) => (
                  <MoveRow
                    key={entry.code}
                    badge={<UeBadge code={entry.code} color={entry.color} className="h-auto w-[50px]" />}
                    label={entry.title || formatUeCode(entry.code)}
                    move={entry.move}
                    start={phase === 'settled'}
                    delay={460 + index * 80}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      <footer className="ue-reveal-footer relative z-10 flex items-center gap-3 rounded-b-[25px] border-t border-border bg-bg px-6 py-3 max-sm:rounded-b-none max-sm:px-4 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap corners-[32px] border border-border-input bg-transparent px-5 font-body text-[16px] font-semibold text-text transition-colors duration-150 hover:bg-bg-subtle max-sm:flex-1 max-sm:px-4"
          onClick={() => onEdit(badgeRef.current?.getBoundingClientRect() ?? null)}
        >
          <Icon icon="carbon:arrow-left" className="size-[18px]" aria-hidden="true" />
          Modifier mes notes
        </button>
        <LentButton className="ml-auto min-h-[44px] px-6 py-[11px] text-[16px]" onClick={onClose}>
          Terminer
        </LentButton>
      </footer>
      {/* Over the whole sheet, its corners rounded like it. */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-20 size-full rounded-[inherit]" aria-hidden="true" />
    </>
  )
}

export default GradeSimulatorReveal
