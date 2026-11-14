import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { readSemesterUes } from '../semesterUes'
import { useUeColor } from '../useUeColor'
import { RING_SIZE as SIZE, buildRingSegmentPath, buildRingSegments, readSegmentIndexAt } from '../ueRingGeometry'
import CardInfoTip from './CardInfoTip'
import { r } from '../register.js'

// Ring drawn in a 120×120 box (ueRingGeometry.js), shown at the ECTS
// ring's size (.ue-ring).
// The hovered (or focused, or tapped) UE's segment: this much thicker on
// each side, in the box's units, over this long.
const GROW = 3
const GROW_LENGTH = 150
const easeOutCubic = (progress) => 1 - (1 - progress) ** 3
const CARD_CLASSES = 'ue-widget widget-card shadow-md size-[188px] shrink-0 p-4 border card-corners overflow-hidden text-base leading-6 border-white bg-widget-bg flex flex-col gap-[6px] text-text max-md:order-1 max-md:h-auto max-md:min-h-[160px] max-md:w-auto max-md:flex-[1_0_clamp(136px,40%,170px)] max-md:snap-start max-md:p-3 relative'

function formatAverage(value) {
  return String(parseFloat(value.toFixed(2)))
}

// A UE validated otherwise than by its average (readSemesterUes'
// `validatedBy`): said in the card's label, and under its average in the
// ring's centre when it's the one shown.
const VALIDATED_BY = {
  average: { spoken: 'validée' },
  capitalization: { spoken: 'capitalisée', short: 'capitalisée' },
  compensation: { spoken: 'validée par compensation', short: 'compensée' },
  jury: { spoken: 'validée par le jury', short: 'par le jury' },
}

