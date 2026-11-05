import { Fragment, useId, useMemo } from 'react'
import { Icon } from '@iconify/react'
import LaunchCard from './LaunchCard'
import { pickInkOn } from '../colorContrast'
import { buildSegmentPath, pointAt } from '../ueRingGeometry'
import { useUeColor } from '../useUeColor'
import { r } from '../register.js'

// The « Nouveautés » entry this card launches (src/changelog.js, a
// `spotlight` one): see LaunchCard for when it shows.
const ENTRY_ID = 'mes-notes'

// The simulator's dial (GradeSimulatorModal), small: the same band and gaps,
// its top half standing on the stage's bottom edge.
const DIAL_OUTER = 60
const DIAL_INNER = 34
const DIAL_MID = (DIAL_OUTER + DIAL_INNER) / 2
const DIAL_GAP = 2.6
const FULL_TURN = 2 * Math.PI
// The ring's top half, cut at its centre, with a little room above.
const VIEW_BOX = '-6 -6 132 66'
// Example UEs, not the student's: ScoDoc's BUT colours with plain codes, so
// the drawing reads as one and never passes for a relevé. No grades on it.
const EXAMPLE_UES = ['#b80004', '#f97b3d', '#feb40b', '#80cb3f', '#05162e', '#548687']
  .map((color, index) => ({ code: `UE ${index + 1}`, color }))
// The UE on top as the dial springs in (the orange); the shimmer then turns
// it one UE on, as the simulator's "UE suivante" would, to the yellow.
const TOP_INDEX = 1
const STEP = FULL_TURN / EXAMPLE_UES.length
const STEP_DEG = 360 / EXAMPLE_UES.length
const ROTATION_DEG = -(TOP_INDEX + 0.5) * STEP_DEG
// The ribbons' shadows, as on the dial (UeBadge's, scaled to this radius).
const BADGE_SCALE = DIAL_OUTER / 95
const SHADOWS = [[-1, 1, 2, 0.36], [-4, 6, 3.5, 0.31], [-9, 13, 5, 0.18], [-16, 24, 5.5, 0.05], [-25, 37, 6.5, 0.01]]
  .map(([dx, dy, blur, opacity]) => [dx * BADGE_SCALE, dy * BADGE_SCALE, blur * BADGE_SCALE, opacity])
function buildArc(start, end, radius = DIAL_MID) {
  const [x1, y1] = pointAt(start, radius)
  const [x2, y2] = pointAt(end, radius)
  return `M${x1},${y1}A${radius},${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2},${y2}`
}

