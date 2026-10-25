import { Icon } from '@iconify/react'
import LaunchCard from './LaunchCard'
import { accentStyle } from '../eventAccents'

// The « Nouveautés » entry this card launches (src/changelog.js, a
// `spotlight` one): see LaunchCard for when it shows.
const ENTRY_ID = 'planning'

// The stage's drawing, in the units of the grades card's (132 × 66, its
// floor at the bottom): four days of a week, 26 wide, 4 apart.
const WIDTH = 132
const HEIGHT = 66
const DAY_X = (day) => 8 + day * 30
const DAY_WIDTH = 26
// Example classes, not the student's: the planning's accents in their
// handing-out order, no titles. The two middle days stop short of the
// floor, where the page's icon stands.
const EXAMPLE_CLASSES = [
  { day: 0, top: 4, bottom: 30, accent: 0 },
  { day: 1, top: 10, bottom: 30, accent: 1 },
  { day: 0, top: 36, bottom: 62, accent: 2 },
  { day: 2, top: 4, bottom: 20, accent: 3 },
  { day: 3, top: 8, bottom: 42, accent: 4 },
]
// The grid's hours, faint, and "now": as on the page, a line across today
// (the third day, between two classes), faint over the rest of the week.
const HOUR_LINES = [17, 34, 51]
const NOW_Y = 26
const TODAY = 2

const x = (value) => `${(value / WIDTH) * 100}%`
const y = (value) => `${(value / HEIGHT) * 100}%`

// The stage: the planning's grid, its classes dropping into place one after
// the other as the page's blocks (a card under the course's wash, its
// accent bar, a line for the title), the « Planning » icon popping up on
// the floor, then the "now" line drawing across today. All CSS
// (.planning-launch-* and .launch-card-* in overrides.css), the final
// frame as is with reduced motion.
function LaunchWeek() {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      {HOUR_LINES.map((line) => (
        <span key={line} className="planning-launch-hour absolute inset-x-0 h-px" style={{ top: y(line) }} />
      ))}
      {EXAMPLE_CLASSES.map((item, index) => (
        <span
          key={index}
          className="planning-launch-block absolute isolate overflow-hidden corners-[4px] border bg-widget-bg max-md:corners-[3px]"
          style={{
            left: x(DAY_X(item.day)),
            width: x(DAY_WIDTH),
            top: y(item.top),
            height: y(item.bottom - item.top),
            '--i': index,
            ...accentStyle(item.accent),
          }}
        >
          <span className="latest-grade-wash planning-accent-fill" />
          <span className="planning-accent-fill absolute left-[2px] top-[2px] bottom-[2px] w-[2px] rounded-full" />
          <span className="planning-launch-title absolute left-[6px] top-[4px] h-[2px] w-[50%] rounded-full max-md:left-[5px] max-md:top-[3px]" />
        </span>
      ))}
      <span className="planning-launch-now is-faint absolute h-px" style={{ left: x(4), right: x(4), top: y(NOW_Y) }} />
      <span className="planning-launch-now absolute h-px" style={{ left: x(DAY_X(TODAY)), width: x(DAY_WIDTH), top: y(NOW_Y) }}>
        <span className="planning-launch-now-dot absolute -left-[2px] top-1/2 h-[5px] w-[5px] -translate-y-1/2 rounded-full" />
      </span>
    </div>
  )
}

// Launch card for the Planning page (LaunchCard): a few days of a week, the
// page's icon standing on the floor. `onOpen`: shows the Planning.
function PlanningLaunchCard({ onOpen }) {
  return (
    <LaunchCard
      entryId={ENTRY_ID}
      launch="planning"
      title="Ton emploi du temps dans l’appli"
      line="Jour, semaine ou liste, la fiche de chaque cours et l’export vers ton agenda"
      ctaLabel="Voir mon planning"
      closeLabel="Fermer l’annonce du Planning"
      onOpen={onOpen}
      stage={(
        <>
          <LaunchWeek />
          {/* Where the grades card's hollow is (66, 47, 30 wide): the page's icon. */}
          <span className="launch-card-hub absolute left-1/2 top-[71.2%] flex aspect-square w-[22.7%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full" aria-hidden="true">
            <span className="launch-card-ripple absolute inset-0 rounded-full" />
            <Icon icon="carbon:calendar" className="h-[52%] w-[52%]" />
          </span>
        </>
      )}
    />
  )
}

export default PlanningLaunchCard
