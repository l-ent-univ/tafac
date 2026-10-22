// « Menu du RU »'s live card: the restaurant's lunch service now (open,
// opening at, closed), and the student's lunch break that day, read from
// the timetable, set against it. Pure: `now` passed in, no config import
// (tests/crousPause.test.js).

// "11h30-13h45" → { open: 690, close: 825 } (minutes after midnight).
export function parseServiceWindow(time) {
  const match = /(\d{1,2})h(\d{0,2})\s*[-–]\s*(\d{1,2})h(\d{0,2})/.exec(String(time ?? ''))
  if (!match) return null
  const open = Number(match[1]) * 60 + Number(match[2] || 0)
  const close = Number(match[3]) * 60 + Number(match[4] || 0)
  return close > open ? { open, close } : null
}

const minutesOf = (date) => date.getHours() * 60 + date.getMinutes()

// 'open' (closes at `close`), 'soon' (opens at `open`), 'over' (service
// done for the day) or 'closed' (no service that day), from a service
// window and whether that day has a menu.
export function serviceStatus(window, now, servesToday) {
  if (!window || !servesToday) return { state: 'closed' }
  const minute = minutesOf(now)
  if (minute < window.open) return { state: 'soon', minutesLeft: window.open - minute }
  if (minute < window.close) return { state: 'open', minutesLeft: window.close - minute, progress: (minute - window.open) / (window.close - window.open) }
  return { state: 'over' }
}

// Lunch is looked for between these hours when the RU's are unknown.
const LUNCH_FROM = 11 * 60 + 30
const LUNCH_TO = 14 * 60

// The free time around lunch on `dayKey` ('YYYY-MM-DD'): the gap between
// classes that overlaps the service window most, or the time before the
// first class / after the last one when the classes are all on one side.
// → { start, end } in minutes, or null (no class that day, or no gap).
export function findLunchBreak(events, dayKey, window = null) {
  const from = window?.open ?? LUNCH_FROM
  const to = window?.close ?? LUNCH_TO
  const classes = (events ?? [])
    .map((event) => ({ start: new Date(event.start), end: new Date(event.end) }))
    .filter(({ start, end }) => Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
      && `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}` === dayKey)
    .map(({ start, end }) => ({ start: minutesOf(start), end: minutesOf(end) }))
    .sort((left, right) => left.start - right.start)
  if (!classes.length) return null

  // Free intervals of the day, from the window's start to its end.
  const gaps = []
  let cursor = from
  for (const entry of classes) {
    if (entry.start > cursor) gaps.push({ start: cursor, end: entry.start })
    cursor = Math.max(cursor, entry.end)
  }
  if (cursor < to) gaps.push({ start: cursor, end: to })

  let best = null
  for (const gap of gaps) {
    const overlap = Math.min(gap.end, to) - Math.max(gap.start, from)
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { start: Math.max(gap.start, from), end: Math.min(gap.end, to), overlap }
  }
  return best && best.overlap >= 15 ? { start: best.start, end: best.end } : null
}

// 690 → "11h30"
export function formatMinutes(minutes) {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

// 75 → "1h15", 40 → "40 min"
export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`
}
