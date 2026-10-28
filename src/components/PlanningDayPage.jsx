import { GRID_HEIGHT, HOURS, LABEL_COLUMN, dayColumn, layoutDayBlocks, yForHour, yForTime } from '../planningGrid'
import { fullDayText, startOfWeek, weekRangeText } from '../planningDates'
import { eventsOnDay } from '../planningEvents'
import { failedWeeks, pageStatus } from '../planningStates'
import PlanningEventBlock from './PlanningEventBlock'
import PlanningNote from './PlanningNote'

// A column's note sits at 10:30, where the day's first classes would be;
// a page's, larger, from 08:30.
const NOTE_HOUR = 10.5
const PAGE_NOTE_HOUR = 8.5
const NOW_MARK_WIDTH = LABEL_COLUMN - 4

// The hours: their labels and hairlines (no half hours), and in a view of
// several days a hairline between the days. Faded out on a page without
// any class, where only the notes stay.
function HourGrid({ dayCount, width, bare }) {
  return (
    <div className={`planning-grid ${bare ? 'is-bare' : ''}`} aria-hidden="true">
      {HOURS.map((hour) => (
        <div key={hour} className="planning-hour" style={{ top: yForHour(hour) - 5 }}>
          <span className="planning-hour-label">{`${String(hour).padStart(2, '0')}:00`}</span>
          <span className="planning-hour-line" />
        </div>
      ))}
      {Array.from({ length: dayCount - 1 }, (_, index) => (
        <span key={index} className="planning-day-divider" style={{ left: dayColumn(width, index + 1, dayCount).x - 0.75, top: yForHour(HOURS[0]), height: yForHour(HOURS.at(-1)) - yForHour(HOURS[0]) }} />
      ))}
    </div>
  )
}

// A column's note (PlanningNote), beside days with classes: compact, in a
// week's narrow column the icon over the text.
function DayNote({ kind, column, stacked, onRetry, onOpenAccount }) {
  const inset = stacked ? 4 : 8
  return (
    <PlanningNote
      kind={kind}
      compact
      stacked={stacked}
      onRetry={onRetry}
      onOpenAccount={onOpenAccount}
      style={{ position: 'absolute', left: column.x + inset, width: column.width - 2 * inset, top: yForHour(NOTE_HOUR) - 18 }}
    />
  )
}

// Now, on today's column: a "Maint." capsule over the hours and a line. In
// the week, the line is drawn across today's column alone, faint over the
// days before it.
function NowLine({ now, todayKey, column, week }) {
  const y = yForTime(now, todayKey)
  if (y < yForHour(HOURS[0]) || y > yForHour(HOURS.at(-1))) return null
  return (
    <div className="planning-now" style={{ top: y - 11, width: column.x + column.width - 1 }} aria-hidden="true">
      <span className="planning-now-mark" style={{ width: NOW_MARK_WIDTH }}>Maint.</span>
      {week ? (
        <>
          <span className="planning-now-line is-faint" style={{ left: NOW_MARK_WIDTH, width: column.x - NOW_MARK_WIDTH }} />
          <span className="planning-now-line" style={{ left: column.x }} />
        </>
      ) : <span className="planning-now-line" style={{ left: NOW_MARK_WIDTH }} />}
    </div>
  )
}

// One page of the planning: its `days` side by side (one, two, or a week's
// five or seven). `onRetry(monday)`: a failed week asked again;
// `onOpenAccount`: Mon compte, where the group is chosen. `menuProps`: a
// block's right-click menu (PlanningPage's useContextMenu).
function PlanningDayPage({ days, width, events, statusOn, accentFor, now, todayKey, weekBlocks = false, onOpen, menuProps = null, onRetry = null, onOpenAccount = null }) {
  const dayCount = days.length
  const week = dayCount > 2
  const perDay = days.map((day) => eventsOnDay(events, day))
  const bare = perDay.every((list) => list.length === 0)
  const todayIndex = days.indexOf(todayKey)
  // No class on the whole page: one note, in full, in its middle (its
  // "Réessayer" asks every failed week of the page again).
  const pageKind = bare ? pageStatus(days.map(statusOn)) : null
  const retryPage = onRetry ? () => failedWeeks(days, statusOn).forEach((monday) => onRetry(monday)) : null

  return (
    <div className="planning-page-day" style={{ height: GRID_HEIGHT }} role="region" aria-label={week ? `Semaine du ${weekRangeText(days[0])}` : days.map(fullDayText).join(' et ')}>
      {width > 0 ? (
        <>
          <HourGrid dayCount={dayCount} width={width} bare={bare} />
          {days.flatMap((day, index) => layoutDayBlocks(perDay[index], { dayKey: day, dayIndex: index, dayCount, width, weekBlocks })).map((block) => (
            <PlanningEventBlock
              key={block.event.id}
              event={block.event}
              accent={accentFor(block.event.title)}
              variant={block.variant}
              stackFirst={block.stackFirst}
              width={block.width}
              height={block.height}
              style={{ position: 'absolute', left: block.x, top: block.y }}
              onOpen={onOpen}
              menuProps={menuProps}
            />
          ))}
          {pageKind ? (
            <PlanningNote
              kind={pageKind}
              text={pageKind === 'loaded' && week ? 'Aucun cours cette semaine' : null}
              onRetry={retryPage}
              onOpenAccount={onOpenAccount}
              style={{ position: 'absolute', left: 16, width: width - 32, top: yForHour(PAGE_NOTE_HOUR) }}
            />
          ) : days.map((day, index) => (perDay[index].length === 0
            ? (
              <DayNote
                key={day}
                kind={statusOn(day)}
                column={dayColumn(width, index, dayCount)}
                stacked={week}
                onRetry={onRetry ? () => onRetry(startOfWeek(day)) : null}
                onOpenAccount={onOpenAccount}
              />
            )
            : null))}
          {todayIndex >= 0 ? <NowLine now={now} todayKey={todayKey} column={dayColumn(width, todayIndex, dayCount)} week={week} /> : null}
        </>
      ) : null}
    </div>
  )
}

export default PlanningDayPage