// The stage: UE ribbons fanning out of the centre as the dial swings in
// from a quarter turn back and springs into place (the simulator's
// --dial-spring), the « Mes notes » icon popping up in the hollow, then a
// shimmer sweeping over the ribbons as the dial turns one UE on. All CSS
// (.grades-launch-* and .launch-card-* in overrides.css), the final frame
// as is with reduced motion.
function LaunchDial() {
  const id = useId().replace(/:/g, '')
  const paintUe = useUeColor()
  const segments = useMemo(() => EXAMPLE_UES.map((ue, index) => {
    const start = index * STEP
    const end = start + STEP
    const color = paintUe(ue.color)
    const trim = DIAL_GAP / 2 / DIAL_MID
    return { ...ue, color, ink: pickInkOn(color), path: buildSegmentPath(start, end, DIAL_GAP, DIAL_OUTER, DIAL_INNER), arc: buildArc(start + trim, end - trim) }
  }), [paintUe])
  // The shimmer's path, over the visible half from left to right, in the
  // swinging group's own (unturned) angles; it stays put as the ribbons
  // turn under it, clipped to the band.
  const turn = (ROTATION_DEG * Math.PI) / 180
  const shimmerArc = buildArc(-Math.PI / 2 - turn, Math.PI / 2 - turn)
  const band = buildSegmentPath(0, FULL_TURN - 0.0001, 0, DIAL_OUTER, DIAL_INNER)
  const swing = { '--dial-rotation': `${ROTATION_DEG}deg`, '--dial-step': `${-STEP_DEG}deg` }

  return (
    <svg viewBox={VIEW_BOX} className="block h-full w-full" aria-hidden="true">
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
        <radialGradient id={`${id}-edge`} cx="60" cy="60" r={DIAL_OUTER} gradientUnits="userSpaceOnUse">
          <stop offset={DIAL_INNER / DIAL_OUTER} stopColor="#000000" />
          <stop offset="1" stopColor="#515151" />
        </radialGradient>
        <clipPath id={`${id}-band`}>
          <path d={band} />
        </clipPath>
        {segments.map((segment, index) => (
          <Fragment key={segment.code}>
            <clipPath id={`${id}-clip${index}`}>
              <path d={segment.path} />
            </clipPath>
            <path id={`${id}-arc${index}`} d={segment.arc} />
          </Fragment>
        ))}
      </defs>
      {/* Swinging in (-turn), then one UE on (-step), nested so the two
          movements don't override each other's transform. */}
      <g filter={`url(#${id}-shadow)`}>
        <g className="grades-launch-turn" style={swing}>
          <g className="grades-launch-step">
            {segments.map((segment, index) => (
              <g key={segment.code} className="grades-launch-ribbon" style={{ '--i': index }}>
                <path d={segment.path} fill={segment.color} stroke={segment.color} strokeWidth={0.5} strokeLinejoin="round" />
                <path
                  d={segment.path}
                  fill="none"
                  stroke={`url(#${id}-edge)`}
                  strokeWidth={0.5}
                  clipPath={`url(#${id}-clip${index})`}
                  style={{ mixBlendMode: 'plus-lighter' }}
                />
              </g>
            ))}
          </g>
        </g>
      </g>
      {/* The codes and the shimmer over the shadows. */}
      <g className="grades-launch-turn" style={swing}>
        <g className="grades-launch-step">
          {segments.map((segment, index) => (
            <text key={segment.code} className="grades-launch-ribbon font-display" style={{ '--i': index }} fill={segment.ink} fontSize="9" fontWeight="600" letterSpacing="0.15">
              <textPath href={`#${id}-arc${index}`} startOffset="50%" textAnchor="middle" dominantBaseline="central">
                {segment.code}
              </textPath>
            </text>
          ))}
        </g>
        <path
          className="grades-launch-shimmer"
          d={shimmerArc}
          pathLength="1"
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.85}
          strokeWidth={DIAL_OUTER - DIAL_INNER}
          clipPath={`url(#${id}-band)`}
        />
      </g>
    </svg>
  )
}

// Launch card for « Mes notes » (LaunchCard): the simulator's dial, the
// hollow holding the page's icon. `onOpen`: shows « Mes notes ».
function GradesLaunchCard({ onOpen }) {
  return (
    <LaunchCard
      entryId={ENTRY_ID}
      launch="grades"
      title={r('Tes notes, enfin dans l’appli', 'Vos notes, enfin dans l’appli')}
      line="Moyenne, UE, crédits ECTS et un simulateur, semestre par semestre."
      ctaLabel="Voir mes notes"
      closeLabel="Fermer l’annonce de Mes notes"
      onOpen={onOpen}
      stage={(
        <>
          <LaunchDial />
          {/* In the dial's hollow (60, 45 in VIEW_BOX, 30 wide): the page's icon. */}
          <span className="launch-card-hub absolute left-1/2 top-[77.3%] flex aspect-square w-[22.7%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full" aria-hidden="true">
            <span className="launch-card-ripple absolute inset-0 rounded-full" />
            <Icon icon="ph:chart-pie-slice" className="h-[56%] w-[56%]" />
          </span>
        </>
      )}
    />
  )
}

export default GradesLaunchCard
