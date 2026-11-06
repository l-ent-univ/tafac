// « Assiduité »: what the page reads from the absence report
// (buildAbsenceReport's entries) beyond the list itself. Pure, so the tests
// run it straight in Node.

const DAY_MS = 24 * 3600 * 1000

// "2026-10-06" → that day at 00:00, local time. Null when unreadable.
export function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

// When the absence started: its day at its start hour (8.25 → 8h15).
export function absenceStart(entry) {
  const day = parseDay(entry?.date)
  if (!day) return null
  day.setMinutes(Math.round((Number(entry.startHours) || 0) * 60))
  return day
}

// How long the department gives to justify an absence, in hours, as its
// notice on the passerelle says it (« … dans les 48 heures à compter du
// début de l’absence »). Null when the notice names no delay: the page then
// shows none rather than guessing one.
export function readJustificationWindow(notice) {
  const text = String(notice ?? '').replace(/\s+/g, ' ')
  if (!/justifi/i.test(text)) return null
  const hours = text.match(/(\d{1,3})\s*(?:h\b|heures?\b)/i)
  if (hours) return Number(hours[1]) || null
  const days = text.match(/(\d{1,2})\s*jours?\b/i)
  return days ? Number(days[1]) * 24 || null : null
}

// The unjustified absences still inside the department's window, soonest
// deadline first: { entry, deadline (Date), hoursLeft, share (0–1 of the
// window still left) }.
export function listOpenJustifications(entries, windowHours, now = new Date()) {
  if (!(windowHours > 0)) return []
  const nowMs = now.getTime()
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry.status === 'unjustified')
    .map((entry) => {
      const start = absenceStart(entry)
      if (!start) return null
      const deadline = new Date(start.getTime() + windowHours * 3600 * 1000)
      const hoursLeft = (deadline.getTime() - nowMs) / 3600 / 1000
      // Not yet begun (a clock off by a little): the whole window.
      const share = Math.min(1, hoursLeft / windowHours)
      return hoursLeft > 0 ? { entry, deadline, hoursLeft, share } : null
    })
    .filter(Boolean)
    .sort((left, right) => left.deadline - right.deadline)
}

// « Reste 31 h », « Reste 40 min ».
export function formatTimeLeft(hours) {
  if (!(hours > 0)) return null
  if (hours < 1) return `Reste ${Math.max(1, Math.round(hours * 60))} min`
  return `Reste ${Math.floor(hours)} h`
}

// Counts per status, for the filters: { all, unjustified, justified, late }.
export function countAbsencesByStatus(entries) {
  const counts = { all: 0, unjustified: 0, justified: 0, late: 0 }
  for (const entry of Array.isArray(entries) ? entries : []) {
    counts.all += 1
    if (Object.hasOwn(counts, entry.status)) counts[entry.status] += 1
  }
  return counts
}

// Hours missed, justified or not (lateness apart): { justified, unjustified, late }.
export function sumAbsenceHours(entries) {
  const sums = { justified: 0, unjustified: 0, late: 0 }
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry.status === 'late') sums.late += 1
    else if (entry.status === 'justified') sums.justified += entry.hours ?? 0
    else if (entry.status === 'unjustified') sums.unjustified += entry.hours ?? 0
  }
  return sums
}

const MONTH_FORMAT = new Intl.DateTimeFormat('fr-FR', { month: 'short' })
// Days of a month inside the semester for it to be named under the line.
const MIN_MONTH_DAYS = 12