// UEs of the semester as a ring of coloured segments: filled when the UE is
// validated (≥ 10/20, or under it once compensated, capitalised or validated
// by the jury: ScoDoc's ECTS and jury codes say so), grey with a coloured
// outline below, filled but faded with no average yet. The centre counts the validated UEs; hovering,
// focusing or tapping a segment shows that UE's average there instead.
// Hidden until one UE has an average. `icon`: an image before the title.
function WidgetUes({ releve = null, config = null, visible = false, icon = null }) {
  const paintUe = useUeColor()
  const ues = useMemo(
    () => readSemesterUes(releve, config).map((ue) => ({ ...ue, color: paintUe(ue.color) })),
    [releve, config, paintUe],
  )
  const [activeIndex, setActiveIndex] = useState(null)
  const ringRef = useRef(null)
  // Touch has no hover: a tap on a segment shows its average (a tap on the
  // centre, or anywhere else, hides it). `isTouchRef`: the pointer that
  // pressed, read by the click that follows (a swipe never clicks).
  const isTouchRef = useRef(false)

  useEffect(() => {
    if (activeIndex == null) return undefined
    const handlePointerDown = (event) => {
      if (!ringRef.current?.contains(event.target)) setActiveIndex(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [activeIndex])

  const segments = useMemo(() => {
    const geometry = buildRingSegments(ues.length)
    return ues.map((ue, index) => ({ ...ue, ...geometry[index] }))
  }, [ues])

  // The active segment thickens (and the one before thins back), frame by
  // frame from here: WebKit can't transition a path's `d` in CSS.
  // `growRef`: how far each segment has grown (0 to 1), anew with new
  // segments (their paths drawn thin again).
  const pathRefs = useRef([])
  // Each segment's rim and the clip that keeps it inside: the same path.
  const rimRefs = useRef([])
  const clipRefs = useRef([])
  const ringId = useId().replace(/:/g, '')
  const growRef = useRef({ segments: null, values: [] })
  useEffect(() => {
    if (growRef.current.segments !== segments) growRef.current = { segments, values: [] }
    const { values } = growRef.current
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let last = null
    const tick = (now) => {
      const step = reducedMotion ? 1 : (now - (last ?? now)) / GROW_LENGTH
      last = now
      let moving = false
      segments.forEach((segment, index) => {
        const target = index === activeIndex ? 1 : 0
        const current = values[index] ?? 0
        if (current === target) return
        const next = current < target ? Math.min(target, current + step) : Math.max(target, current - step)
        values[index] = next
        const d = buildRingSegmentPath(segment.start, segment.end, segments.length, GROW * easeOutCubic(next))
        for (const refs of [pathRefs, rimRefs, clipRefs]) refs.current[index]?.setAttribute('d', d)
        if (next !== target) moving = true
      })
      if (moving) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [activeIndex, segments])

  if (!ues.some((ue) => ue.average != null)) {
    return null
  }

  // The segment under the pointer, or null off the ring.
  const readSegmentIndex = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const scale = SIZE / box.width
    return readSegmentIndexAt((event.clientX - box.left) * scale, (event.clientY - box.top) * scale, segments.length)
  }

  const validatedCount = ues.filter((ue) => ue.state === 'validated').length
  const active = activeIndex != null ? segments[activeIndex] : null
  const summary = ues
    .map((ue) => `${ue.code} : ${ue.average != null ? formatAverage(ue.average) : 'pas encore de moyenne'}${ue.state === 'validated' ? `, ${VALIDATED_BY[ue.validatedBy]?.spoken ?? 'validée'}` : ''}`)
    .join(' ; ')

  return (
    <article
      className={`${CARD_CLASSES} ${visible ? 'widget-card-visible' : ''}`}
      aria-label={`UE validées : ${validatedCount} sur ${ues.length}. ${summary}`}
    >
      <div className="relative z-10 flex items-center gap-[5px] min-w-0">
        {icon ? <img src={icon} alt="" width="22" height="22" draggable="false" className="mr-[3px] size-[22px] shrink-0 select-none" aria-hidden="true" /> : null}
        <span className="m-0 min-w-0 leading-[1.06] text-base font-medium text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[14px]">UE validées</span>
        <CardInfoTip label="Les UE, c’est quoi ?">
          Chaque segment est une UE (unité d’enseignement) : plein quand elle est validée, par une moyenne de 10/20 ou plus, par compensation ou parce qu’elle est capitalisée. <span className="max-md:hidden">{r('Survole', 'Survolez')}</span><span className="md:hidden">{r('Touche', 'Touchez')}</span> un segment pour voir sa moyenne.
        </CardInfoTip>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center">
        <svg
          ref={ringRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="ue-ring block shrink-0 size-[120px] overflow-visible max-md:size-auto max-md:w-full max-md:max-w-[108px]"
          aria-hidden="true"
          onPointerDown={(event) => { isTouchRef.current = event.pointerType === 'touch' }}
          onPointerMove={(event) => {
            if (event.pointerType !== 'touch') setActiveIndex(readSegmentIndex(event))
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch') setActiveIndex(null)
          }}
          onClick={(event) => {
            if (isTouchRef.current) setActiveIndex(readSegmentIndex(event))
          }}
        >
          {/* The segments' texture, the buttons' strokes: an edge in a
              deeper shade of the UE's colour (.ue-ring-segment) and a white
              rim inside it, lit from the top of the ring (the gradient
              spans the whole ring), clipped to the segment. */}
          <defs>
            <linearGradient id={`${ringId}-rim`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={SIZE}>
              <stop offset="0" className="ue-ring-rim-top" />
              <stop offset="1" className="ue-ring-rim-bottom" />
            </linearGradient>
            {segments.map((segment, index) => (
              <clipPath key={segment.code} id={`${ringId}-clip-${index}`}>
                <path ref={(element) => { clipRefs.current[index] = element }} d={segment.path} />
              </clipPath>
            ))}
          </defs>
          {segments.map((segment, index) => (
            <g
              key={segment.code}
              className={`ue-ring-group ${activeIndex === index ? 'is-active' : ''}`}
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <path
                ref={(element) => { pathRefs.current[index] = element }}
                d={segment.path}
                className={`ue-ring-segment ue-ring-segment--${segment.state} ${activeIndex === index ? 'ue-ring-segment--active' : ''}`}
                style={{ '--ue-color': segment.color }}
                tabIndex={0}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
              />
              {segment.state === 'pending' ? null : (
                <path
                  ref={(element) => { rimRefs.current[index] = element }}
                  d={segment.path}
                  className="ue-ring-rim"
                  stroke={`url(#${ringId}-rim)`}
                  clipPath={`url(#${ringId}-clip-${index})`}
                />
              )}
            </g>
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          {active ? (
            <>
              <span className="max-w-[72px] truncate font-body text-[12px] font-semibold leading-tight text-text-muted">{active.code}</span>
              <span className="font-display text-[26px] font-bold leading-none max-md:text-[22px]">{active.average != null ? formatAverage(active.average) : '—'}</span>
              {VALIDATED_BY[active.validatedBy]?.short ? (
                <span className="mt-[3px] max-w-[76px] truncate font-body text-[11px] font-medium leading-none text-text-muted">{VALIDATED_BY[active.validatedBy].short}</span>
              ) : null}
            </>
          ) : (
            <>
              <span className="font-display text-[37px] font-bold leading-none max-md:text-[32px]">{validatedCount}</span>
              <span className="text-[19px] font-medium leading-[1.06] max-md:text-[17px]">/{ues.length}</span>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

export default WidgetUes
