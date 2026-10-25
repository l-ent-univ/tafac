import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { trackPlanningAction, trackPlanningNavigation } from '../analytics'
import { WEEKDAY_LETTERS, addDays, dayText, daysBetween, monthLabel, parseDayKey, sameWeekday, shortWeekRangeText, shortWeekdayText, startOfWeek, toDayKey, weekRangeText, weekdayIndex } from '../planningDates'
import { LABEL_COLUMN } from '../planningGrid'
import { SECONDARY_BUTTON } from '../scodocPageUtils'
import Dropdown from './Dropdown'
import PlanningExportButton from './PlanningExportButton'
import SwipePager from './SwipePager'

const compareDays = (left, right) => daysBetween(right, left)
const stepWeeks = (monday, count) => addDays(monday, 7 * count)
const PILL = 35
// The strip's padding on both sides (.planning-pills): the capsule's
// percentages are of the padded width.
const PILLS_PADDING = 10

// The days of a month as the picker lays them, Monday first: blanks, then
// 1 to the last day.
function monthCells(firstOfMonth) {
  const first = parseDayKey(firstOfMonth)
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return [
    ...Array.from({ length: weekdayIndex(firstOfMonth) }, () => null),
    ...Array.from({ length }, (_, index) => addDays(firstOfMonth, index)),
  ]
}

function firstOfMonth(key, offset = 0) {
  const date = parseDayKey(key)
  return toDayKey(new Date(date.getFullYear(), date.getMonth() + offset, 1))
}

const MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })

// The month chip's calendar, in the app's menu panel (Dropdown): a month at
// a time, the selected day filled in the brand colour, today marked with a
// dot. A picked day takes the planning there.
function PlanningMonthPicker({ selectedDay, todayKey, onPick, onClose }) {
  const [month, setMonth] = useState(() => firstOfMonth(selectedDay))
  const panelRef = useRef(null)

  useEffect(() => {
    panelRef.current?.querySelector('[aria-pressed="true"], [data-today]')?.focus({ preventScroll: true })
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    const handlePointer = (event) => {
      if (!panelRef.current?.contains(event.target) && !event.target.closest?.('[data-month-capsule]')) onClose()
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('pointerdown', handlePointer)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('pointerdown', handlePointer)
    }
  }, [onClose])

  const title = MONTH_YEAR.format(parseDayKey(month))
  return (
    <div
      ref={panelRef}
      className="favorites-context-menu absolute top-[calc(100%+8px)] left-0 z-30 w-[min(320px,calc(100vw-24px))] p-[10px] border border-border corners-[18px] bg-context-bg shadow-[0_18px_40px_var(--color-shadow)] backdrop-blur-[12px] animate-context-menu-in"
      role="dialog"
      aria-label="Choisir un jour"
    >
      <div className="flex items-center gap-1 pb-2">
        <span className="flex-1 pl-2 font-body text-[15px] font-semibold capitalize text-brand">{title}</span>
        <button type="button" className="planning-picker-arrow" onClick={() => setMonth(firstOfMonth(month, -1))} aria-label="Mois précédent">
          <Icon icon="carbon:chevron-left" className="size-4" aria-hidden="true" />
        </button>
        <button type="button" className="planning-picker-arrow" onClick={() => setMonth(firstOfMonth(month, 1))} aria-label="Mois suivant">
          <Icon icon="carbon:chevron-right" className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-[2px] text-center">
        {WEEKDAY_LETTERS.map((letter, index) => (
          <span key={index} className="pb-1 font-body text-[12px] font-medium text-text-muted" aria-hidden="true">{letter}</span>
        ))}
        {monthCells(month).map((day, index) => (day ? (
          <button
            key={day}
            type="button"
            className={`planning-picker-day ${day === selectedDay ? 'is-selected' : ''} ${day === todayKey ? 'is-today' : ''}`}
            aria-pressed={day === selectedDay}
            data-today={day === todayKey || undefined}
            aria-label={parseDayKey(day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            onClick={() => onPick(day)}
          >
            {parseDayKey(day).getDate()}
          </button>
        ) : <span key={`blank-${index}`} />))}
      </div>
    </div>
  )
}

// A week of day pills, the selected days under one capsule of the brand
// colour (two in the two-day view, Sunday alone at the end).
function WeekPills({ monday, selectedDay, todayKey, dayCount, onSelect }) {
  const selectedIndex = daysBetween(monday, selectedDay)
  const inWeek = selectedIndex >= 0 && selectedIndex < 7
  const span = inWeek ? Math.min(dayCount, 7 - selectedIndex) : 0
  return (
    <div className="planning-pills">
      {inWeek ? (
        // A change of day fades a new capsule in; a change of view grows it.
        <span
          key={selectedDay}
          className="planning-selection"
          style={{
            left: `calc(${selectedIndex} * (100% - ${PILL + PILLS_PADDING}px) / 6)`,
            width: `calc(${PILL}px + ${span - 1} * (100% - ${PILL + PILLS_PADDING}px) / 6)`,
          }}
          aria-hidden="true"
        />
      ) : null}
      {Array.from({ length: 7 }, (_, index) => {
        const day = addDays(monday, index)
        const selected = inWeek && index >= selectedIndex && index < selectedIndex + span
        return (
          <button
            key={day}
            type="button"
            className={`planning-pill ${selected ? 'is-selected' : ''} ${day === todayKey ? 'is-today' : ''}`}
            aria-pressed={selected}
            aria-label={parseDayKey(day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            onClick={() => onSelect(day)}
          >
            {parseDayKey(day).getDate()}
          </button>
        )
      })}
    </div>
  )
}

// A week's days over their columns (the hour labels' one left empty): the
// weekday, and the date in a pill as the strip's, today dotted and the day
// shown alone filled in the brand colour (`shownDay`, none in the week).
// A day opens alone.
function WeekHeads({ days, shownDay, todayKey, onOpenDay }) {
  return (
    <div className="planning-week-heads" style={{ gridTemplateColumns: `${LABEL_COLUMN}px repeat(${days.length}, minmax(0, 1fr))` }}>
      {days.map((day, index) => (
        <button
          key={day}
          type="button"
          className="planning-week-head"
          style={{ gridColumn: index + 2 }}
          aria-current={day === shownDay || undefined}
          aria-label={`${dayText(day)}${day === todayKey ? ', aujourd’hui' : ''}, afficher ce jour`}
          onClick={() => onOpenDay(day)}
        >
          <span className="planning-week-weekday">{shortWeekdayText(day)}</span>
          <span className={`planning-pill ${day === shownDay ? 'is-filled' : ''} ${day === todayKey ? 'is-today' : ''}`}>
            {parseDayKey(day).getDate()}
          </span>
        </button>
      ))}
    </div>
  )
}

const WIDE_VIEWS = [
  { id: 'day', label: 'Jour', ariaLabel: 'Afficher un jour' },
  { id: 'week', label: 'Semaine', ariaLabel: 'Afficher la semaine' },
  { id: 'list', label: 'Liste', ariaLabel: 'Afficher la liste' },
]

// The wide screen's views, side by side in a pill as the account's theme
// switch: the one shown on a card.
function WideViewSwitch({ view, onChangeView }) {
  return (
    <div className="flex gap-0.5 rounded-full border border-border bg-brand-subtle p-[3px]" role="group" aria-label="Affichage">
      {WIDE_VIEWS.map((choice) => {
        const isActive = choice.id === view
        return (
          <button
            key={choice.id}
            type="button"
            aria-pressed={isActive}
            aria-label={choice.ariaLabel}
            onClick={isActive ? undefined : () => onChangeView(choice.id)}
            className={`inline-flex h-[34px] items-center rounded-full border px-3.5 font-body text-[14px] font-semibold cursor-pointer transition-[background-color,color,box-shadow,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              isActive ? 'border-border bg-widget-bg text-text shadow-xs' : 'border-transparent bg-transparent text-text-secondary hover:text-text'
            }`}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}

const PHONE_VIEWS = [
  { value: 'day', label: 'Jour', icon: 'ph:square' },
  { value: 'twoDays', label: '2 jours', icon: 'ph:square-split-horizontal' },
  { value: 'list', label: 'Liste', icon: 'ph:list-bullets' },
]

// The phone's views in the app's menu (Dropdown), from a round button by
// "Aujourd’hui" showing the view in place (like the PDF button on a phone,
// its touch area 44px), read out as "Affichage : Jour".
function PhoneViewMenu({ view, onChangeView }) {
  const shown = PHONE_VIEWS.find((choice) => choice.value === view) ?? PHONE_VIEWS[0]
  return (
    <Dropdown
      options={PHONE_VIEWS}
      value={shown.value}
      onChange={onChangeView}
      label="Affichage"
      align="end"
      className="shrink-0"
      triggerLabel={<Icon icon={shown.icon} className="block size-[18px]" aria-hidden="true" />}
      chevronClassName="size-3"
      triggerClassName={`${SECONDARY_BUTTON} relative h-[42px] cursor-pointer justify-center gap-1! px-3! py-0! max-md:h-10 max-md:shadow-xs max-md:after:absolute max-md:after:-inset-[3px]`}
    />
  )
}

// The planning's header, laid out as Mes notes' title row (its title read
// out only, the controls centred on the day's label): the month chip (its calendar on a tap, like the semester chip opens its
// menu), then "Aujourd’hui" (away from today) and the view menu (it shows
// the view in place: "Jour", "2 jours", "Liste") at the row's end; under it the weekday letters and the week
// strip, swiped by weeks (the same weekday in the new week). On a phone
// the row starts with the chip, which says the whole day (the week, short,
// in the list). On a wide screen arrows step a week (or a day) back and
// ahead by the chip, which says the week (or the day) shown, the view
// switch is "Jour" / "Semaine" / "Liste", and every view has the week's
// days' headers in place of the strip (the same ones, so switching moves
// nothing up there), swiped by weeks too.
function PlanningHeader({ titleId, selectedDay, todayKey, view, isWide, columnsFor, selection, onSelectDay, onOpenDay, onToday, onStep, onChangeView }) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const monday = startOfWeek(selectedDay)
  const dayCount = view === 'twoDays' ? 2 : 1
  const isWeek = view === 'week'
  const isList = view === 'list'
  // The list shows a week, as the week does: the chip and the arrows say
  // weeks. On a wide screen no day is picked in it (the heads scroll to
  // theirs), so "Aujourd’hui" goes from today's week, as in the week; on a
  // phone the strip keeps its picked day.
  const byWeek = isWeek || isList
  const wholeWeek = isWeek || (isList && isWide)
  const chipText = byWeek ? weekRangeText(monday) : dayText(selectedDay)
  // The strip's steps, for the analytics (trackPlanningNavigation): a
  // week swiped, a day's pill tapped.
  const swipeStrip = (day) => {
    trackPlanningNavigation('week_changed', 'strip')
    onSelectDay(day)
  }
  const pickPill = (day) => {
    if (day !== selectedDay) trackPlanningNavigation('day_changed', 'pill')
    onSelectDay(day)
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 max-md:gap-3">
      {/* On a phone, one row: the day chip ("Mardi 13 octobre"), then
          "Aujourd’hui" and the view button at its end, so nothing wraps. */}
      <div className="flex items-center gap-x-3 max-md:gap-x-2">
        {/* Read out only: the row starts with the controls and the day. */}
        <h1 id={titleId} className="sr-only">Planning</h1>
        {/* Wide: a page back and ahead, by the chip (a phone swipes). */}
        {isWide ? (
          <span className="flex items-center gap-1 self-center">
            {[
              { count: -1, icon: 'carbon:chevron-left', label: byWeek ? 'Semaine précédente' : 'Jour précédent' },
              { count: 1, icon: 'carbon:chevron-right', label: byWeek ? 'Semaine suivante' : 'Jour suivant' },
            ].map(({ count, icon, label }) => (
              <button
                key={count}
                type="button"
                className={`${SECONDARY_BUTTON} size-9 cursor-pointer justify-center p-0!`}
                onClick={() => onStep(count)}
                aria-label={label}
                title={label}
              >
                <Icon icon={icon} className="size-4" aria-hidden="true" />
              </button>
            ))}
          </span>
        ) : null}
        {/* Its text is set on the wrapper: a button takes its font from its
            parent here (index.css), not its classes. Its calendar hangs from
            it. */}
        <span className="relative inline-flex min-w-0 font-body text-[15px] font-semibold leading-none max-md:mr-auto">
          <button
            type="button"
            data-month-capsule
            className="inline-flex min-w-0 max-w-full items-center gap-1 border-0 bg-transparent p-0 text-text-secondary cursor-pointer transition-colors duration-150 hover:text-text focus-visible:text-text focus-visible:outline-none focus-visible:underline underline-offset-4 max-md:relative max-md:min-h-10 max-md:min-w-11 max-md:rounded-full max-md:border max-md:border-border max-md:bg-widget-bg max-md:pr-2.5 max-md:pl-3.5 max-md:text-text max-md:shadow-xs max-md:no-underline max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-[3px] max-md:focus-visible:outline-2 max-md:focus-visible:outline-offset-2 max-md:focus-visible:outline-brand"
            aria-haspopup="dialog"
            aria-expanded={isPickerOpen}
            aria-label={`${chipText}, choisir un jour`}
            onClick={() => setIsPickerOpen((open) => !open)}
          >
            {isWide ? <span className="truncate">{chipText}</span> : (
              <>
                <span className="truncate max-md:hidden">{isList ? chipText : monthLabel(selectedDay)}</span>
                <span className="truncate md:hidden">{isList ? shortWeekRangeText(monday) : dayText(selectedDay)}</span>
              </>
            )}
            <Icon icon="carbon:chevron-down" className={`size-3.5 shrink-0 transition-transform duration-150 ${isPickerOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {isPickerOpen ? (
            <PlanningMonthPicker
              selectedDay={selectedDay}
              todayKey={todayKey}
              onPick={(day) => {
                trackPlanningAction('calendar_picked')
                setIsPickerOpen(false)
                onSelectDay(day)
              }}
              onClose={() => setIsPickerOpen(false)}
            />
          ) : null}
        </span>
        <div className="ml-auto flex items-center gap-2 self-center max-md:ml-0 max-md:shrink-0">
          {/* Only away from today (in the week, from today's week). */}
          {(wholeWeek ? monday !== startOfWeek(todayKey) : selectedDay !== todayKey) ? (
            <button type="button" className={`${SECONDARY_BUTTON} cursor-pointer max-md:h-10 max-md:py-0 max-md:shadow-xs`} onClick={onToday}>
              Aujourd’hui
            </button>
          ) : null}
          {/* Wide: "Jour" / "Semaine" / "Liste". Otherwise a menu of the
              phone's views. */}
          {isWide ? <WideViewSwitch view={view} onChangeView={onChangeView} /> : <PhoneViewMenu view={view} onChangeView={onChangeView} />}
          {/* At the row's end, apart from the views: the .ics export. On a
              phone it gives its room to "Aujourd’hui" (the row would cut
              the day short): it exports the weeks ahead, offered from
              today. */}
          <PlanningExportButton
            selection={selection}
            from="header"
            className={(isWeek ? monday !== startOfWeek(todayKey) : selectedDay !== todayKey) ? 'max-md:hidden' : ''}
          />
        </div>
      </div>
      {isWide ? (
        <SwipePager
          className="planning-strip"
          value={monday}
          step={stepWeeks}
          compare={compareDays}
          label="Semaine"
          onSwipe={(nextMonday) => swipeStrip(byWeek ? nextMonday : sameWeekday(selectedDay, nextMonday))}
          renderPage={(weekMonday) => (
            <WeekHeads days={columnsFor(weekMonday)} shownDay={byWeek ? null : selectedDay} todayKey={todayKey} onOpenDay={onOpenDay} />
          )}
        />
      ) : <div>
        <div className="planning-letters" aria-hidden="true">
          {WEEKDAY_LETTERS.map((letter, index) => <span key={index}>{letter}</span>)}
        </div>
        <SwipePager
          className="planning-strip"
          value={monday}
          step={stepWeeks}
          compare={compareDays}
          label="Semaine"
          onSwipe={(nextMonday) => swipeStrip(sameWeekday(selectedDay, nextMonday))}
          renderPage={(weekMonday) => (
            <WeekPills monday={weekMonday} selectedDay={selectedDay} todayKey={todayKey} dayCount={dayCount} onSelect={pickPill} />
          )}
        />
      </div>}
    </div>
  )
}

export default PlanningHeader
