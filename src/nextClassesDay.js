// « Prochains cours » (WidgetNextClasses): the classes of the next day that
// has some. Today while one of its classes isn't over (the ones left), else
// the first later day with classes. Pure (`now` passed in), unit tested in
// tests/nextClassesDay.test.js.

import { addDays, toDayKey } from './planningDates.js'

const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

function parseDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function capitalize(text) {
  return text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text
}

// "8h", "16h30": the dashboard's notation.
export function formatHour(date) {
  const minutes = date.getMinutes()
  return `${date.getHours()}h${minutes ? String(minutes).padStart(2, '0') : ''}`
}

// « Aujourd’hui », « Demain », then « Lundi 2 novembre ».
export function formatClassesDayLabel(dayKey, now) {
  const today = toDayKey(now)
  if (dayKey === today) return 'Aujourd’hui'
  if (dayKey === addDays(today, 1)) return 'Demain'
  const [year, month, day] = dayKey.split('-').map(Number)
  return capitalize(dayMonthFormatter.format(new Date(year, month - 1, day)))
}

// ADE events as { key, start, end, title, location, teacher, dayKey },
// sorted, without duplicates (the same slot comes back once per group).
function normalizeClasses(events) {
  const seen = new Set()
  const classes = []
  for (const event of Array.isArray(events) ? events : []) {
    const start = parseDate(event?.start)
    if (!start) continue
    const endDate = parseDate(event?.end)
    const end = endDate && endDate > start ? endDate : start
    const title = String(event?.title ?? '').trim() || 'Cours'
    const key = `${start.getTime()}|${end.getTime()}|${title}`
    if (seen.has(key)) continue
    seen.add(key)
    classes.push({
      key,
      start,
      end,
      title,
      location: String(event?.location ?? '').trim() || null,
      teacher: String(event?.teacher ?? '').trim() || null,
      dayKey: toDayKey(start),
    })
  }
  return classes.sort((left, right) => left.start - right.start)
}

// { dayKey, label, isToday, classes } (each class with `isNow`), or null
// without any class to come.
export function pickNextClassesDay(events, now = new Date()) {
  const upcoming = normalizeClasses(events).filter((item) => item.end > now)
  if (upcoming.length === 0) return null

  const { dayKey } = upcoming[0]
  return {
    dayKey,
    label: formatClassesDayLabel(dayKey, now),
    isToday: dayKey === toDayKey(now),
    classes: upcoming
      .filter((item) => item.dayKey === dayKey)
      .map((item) => ({ ...item, isNow: item.start <= now })),
  }
}
