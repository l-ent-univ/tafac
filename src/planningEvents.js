// The planning's classes as the page shows them (the iOS app's
// ScheduleEvent and PlanningEvents): built from /ade/upcoming's events
// (the portal's, or the demo account's, which have `id` and ISO times
// only), without duplicates, by day. Pure, see tests/planningEvents.test.js.
import { courseKey } from './eventAccents.js'
import { addDays, toDayKey } from './planningDates.js'

function text(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

function webLink(value) {
  const link = text(value)
  return link && /^https?:\/\//i.test(link) ? link : null
}

// "VOTRE PLANNING" reads as "Votre planning"; a lone acronym ("BU") stays.
function softenCapitals(label) {
  return label && label === label.toLocaleUpperCase('fr') && /\p{L}{2,}\s+\p{L}{2,}/u.test(label)
    ? label.charAt(0) + label.slice(1).toLocaleLowerCase('fr')
    : label
}

export function toPlanningEvent(raw) {
  const start = Number.isFinite(raw?.startMs) ? raw.startMs : Date.parse(raw?.start)
  const parsedEnd = Number.isFinite(raw?.endMs) ? raw.endMs : Date.parse(raw?.end)
  if (!Number.isFinite(start)) return null
  const end = Number.isFinite(parsedEnd) ? parsedEnd : start
  const title = text(raw.title) ?? 'Cours'
  const groups = Array.isArray(raw.groups) ? raw.groups.filter(Boolean) : []
  return {
    id: [raw.uid ?? raw.id ?? '', start, end, title].join('|'),
    // ADE's own id for the class, which stays when it's moved (the .ics
    // export's UID, planningIcs).
    uid: text(raw.uid ?? raw.id),
    title,
    start,
    end,
    day: toDayKey(start),
    location: text(raw.location),
    teacher: text(raw.teacher),
    group: text(raw.groupsLabel) ?? text(groups.join(', ')),
    // A note on the class and a link, when the planning gives them (TEMPO's
    // info line and url).
    notes: text(raw.notes),
    link: webLink(raw.link),
    linkLabel: webLink(raw.link) ? softenCapitals(text(raw.linkLabel)) : null,
  }
}

// Same start, end and course: one class (a week asked again, or the same
// class under two of the student's groups).
export function mergeEvents(...lists) {
  const byKey = new Map()
  for (const event of lists.flat()) {
    if (!event) continue
    const key = `${event.start}|${event.end}|${courseKey(event.title)}`
    if (!byKey.has(key)) byKey.set(key, event)
  }
  return [...byKey.values()].sort((left, right) => left.start - right.start || left.end - right.end)
}

export function eventsOnDay(events, dayKey) {
  return events.filter((event) => event.day === dayKey)
}

// The days of a 7-day week from its Monday.
export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

// The columns of a week's page: Monday to Friday, and the weekend when the
// student shows it (Mon compte, `showWeekend`), or when one of its days has
// a class (never hidden) or is the day shown alone (`shownDay`, a wide
// screen's day view, whose heads keep it). It never hangs on which page is
// in view, so a swipe lands on the week it showed.
export function weekColumns(events, monday, { showWeekend = false, shownDay = null } = {}) {
  const days = weekDays(monday)
  if (showWeekend) return days
  const hasWeekend = days.slice(5).some((day) => day === shownDay || events.some((event) => event.day === day))
  return hasWeekend ? days : days.slice(0, 5)
}

// The same course's next classes within `horizonDays` after this one.
export const OCCURRENCE_HORIZON_DAYS = 30
export function nextOccurrences(events, event, { horizonDays = OCCURRENCE_HORIZON_DAYS, limit = 3 } = {}) {
  const key = courseKey(event.title)
  const horizon = event.start + horizonDays * 24 * 60 * 60 * 1000
  return events
    .filter((other) => other.id !== event.id && courseKey(other.title) === key && other.start > event.start && other.start <= horizon)
    .slice(0, limit)
}

// The week of `monday` as the planning's list shows it, Monday first: its
// days with classes, each with its classes in order, and today and the
// selected day even without any (the list says so in a line, and the day
// picked in the strip has a heading to scroll to). A week without any
// class has no days: the list says so once.
export function listWeekDays(events, monday, { todayKey = null, selectedDay = null } = {}) {
  const days = weekDays(monday).map((day) => ({ day, events: eventsOnDay(events, day) }))
  if (days.every((entry) => entry.events.length === 0)) return []
  return days.filter((entry) => entry.events.length || entry.day === todayKey || entry.day === selectedDay)
}

// Whether a class is on at `now` (its start included, its end not).
export function isOngoing(event, now) {
  return event.start <= now && now < event.end
}
