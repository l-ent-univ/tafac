// The « Accueil » exploration page (HomeDraftPage): a canvas for a new home
// screen. What it shows is built here from what the dashboard already loads
// (upcoming classes, Moodle deadlines, unread mails, graded evaluations).
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
// Deadlines due within this window count as urgent in « À traiter ».
const URGENT_DEADLINE_MS = 48 * HOUR_MS
// Deadlines further than this are left to the week strip.
const FEED_DEADLINE_WINDOW_MS = 7 * DAY_MS
// Without a « Mes notes » visit on this device, the latest grade still
// shows if it's recent.
const RECENT_GRADE_MS = 14 * DAY_MS
const MAX_FEED_MAILS = 3
const MAX_FEED_GRADES = 2
export const MAX_FEED_ITEMS = 6
export const WEEK_STRIP_DAYS = 7

const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' })
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const shortWeekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })

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

// Seven days from today: classes and deadlines per day, for the week strip.
// `deadlines`: Moodle items ({ dueAt, submitted }), submitted ones left out.
export function buildWeekStrip(events, deadlines, now = new Date(), days = WEEK_STRIP_DAYS) {
  const classes = normalizeClasses(events)
  const todayKey = toDayKey(now)
  const dueDays = (Array.isArray(deadlines) ? deadlines : [])
    .filter((item) => item?.submitted !== true)
    .map((item) => parseDate(item?.dueAt))
    .filter(Boolean)
    .map((date) => toDayKey(date))

  return Array.from({ length: days }, (_, offset) => {
    const dayKey = addDays(todayKey, offset)
    const [year, month, day] = dayKey.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    const dayClasses = classes.filter((item) => item.dayKey === dayKey)
    return {
      dayKey,
      isToday: offset === 0,
      weekday: capitalize(shortWeekdayFormatter.format(date).replace('.', '')),
      dayNumber: day,
      classCount: dayClasses.length,
      firstStart: dayClasses[0] ? formatHour(dayClasses[0].start) : null,
      lastEnd: dayClasses.length ? formatHour(dayClasses.reduce((latest, item) => (item.end > latest ? item.end : latest), dayClasses[0].end)) : null,
      deadlineCount: dueDays.filter((key) => key === dayKey).length,
    }
  })
}

// When a deadline is due, as « À traiter » says it: « dans 3 h », « ce soir
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

// « À traiter »: one list for what asks for the student's attention, from
// every source the page has. Urgent deadlines first, then new grades, unread
// mails and the rest of the week's deadlines.
//   deadlines: Moodle items ({ id, title, courseName, dueAt, submitted, overdue, href })
//   mails: mail messages ({ id, subject, from, receivedAt, unread, href })
//   grades: graded evaluations, newest first (listGradedEvaluations)
//   seenGradeIds: the ids « Mes notes » last showed, null if never opened here
// Each source may be null (not available, not loaded). Returns items
// { id, kind: 'deadline' | 'grade' | 'mail', title, detail, meta, urgent, source }
// (plus `dueAt` for a deadline, `receivedAt` for a mail).
export function buildHomeFeed({ deadlines = null, mails = null, grades = null, seenGradeIds = null, now = new Date() } = {}) {
  const urgent = []
  const later = []

  for (const item of Array.isArray(deadlines) ? deadlines : []) {
    const due = parseDate(item?.dueAt)
    if (!due || item.submitted === true) continue
    const overdue = item.overdue === true || due <= now
    if (!overdue && due - now > FEED_DEADLINE_WINDOW_MS) continue
    const entry = {
      id: `deadline:${item.id ?? item.title ?? due.getTime()}`,
      kind: 'deadline',
      title: String(item.title ?? '').trim() || 'Devoir',
      detail: String(item.courseName ?? '').trim() || null,
      meta: formatDueLabel(due, now),
      urgent: overdue || due - now <= URGENT_DEADLINE_MS,
      dueAt: due,
      source: item,
    }
    ;(entry.urgent ? urgent : later).push(entry)
  }
  urgent.sort((left, right) => left.dueAt - right.dueAt)
  later.sort((left, right) => left.dueAt - right.dueAt)

  const gradeList = Array.isArray(grades) ? grades : []
  const seen = Array.isArray(seenGradeIds) ? new Set(seenGradeIds.map(String)) : null
  const newGrades = gradeList
    .filter((grade) => {
      if (seen) return grade?.id != null && !seen.has(String(grade.id))
      const date = parseDate(grade?.date)
      return Boolean(date) && now - date <= RECENT_GRADE_MS
    })
    .slice(0, seen ? MAX_FEED_GRADES : 1)
    .map((grade) => ({
      id: `grade:${grade.id ?? grade.description}`,
      kind: 'grade',
      title: String(grade.description ?? '').trim() || 'Nouvelle note',
      detail: grade.resource ?? null,
      meta: `${String(parseFloat(grade.note))}/${grade.noteSur ?? 20}`,
      urgent: false,
      source: grade,
    }))

  const unreadMails = (Array.isArray(mails) ? mails : [])
    .filter((message) => message?.unread)
    .slice(0, MAX_FEED_MAILS)
    .map((message) => ({
      id: `mail:${message.id ?? message.subject}`,
      kind: 'mail',
      title: String(message.subject ?? '').trim() || '(Sans objet)',
      detail: message.from?.name?.trim() || message.from?.email?.trim() || null,
      meta: null,
      receivedAt: parseDate(message.receivedAt),
      urgent: false,
      source: message,
    }))

  return [...urgent, ...newGrades, ...unreadMails, ...later].slice(0, MAX_FEED_ITEMS)
}
