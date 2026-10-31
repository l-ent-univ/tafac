// The « Accueil » exploration page (HomeDraftPage): a canvas for a new home
// screen, one column: the day's classes, « À rendre », « Notes », « Non
// lus ». Built here from what the dashboard already loads.
// Pure on purpose: `now` passed in, no storage, no fetch, so every case is
// unit tested (tests/homeDraft.test.js).

import { addDays, toDayKey } from './planningDates.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// A day whose classes are over switches the agenda to the next one from
// this hour on (as the greeting briefing does).
const EVENING_HOUR = 18
// How far ahead the agenda looks for the next day with classes.
const AGENDA_LOOKAHEAD_DAYS = 14
// Deadlines due within this window are said in red in « À rendre ».
const URGENT_DUE_MS = 48 * HOUR_MS
// « À rendre » looks this far ahead.
const DUE_WINDOW_MS = 7 * DAY_MS
export const MAX_DUE_ITEMS = 5
export const MAX_GRADE_ITEMS = 4
export const MAX_UNREAD_ITEMS = 4

const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' })
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

// « Aujourd’hui », « Demain », then « Lundi 3 novembre ».
export function formatAgendaDayLabel(dayKey, now) {
  const today = toDayKey(now)
  if (dayKey === today) return 'Aujourd’hui'
  if (dayKey === addDays(today, 1)) return 'Demain'
  const [year, month, day] = dayKey.split('-').map(Number)
  return capitalize(dayMonthFormatter.format(new Date(year, month - 1, day)))
}

// « Samedi 31 octobre »: the page's date line.
export function formatTodayLabel(now) {
  return capitalize(dayMonthFormatter.format(now))
}

