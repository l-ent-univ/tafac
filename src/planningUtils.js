
export const DAY_START_HOUR = 8
export const DAY_END_HOUR = 19
export const TOTAL_GRID_HOURS = DAY_END_HOUR - DAY_START_HOUR

const DAY_MS = 24 * 60 * 60 * 1000
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

export function formatTime(value) {
  if (!value) return ''
  return timeFormatter.format(new Date(value)).replace(':', 'h')
}

export function formatDateOnly(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function startOfWeek(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  return monday
}

export function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function formatWeekLabel(monday) {
  const sunday = addDays(monday, 6)
  const sameMonth = monday.getMonth() === sunday.getMonth()
  const start = monday.toLocaleDateString('fr-FR', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  const end = sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${start} – ${end}`
}

export function formatMonthLabel(date) {
  return capitalize(date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }))
}

// Group events by day of week (Monday to Sunday)
export function groupByDay(events, monday, includeWeekend = false) {
  const count = includeWeekend ? 7 : 5
  const days = Array.from({ length: count }, (_, index) => ({
    date: addDays(monday, index),
    events: [],
  }))

  const sorted = [...(events || [])]
    .filter((event) => event?.start)
    .sort((left, right) => left.start.localeCompare(right.start) || (left.end ?? '').localeCompare(right.end ?? ''))

  for (const event of sorted) {
    const eventDate = new Date(event.start)
    const offset = Math.floor((new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime() - monday.getTime()) / DAY_MS)
    if (offset >= 0 && offset < count) {
      days[offset]?.events.push(event)
    }
  }

  return days
}

// Convert event time to top % and height % for the week/day time grid
export function getGridPosition(startIso, endIso, startHour = DAY_START_HOUR, endHour = DAY_END_HOUR) {
  const startDate = new Date(startIso)
  const endDate = new Date(endIso || startIso)

  const startDecimal = startDate.getHours() + startDate.getMinutes() / 60
  const endDecimal = endDate.getHours() + endDate.getMinutes() / 60

  const clampedStart = Math.max(startHour, Math.min(endHour, startDecimal))
  const clampedEnd = Math.max(clampedStart + 0.5, Math.min(endHour, endDecimal))

  const totalHours = endHour - startHour
  const topPercent = ((clampedStart - startHour) / totalHours) * 100
  const heightPercent = Math.max(3, ((clampedEnd - clampedStart) / totalHours) * 100)

  return {
    top: `${topPercent}%`,
    height: `${heightPercent}%`,
    startDecimal,
    endDecimal,
  }
}

// Layout events in non-overlapping columns within a time frame
export function computeEventLayout(events = [], startHour = DAY_START_HOUR, endHour = DAY_END_HOUR, baseLeft = 0, baseWidth = 100) {
  if (!events || events.length === 0) return []

  const sorted = [...events].sort((a, b) => {
    const startA = new Date(a.start).getTime()
    const startB = new Date(b.start).getTime()
    if (startA !== startB) return startA - startB
    return new Date(b.end || b.start).getTime() - new Date(a.end || a.start).getTime()
  })

  const clusters = []
  let currentCluster = []
  let clusterEnd = 0

  for (const event of sorted) {
    const s = new Date(event.start).getTime()
    const e = new Date(event.end || event.start).getTime()

    if (currentCluster.length === 0) {
      currentCluster.push(event)
      clusterEnd = e
    } else if (s < clusterEnd) {
      currentCluster.push(event)
      clusterEnd = Math.max(clusterEnd, e)
    } else {
      clusters.push(currentCluster)
      currentCluster = [event]
      clusterEnd = e
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster)
  }

  const results = []

  for (const cluster of clusters) {
    const columnEnds = []
    const clusterPlacements = []

    for (const event of cluster) {
      const s = new Date(event.start).getTime()
      const e = new Date(event.end || event.start).getTime()

      let placedCol = -1
      for (let i = 0; i < columnEnds.length; i++) {
        if (columnEnds[i] <= s) {
          placedCol = i
          columnEnds[i] = e
          break
        }
      }

      if (placedCol === -1) {
        placedCol = columnEnds.length
        columnEnds.push(e)
      }

      clusterPlacements.push({ event, col: placedCol })
    }

    const totalCols = columnEnds.length

    for (const placement of clusterPlacements) {
      const s = new Date(placement.event.start).getTime()
      const e = new Date(placement.event.end || placement.event.start).getTime()

      let colSpan = 1
      for (let c = placement.col + 1; c < totalCols; c++) {
        const hasCollision = clusterPlacements.some((other) => {
          if (other === placement || other.col !== c) return false
          const otherS = new Date(other.event.start).getTime()
          const otherE = new Date(other.event.end || other.event.start).getTime()
          return Math.max(s, otherS) < Math.min(e, otherE)
        })
        if (hasCollision) break
        colSpan += 1
      }

      const colWidth = baseWidth / totalCols
      const slotWidth = colWidth * colSpan
      const slotLeft = baseLeft + placement.col * colWidth

      const pos = getGridPosition(placement.event.start, placement.event.end, startHour, endHour)

      results.push({
        event: placement.event,
        pos: {
          top: pos.top,
          height: pos.height,
          left: `${slotLeft}%`,
          width: `${slotWidth}%`,
        },
        col: placement.col,
        colSpan,
        totalCols,
      })
    }
  }

  return results
}

// Calculate the position of current time indicator
export function getCurrentTimePosition(now = new Date(), startHour = DAY_START_HOUR, endHour = DAY_END_HOUR) {
  const currentDecimal = now.getHours() + now.getMinutes() / 60
  if (currentDecimal < startHour || currentDecimal > endHour) {
    return null
  }
  const topPercent = ((currentDecimal - startHour) / (endHour - startHour)) * 100
  return `${topPercent}%`
}

// Extract distinct teachers mentioned in a list of events
export function extractTeachersFromEvents(events = []) {
  const teachersMap = new Map()

  for (const event of events) {
    if (Array.isArray(event.teachers) && event.teachers.length > 0) {
      for (const t of event.teachers) {
        if (t?.name) {
          const key = t.id || t.name
          if (!teachersMap.has(key)) {
            teachersMap.set(key, { id: t.id || null, name: t.name })
          }
        }
      }
    } else if (event.teacher) {
      const parts = event.teacher.split(/ - | \/ | & |, /).map((p) => p.trim()).filter(Boolean)
      for (const part of parts) {
        if (!teachersMap.has(part)) {
          teachersMap.set(part, { id: null, name: part })
        }
      }
    }
  }

  return Array.from(teachersMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

// Compute common free time windows between student events and teacher events
export function findCommonFreeSlots({
  studentEvents = [],
  teacherEvents = [],
  monday,
  minDurationMinutes = 90,
  startHour = 8,
  endHour = 18.5,
}) {
  const slots = []
  const days = Array.from({ length: 5 }, (_, i) => addDays(monday, i))

  for (const day of days) {
    const dayStr = formatDateOnly(day)
    const dayStartMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(startHour), (startHour % 1) * 60).getTime()
    const dayEndMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(endHour), (endHour % 1) * 60).getTime()

    // Collect busy intervals for this day
    const busyIntervals = []

    const processEvent = (event) => {
      const s = new Date(event.start).getTime()
      const e = new Date(event.end).getTime()
      if (s < dayEndMs && e > dayStartMs) {
        busyIntervals.push({
          start: Math.max(dayStartMs, s),
          end: Math.min(dayEndMs, e),
        })
      }
    }

    studentEvents.forEach(processEvent)
    teacherEvents.forEach(processEvent)

    // Sort intervals
    busyIntervals.sort((a, b) => a.start - b.start)

    // Merge overlapping intervals
    const mergedBusy = []
    for (const interval of busyIntervals) {
      if (!mergedBusy.length) {
        mergedBusy.push({ ...interval })
      } else {
        const last = mergedBusy[mergedBusy.length - 1]
        if (interval.start <= last.end) {
          last.end = Math.max(last.end, interval.end)
        } else {
          mergedBusy.push({ ...interval })
        }
      }
    }

    // Find gaps
    let cursor = dayStartMs
    for (const busy of mergedBusy) {
      if (busy.start > cursor) {
        const durationMinutes = Math.round((busy.start - cursor) / (60 * 1000))
        if (durationMinutes >= minDurationMinutes) {
          slots.push({
            date: dayStr,
            dayName: capitalize(day.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })),
            startMs: cursor,
            endMs: busy.start,
            startTime: formatTime(cursor),
            endTime: formatTime(busy.start),
            durationMinutes,
            label: `${capitalize(day.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }))} : ${formatTime(cursor)} – ${formatTime(busy.start)} (${Math.floor(durationMinutes / 60)}h${durationMinutes % 60 ? durationMinutes % 60 : ''})`,
          })
        }
      }
      cursor = Math.max(cursor, busy.end)
    }

    if (cursor < dayEndMs) {
      const durationMinutes = Math.round((dayEndMs - cursor) / (60 * 1000))
      if (durationMinutes >= minDurationMinutes) {
        slots.push({
          date: dayStr,
          dayName: capitalize(day.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })),
          startMs: cursor,
          endMs: dayEndMs,
          startTime: formatTime(cursor),
          endTime: formatTime(dayEndMs),
          durationMinutes,
          label: `${capitalize(day.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }))} : ${formatTime(cursor)} – ${formatTime(dayEndMs)} (${Math.floor(durationMinutes / 60)}h${durationMinutes % 60 ? durationMinutes % 60 : ''})`,
        })
      }
    }
  }

  return slots
}

// Generate pre-filled polite email / message template to send to the teacher
export function generateRescheduleMessage({
  teacherName = 'Monsieur/Madame',
  courseTitle = 'notre cours',
  groupName = '',
  slots = [],
}) {
  const slotList = slots.length > 0
    ? slots.map((s) => `• ${s.label}`).join('\n')
    : '(aucun créneau évident trouvé sur cette semaine)'

  const intro = teacherName.startsWith('M.') || teacherName.startsWith('Mme')
    ? `Bonjour ${teacherName},`
    : `Bonjour M./Mme ${teacherName},`

  const groupText = groupName ? ` (groupe ${groupName})` : ''

  return `${intro}

