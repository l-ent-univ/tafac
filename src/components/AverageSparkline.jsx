import { useId, useMemo, useState } from 'react'

// SVG user space. The SVG stretches to its box (preserveAspectRatio="none")
// and the strokes keep their pixel width (vector-effect), so the dots and the
// hover label are HTML laid over it in percentages rather than SVG shapes.
const WIDTH = 100
const HEIGHT = 100
// The line keeps to this band of the layer (top to bottom, in %): under the
// card's title, above its number. The tinted fill runs on to the bottom.
const LINE_TOP = 6
const LINE_BOTTOM = 34
// The y range never shrinks below 3 points, so a ±0.1 wobble stays flat.
const MIN_SPAN = 3
// While the semester runs, the grades so far take this share of the width
// (spaced by date) and the faded rest of the semester the remainder. On a
// true time scale, three weeks out of five months would be squeezed into a
// sliver.
const SOLID_SHARE = 0.72

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

function toTime(date) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? time : null
}

// Monotone cubic through the points (Fritsch–Carlson, d3's curveMonotoneX):
// smooth, and never overshoots between two real averages.
function buildMonotonePath(points) {
  const count = points.length
  const dx = []
  const slopes = []
  for (let i = 0; i < count - 1; i += 1) {
    dx.push(points[i + 1].x - points[i].x)
    slopes.push((points[i + 1].y - points[i].y) / dx[i])
  }

  const tangents = [slopes[0]]
  for (let i = 1; i < count - 1; i += 1) {
    tangents.push(slopes[i - 1] * slopes[i] <= 0
      ? 0
      : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / slopes[i - 1] + (dx[i] + 2 * dx[i - 1]) / slopes[i]))
  }
  tangents.push(slopes[count - 2])

  let path = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < count - 1; i += 1) {
    const third = dx[i] / 3
    path += `C${points[i].x + third},${points[i].y + tangents[i] * third},${points[i + 1].x - third},${points[i + 1].y - tangents[i + 1] * third},${points[i + 1].x},${points[i + 1].y}`
  }
  return path
}

function formatAverage(value) {
  return String(parseFloat(value.toFixed(2)))
}

// The general average over the semester, drawn as the card's background:
// a tinted line from edge to edge, solid up to the latest grade (marked by a
// pulsing dot), then faded for the rest of the semester.
function AverageSparkline({ history, semesterEnd = null, className = '' }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  // Read once on mount: is the semester still running?
  const [now] = useState(Date.now)
  const fillId = useId()

  const chart = useMemo(() => {
    const dated = (history ?? [])
      .map((point) => ({ ...point, time: toTime(point.date) }))
      .filter((point) => point.time != null)
    if (dated.length < 2) return null

    const start = dated[0].time
    const last = dated[dated.length - 1].time
    const endTime = toTime(semesterEnd)
    // Only a semester still running has a rest to come (and a live latest
    // grade); a past one is drawn whole.
    const hasRest = endTime != null && endTime > last && endTime > now
    const solidWidth = hasRest ? WIDTH * SOLID_SHARE : WIDTH
    const values = dated.map((point) => point.average)
    const low = Math.min(...values)
    const high = Math.max(...values)
    const span = Math.max(high - low, MIN_SPAN)
    const floor = (low + high) / 2 - span / 2
    const toX = (time) => ((time - start) / (last - start)) * solidWidth
    const toY = (value) => LINE_TOP + (1 - (value - floor) / span) * (LINE_BOTTOM - LINE_TOP)

    const points = dated.map((point) => ({ ...point, x: toX(point.time), y: toY(point.average) }))
    const tip = points[points.length - 1]
    const line = buildMonotonePath(points)
    return {
      points,
      tip,
      isOngoing: hasRest,
      line,
      // One fill under the line and the rest of the semester alike: only the
      // line fades, so there's no seam at the latest grade.
      area: `${line}H${WIDTH}V${HEIGHT}H0Z`,
      rest: hasRest ? `M${tip.x},${tip.y}H${WIDTH}` : null,
      summary: `Évolution de la moyenne : ${formatAverage(points[0].average)} le ${DAY_FORMAT.format(points[0].time)}, ${formatAverage(tip.average)} le ${DAY_FORMAT.format(tip.time)}`,
    }
  }, [history, semesterEnd, now])

  if (!chart) return null

  // Nearest point to the pointer, in x only.
  const handlePointer = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * WIDTH
    let nearest = 0
    for (let i = 1; i < chart.points.length; i += 1) {
      if (Math.abs(chart.points[i].x - x) < Math.abs(chart.points[nearest].x - x)) nearest = i
    }
    setHoverIndex(nearest)
  }

  const hovered = hoverIndex != null ? chart.points[hoverIndex] : null

  return (
    <div
      role="img"
      aria-label={chart.summary}
      className={`average-sparkline ${className}`}
      onPointerMove={handlePointer}
      onPointerDown={handlePointer}
      onPointerLeave={() => setHoverIndex(null)}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.12" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={chart.area} fill={`url(#${fillId})`} />
        {chart.rest ? (
          <path d={chart.rest} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ) : null}
        <path d={chart.line} fill="none" stroke="currentColor" strokeOpacity="0.6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Latest grade of a semester still running: a dot with a ring pulsing out of it. */}
      {chart.isOngoing ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-[13px] -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${chart.tip.x}%`, top: `${chart.tip.y}%` }}
        >
          <span className="absolute inset-0 rounded-full bg-current opacity-50 animate-ping motion-reduce:animate-none motion-reduce:opacity-0" />
          <span className="chart-dot absolute inset-0 rounded-full" />
        </span>
      ) : null}
      {hovered ? (
        <>
          <span
            aria-hidden="true"
            className="chart-dot pointer-events-none absolute size-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${hovered.x}%`, top: `${hovered.y}%` }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+11px)] whitespace-nowrap rounded-full bg-black px-2 py-[3px] text-[11px] font-semibold leading-none text-white dark:bg-white dark:text-black"
            style={{ left: `clamp(52px, ${hovered.x}%, calc(100% - 52px))`, top: `${hovered.y}%` }}
          >
            {DAY_FORMAT.format(hovered.time)} · {formatAverage(hovered.average)}
          </span>
        </>
      ) : null}
    </div>
  )
}

export default AverageSparkline