// Classes as { start, end, title, location, teacher, dayKey }, sorted, without
// duplicates (the same slot can come back once per selected group).
export function normalizeClasses(events) {
  if (!Array.isArray(events)) return []
  const seen = new Set()
  const classes = []
  for (const event of events) {
    const start = parseDate(event?.start)
    if (!start) continue
    const endDate = parseDate(event?.end)
    const end = endDate && endDate > start ? endDate : start
    const key = `${start.getTime()}|${end.getTime()}|${event?.title ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    classes.push({
      key,
      start,
      end,
      title: String(event?.title ?? '').trim() || 'Cours',
      location: String(event?.location ?? '').trim() || null,
      teacher: String(event?.teacher ?? '').trim() || null,
      dayKey: toDayKey(start),
    })
  }
  return classes.sort((left, right) => left.start - right.start)
}

// The day the agenda shows: today while classes remain (or a free day before
// the evening), else the next day with classes within two weeks.
// Returns { dayKey, label, isToday, classes } with each class's `status`
// ('past', 'now', 'next', 'later'), or null without any class to show.
export function pickAgendaDay(events, now = new Date()) {
  const classes = normalizeClasses(events)
  const todayKey = toDayKey(now)
  const today = classes.filter((item) => item.dayKey === todayKey)
  const hasRemainingToday = today.some((item) => item.end > now)

  let dayKey = null
  if (hasRemainingToday) {
    dayKey = todayKey
  } else {
    const limit = addDays(todayKey, AGENDA_LOOKAHEAD_DAYS)
    const next = classes.find((item) => item.dayKey > todayKey && item.dayKey <= limit)
    dayKey = next?.dayKey ?? null
  }

  if (!dayKey) {
    return null
  }

  const dayClasses = classes.filter((item) => item.dayKey === dayKey)
  const nextIndex = dayClasses.findIndex((item) => item.start > now)
  return {
    dayKey,
    label: formatAgendaDayLabel(dayKey, now),
    isToday: dayKey === todayKey,
    // A free day before the evening still says so (the agenda shows the
    // next day, under « Pas de cours aujourd’hui »).
    freeToday: today.length === 0 && now.getHours() < EVENING_HOUR,
    classes: dayClasses.map((item, index) => ({
      ...item,
      status: item.end <= now
        ? 'past'
        : item.start <= now
          ? 'now'
          : index === nextIndex
            ? 'next'
            : 'later',
    })),
  }
}

// When a deadline is due, as « À rendre » says it: « dans 3 h », « ce soir
// à 23h59 », « demain à 12h », « jeudi », « en retard ».
export function formatDueLabel(dueAt, now = new Date()) {
  const due = parseDate(dueAt)
  if (!due) return ''
  if (due <= now) return 'En retard'
  const diffMs = due - now
  const dayDiff = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS)
  if (diffMs < HOUR_MS) return `Dans ${Math.max(1, Math.ceil(diffMs / (60 * 1000)))} min`
  if (diffMs < 3 * HOUR_MS) return `Dans ${Math.round(diffMs / HOUR_MS)} h`
  if (dayDiff === 0) return `Aujourd’hui à ${formatHour(due)}`
  if (dayDiff === 1) return `Demain à ${formatHour(due)}`
  if (dayDiff < 7) return `${capitalize(weekdayFormatter.format(due))} à ${formatHour(due)}`
  return capitalize(dayMonthFormatter.format(due))
}

// « À rendre »: Moodle items not yet submitted, overdue or due within a
// week, soonest first. Items { id, title, detail, meta, overdue, urgent, source }.
export function buildDueList(deadlines, now = new Date(), max = MAX_DUE_ITEMS) {
  return (Array.isArray(deadlines) ? deadlines : [])
    .map((item) => ({ item, due: parseDate(item?.dueAt) }))
    .filter(({ item, due }) => due && item.submitted !== true)
    .filter(({ item, due }) => item.overdue === true || due <= now || due - now <= DUE_WINDOW_MS)
    .sort((left, right) => left.due - right.due)
    .slice(0, max)
    .map(({ item, due }) => {
      const overdue = item.overdue === true || due <= now
      return {
        id: `deadline:${item.id ?? item.title ?? due.getTime()}`,
        title: String(item.title ?? '').trim() || 'Devoir',
        detail: String(item.courseName ?? '').trim() || null,
        meta: formatDueLabel(due, now),
        overdue,
        urgent: overdue || due - now <= URGENT_DUE_MS,
        source: item,
      }
    })
}

// « 14,5/20 »; a mark that isn't a number (ABS, EXC) as it comes.
export function formatMark(note, noteSur = 20) {
  const value = parseFloat(note)
  const mark = Number.isFinite(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : String(note ?? '').trim()
  return mark ? `${mark}/${noteSur ?? 20}` : ''
}

// « Notes »: the latest graded evaluations (listGradedEvaluations, newest
// first), each flagged `isNew` when « Mes notes » hasn't shown it on this
// device (`seenGradeIds`, null if never opened here: nothing flagged).
export function buildGradeList(grades, seenGradeIds = null, max = MAX_GRADE_ITEMS) {
  const seen = Array.isArray(seenGradeIds) ? new Set(seenGradeIds.map(String)) : null
  return (Array.isArray(grades) ? grades : [])
    .slice(0, max)
    .map((grade) => ({
      id: `grade:${grade.id ?? grade.description}`,
      title: String(grade.description ?? '').trim() || 'Évaluation',
      detail: grade.resource ? String(grade.resource).trim() : null,
      meta: formatMark(grade.note, grade.noteSur),
      isNew: Boolean(seen && grade.id != null && !seen.has(String(grade.id))),
      source: grade,
    }))
}

// « Non lus »: unread mails, newest first as the mailbox gives them.
export function buildUnreadList(mails, max = MAX_UNREAD_ITEMS) {
  return (Array.isArray(mails) ? mails : [])
    .filter((message) => message?.unread)
    .slice(0, max)
    .map((message) => ({
      id: `mail:${message.id ?? message.subject}`,
      title: String(message.subject ?? '').trim() || '(Sans objet)',
      detail: message.from?.name?.trim() || message.from?.email?.trim() || null,
      receivedAt: parseDate(message.receivedAt),
      source: message,
    }))
}