Dans le cadre du déplacement / rattrapage du cours de « ${courseTitle} »${groupText}, nous avons vérifié les créneaux où notre promotion et vous-même semblons tous les deux disponibles cette semaine :

${slotList}

Seriez-vous disponible sur l'un de ces créneaux, ou auriez-vous une autre préférence ?

Bien cordialement,
Les étudiants${groupText}`
}

// ── iCalendar (.ics) Export ──

function formatIcsDate(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function escapeIcsText(text) {
  if (!text) return ''
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

export function generateIcsCalendar(events = [], calendarName = 'Emploi du temps - Tafac') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tafac//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    'X-WR-TIMEZONE:Europe/Paris',
  ]

  const nowIcs = formatIcsDate(new Date().toISOString())

  for (const event of events) {
    if (!event?.start || !event?.end) continue
    const startIcs = formatIcsDate(event.start)
    const endIcs = formatIcsDate(event.end)
    if (!startIcs || !endIcs) continue

    const uid = event.id ? `${event.id}@tafac.fr` : `evt-${startIcs}-${Math.random().toString(36).slice(2)}@tafac.fr`
    const summary = event.title || 'Cours'
    const location = event.location || ''
    const description = [
      event.teacher ? `Enseignant: ${event.teacher}` : '',
      event.groups?.length ? `Groupes: ${event.groups.join(', ')}` : '',
    ].filter(Boolean).join('\n')

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(`DTSTAMP:${nowIcs}`)
    lines.push(`DTSTART:${startIcs}`)
    lines.push(`DTEND:${endIcs}`)
    lines.push(`SUMMARY:${escapeIcsText(summary)}`)
    if (location) lines.push(`LOCATION:${escapeIcsText(location)}`)
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function downloadIcsCalendar(events = [], filename = 'emploi-du-temps.ics', calendarName) {
  const content = generateIcsCalendar(events, calendarName)
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Salles Libres (Trouver une salle libre pour bosser) ──

// `rooms` ([{ id, name }], ADE's "Salles"): every room counts, a room with no
// course that day being free all day; a course is in a room when it carries
// its id (`roomId`, the demo) or its location names it. `events`: that day's
// courses in those rooms.
export function findFreeRooms(events = [], atDate = new Date(), rooms = []) {
  const atTimeMs = atDate.getTime()
  const dateStr = formatDateOnly(atDate)

  // Courses of that day (local day: ADE's times are ISO, in UTC).
  const dayEvents = (events || []).filter((event) => (
    event?.start && event?.end && formatDateOnly(new Date(event.start)) === dateStr
  ))

  const roomsMap = new Map((rooms || []).map((room) => [room.name, []]))
  // The whole name, not a prefix: "A1" isn't in "A10".
  const namePatterns = new Map((rooms || []).map((room) => [
    room.name,
    new RegExp(`(^|[\\s,;/])${room.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s,;/])`),
  ]))
  for (const event of dayEvents) {
    const location = String(event.location ?? '')
    for (const room of rooms || []) {
      if (event.roomId === room.id || (location && namePatterns.get(room.name).test(location))) {
        roomsMap.get(room.name).push({
          ...event,
          startMs: new Date(event.start).getTime(),
          endMs: new Date(event.end).getTime(),
        })
      }
    }
  }

  const results = []

  for (const [room, roomEvts] of roomsMap.entries()) {
    roomEvts.sort((a, b) => a.startMs - b.startMs)
    const currentEvent = roomEvts.find((e) => e.startMs <= atTimeMs && e.endMs > atTimeMs)

    if (currentEvent) {
      const remainingMs = currentEvent.endMs - atTimeMs
      const remainingMin = Math.max(1, Math.round(remainingMs / (60 * 1000)))
      results.push({
        room,
        isFree: false,
        statusLabel: 'Occupée',
        currentClass: currentEvent.title,
        untilTime: formatTime(currentEvent.end),
        remainingMinutes: remainingMin,
        detail: `Occupée par « ${currentEvent.title} » jusqu'à ${formatTime(currentEvent.end)}`,
      })
    } else {
      const nextEvent = roomEvts.find((e) => e.startMs > atTimeMs)
      if (nextEvent) {
        const availableMs = nextEvent.startMs - atTimeMs
        const availableMin = Math.round(availableMs / (60 * 1000))
        results.push({
          room,
          isFree: true,
          statusLabel: 'Disponible',
          nextClass: nextEvent.title,
          untilTime: formatTime(nextEvent.start),
          availableMinutes: availableMin,
          detail: `Libre jusqu'à ${formatTime(nextEvent.start)} (encore ${Math.floor(availableMin / 60)}h${availableMin % 60 ? `${availableMin % 60}`.padStart(2, '0') : ''})`,
        })
      } else {
        results.push({
          room,
          isFree: true,
          statusLabel: 'Disponible',
          nextClass: null,
          untilTime: null,
          availableMinutes: 999,
          detail: 'Libre pour tout le reste de la journée !',
        })
      }
    }
  }

  results.sort((a, b) => {
    if (a.isFree && !b.isFree) return -1
    if (!a.isFree && b.isFree) return 1
    if (a.isFree && b.isFree) return b.availableMinutes - a.availableMinutes
    return a.remainingMinutes - b.remainingMinutes
  })

  return results
}