// The semester as a line from its first day to its last (the relevé's
// date_debut / date_fin), positions in % along it:
// - `months`: where each month starts, with its short name (only the
//   months mostly inside it, see MIN_MONTH_DAYS);
// - `marks`: one per absence (its entry's id and status), those of one day
//   stacked (`stack`: 0, 1, 2… from the line up);
// - `today`: where today falls, null outside the semester;
// - `elapsed`: how much of the semester has gone (0–100).
// Without the semester's dates, the absences' own span (a week each side).
// Null without any date at all.
export function buildSemesterTimeline({ start = null, end = null, entries = [], now = new Date() } = {}) {
  const days = (Array.isArray(entries) ? entries : []).map((entry) => parseDay(entry.date)).filter(Boolean)
  let first = parseDay(start)
  let last = parseDay(end)
  if (!first || !last || last <= first) {
    if (!days.length) return null
    const times = days.map((day) => day.getTime())
    first = new Date(Math.min(...times) - 7 * DAY_MS)
    last = new Date(Math.max(...times) + 7 * DAY_MS)
  }
  // Absences outside the semester's dates widen the line rather than fall off it.
  for (const day of days) {
    if (day < first) first = day
    if (day > last) last = day
  }
  const span = last.getTime() + DAY_MS - first.getTime()
  const place = (date) => Math.min(100, Math.max(0, ((date.getTime() - first.getTime()) / span) * 100))

  // A month is named only with enough of it inside the semester: a
  // semester starting on 26 January would put « janv » and « févr » on top
  // of each other, one ending on 3 June « juin » past its end. At least
  // the month with most days, on a very short span.
  const candidates = []
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1)
  while (cursor <= last) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const from = cursor < first ? first : cursor
    const to = monthEnd.getTime() - DAY_MS < last.getTime() ? monthEnd.getTime() : last.getTime() + DAY_MS
    candidates.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: MONTH_FORMAT.format(cursor).replace('.', ''),
      position: place(from),
      days: Math.round((to - from.getTime()) / DAY_MS),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  let months = candidates.filter((month) => month.days >= MIN_MONTH_DAYS)
  if (!months.length && candidates.length) {
    months = [candidates.reduce((best, month) => (month.days > best.days ? month : best))]
  }
  months = months.map(({ key, label, position }) => ({ key, label, position }))

  const perDay = new Map()
  const marks = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const day = parseDay(entry.date)
      if (!day) return null
      // Midday of the day, so a mark sits inside its day's slice.
      const position = place(new Date(day.getTime() + DAY_MS / 2))
      return { id: entry.id, date: entry.date, status: entry.status, position, startHours: Number(entry.startHours) || 0 }
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date) || left.startHours - right.startHours)
    .map((mark) => {
      const stack = perDay.get(mark.date) ?? 0
      perDay.set(mark.date, stack + 1)
      return { id: mark.id, date: mark.date, status: mark.status, position: mark.position, stack }
    })

  const nowTime = now.getTime()
  const inside = nowTime >= first.getTime() && nowTime < last.getTime() + DAY_MS
  return {
    start: first,
    end: last,
    months,
    marks,
    today: inside ? place(now) : null,
    elapsed: nowTime >= last.getTime() + DAY_MS ? 100 : inside ? place(now) : 0,
  }
}

// The evaluations of the absence's subject held while it lasted (same day,
// overlapping hours when the evaluation has some), from buildGradesReport's
// report: { [entryId]: [{ id, description, grade }] }. What the absence did
// to a grade (« Absent », counted 0; « Excusé »), as the relevé says it.
export function findEvaluationsDuringAbsences(report, entries) {
  const modules = new Map([...(report?.resources ?? []), ...(report?.saes ?? [])].map((module) => [module.code, module]))
  const result = {}
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry.status === 'late' || !entry.moduleCode) continue
    const module = modules.get(entry.moduleCode)
    if (!module) continue
    const found = (module.evaluations ?? []).filter((evaluation) => {
      const date = String(evaluation.date ?? '')
      if (date.slice(0, 10) !== entry.date) return false
      const time = /T(\d{2}):(\d{2})/.exec(date)
      if (!time) return true
      const hour = Number(time[1]) + Number(time[2]) / 60
      return hour >= (Number(entry.startHours) || 0) - 0.01 && hour < (Number(entry.endHours) || 24)
    })
    if (found.length) {
      result[entry.id] = found.map((evaluation) => ({ id: evaluation.id, description: evaluation.description, grade: evaluation.grade }))
    }
  }
  return result
}

// Entries by month, newest first as they come: [{ key, label, entries }].
export function groupAbsencesByMonth(entries) {
  const groups = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const day = parseDay(entry.date)
    const key = day ? `${day.getFullYear()}-${day.getMonth()}` : 'unknown'
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      const label = day ? day.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : 'Date inconnue'
      group = { key, label: label.charAt(0).toUpperCase() + label.slice(1), entries: [] }
      groups.push(group)
    }
    group.entries.push(entry)
  }
  return groups
}
