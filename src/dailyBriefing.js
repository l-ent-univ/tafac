// "Briefing du jour": the short sentence under "Salut Camille !" on the
// greeting card. Built from what the dashboard already has on the device
// (ADE classes, Moodle deadlines) and from the time of day. Pure on purpose: no storage, no fetch, `now` passed in, so every
// case is unit tested (tests/dailyBriefing.test.js).

const NNBSP = '\u202f'
// A day without classes switches to tomorrow from this hour on.
const EVENING_HOUR = 18
// The card fits two short lines: facts get their short form, then the least
// useful ones are dropped, until the sentence fits.
const MAX_BRIEFING_LENGTH = 64
const MAX_FACTS = 3

const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' })
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })

function parseDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// Calendar days between two dates (0 = same day, 1 = tomorrow).
function dayDiff(date, now) {
  return Math.round((startOfDay(date) - startOfDay(now)) / (24 * 60 * 60 * 1000))
}

// "8h", "16h30": the next-class card notation, without the leading zero.
function formatHour(date) {
  const minutes = date.getMinutes()
  return `${date.getHours()}h${minutes ? String(minutes).padStart(2, '0') : ''}`
}

// When classes resume: "demain", "lundi", then "le 3 novembre".
function formatResumeDay(date, now) {
  const diff = dayDiff(date, now)
  if (diff === 1) return 'demain'
  if (diff < 7) return weekdayFormatter.format(date)
  return `le ${dayMonthFormatter.format(date)}`
}

function plural(count, word) {
  return `${count} ${word}${count > 1 ? 's' : ''}`
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// ADE events as { start, end } dates, sorted, without duplicates (the same
// slot can come back once per selected group).
function normalizeEvents(events) {
  const seen = new Set()
  return events
    .map((event) => {
      const start = parseDate(event?.start)
      if (!start) return null
      const end = parseDate(event?.end)
      return { start, end: end && end > start ? end : start, key: `${event?.start}|${event?.end}|${event?.title ?? ''}` }
    })
    .filter((event) => {
      if (!event || seen.has(event.key)) return false
      seen.add(event.key)
      return true
    })
    .sort((left, right) => left.start - right.start)
}

function getLastEnd(events) {
  return events.reduce((latest, event) => (event.end > latest ? event.end : latest), events[0].end)
}

// Classes fact plus the day the rest of the briefing talks about: 'today'
// while classes remain (or before the evening on a free day), 'tomorrow' once
// the day is over. A null classes input (ADE unavailable) still sets the
// day from the clock.
function describeClasses(classes, now) {
  const events = Array.isArray(classes?.events) ? normalizeEvents(classes.events) : null
  // An incomplete list can miss classes: never claim a free day from it.
  const canClaimFree = classes?.complete !== false
  const fallbackDay = now.getHours() >= EVENING_HOUR ? 'tomorrow' : 'today'

  if (!events) {
    return { day: fallbackDay, fact: null }
  }

  const today = events.filter((event) => dayDiff(event.start, now) === 0)
  const remaining = today.filter((event) => event.end > now)

  if (remaining.length > 0) {
    const lastEnd = formatHour(getLastEnd(today))
    const first = remaining[0]

    // Before the first class of the day.
    if (today[0].start > now) {
      if (today.length === 1) {
        return {
          day: 'today',
          fact: { long: `1 cours aujourd’hui, de ${formatHour(first.start)} à ${lastEnd}`, short: `1 cours aujourd’hui, à ${formatHour(first.start)}` },
        }
      }
      return {
        day: 'today',
        fact: {
          long: `${today.length} cours aujourd’hui, premier à ${formatHour(first.start)}, fin à ${lastEnd}`,
          short: `${today.length} cours aujourd’hui, premier à ${formatHour(first.start)}`,
        },
      }
    }

    // During the day.
    if (remaining.length === 1) {
      const text = first.start <= now
        ? `Dernier cours, fin à ${lastEnd}`
        : `Plus qu’un cours, à ${formatHour(first.start)}`
      return { day: 'today', fact: { long: text, short: text } }
    }
    const text = `Encore ${remaining.length} cours, fin à ${lastEnd}`
    return { day: 'today', fact: { long: text, short: text } }
  }

  const upcoming = events.filter((event) => event.start > now)

  // A free day, before the evening.
  if (today.length === 0 && fallbackDay === 'today') {
    if (!canClaimFree) return { day: 'today', fact: null }
    const next = upcoming[0]
    const text = next
      ? `Pas de cours aujourd’hui, reprise ${formatResumeDay(next.start, now)} à ${formatHour(next.start)}`
      : 'Pas de cours aujourd’hui'
    return { day: 'today', fact: { long: text, short: text } }
  }

  // Last class done, or a free evening: tomorrow.
  const tomorrow = upcoming.filter((event) => dayDiff(event.start, now) === 1)
  if (tomorrow.length > 0) {
    const firstStart = formatHour(tomorrow[0].start)
    if (tomorrow.length === 1) {
      return { day: 'tomorrow', fact: { long: `Demain${NNBSP}: un seul cours, à ${firstStart}`, short: `Demain${NNBSP}: un cours à ${firstStart}` } }
    }
    return {
      day: 'tomorrow',
      fact: {
        long: `Demain${NNBSP}: ${tomorrow.length} cours, premier à ${firstStart}`,
        short: `Demain${NNBSP}: premier cours à ${firstStart}`,
      },
    }
  }

  if (!canClaimFree) return { day: 'tomorrow', fact: null }
  const next = upcoming.find((event) => dayDiff(event.start, now) > 1)
  const text = next
    ? `Pas de cours demain, reprise ${formatResumeDay(next.start, now)} à ${formatHour(next.start)}`
    : 'Pas de cours demain'
  return { day: 'tomorrow', fact: { long: text, short: text } }
}

// Moodle work still to hand in today or tomorrow. Overdue and submitted work
// is left to the "Échéances" card.
function describeDeadlines(items, now) {
  if (!Array.isArray(items)) return null

  let dueToday = 0
  let dueTomorrow = 0
  for (const item of items) {
    const due = parseDate(item?.dueAt)
    if (!due || item.submitted === true || item.overdue || due <= now) continue
    const diff = dayDiff(due, now)
    if (diff === 0) dueToday += 1
    else if (diff === 1) dueTomorrow += 1
  }

  if (dueToday > 0) {
    const when = now.getHours() >= EVENING_HOUR ? 'ce soir' : 'aujourd’hui'
    const short = `${plural(dueToday, 'devoir')} à rendre ${when}`
    return { long: dueTomorrow > 0 ? `${short}, ${dueTomorrow} demain` : short, short, isToday: true }
  }

  if (dueTomorrow > 0) {
    const text = `${plural(dueTomorrow, 'devoir')} à rendre demain`
    return { long: text, short: text }
  }

  return null
}

// The bus the « Bus » card picked (src/components/WidgetTransit.jsx), when
// it leaves today within BUS_HORIZON_HOURS: to class, or home.
const BUS_HORIZON_HOURS = 3
function describeBus(bus, now) {
  const leaveAt = parseDate(bus?.leaveAt)
  const departAt = parseDate(bus?.departAt)
  if (!leaveAt || !departAt || departAt <= now || dayDiff(departAt, now) !== 0) return null
  if (departAt.getTime() - now.getTime() > BUS_HORIZON_HOURS * 60 * 60 * 1000) return null
  const line = bus.line ? `bus ${bus.line}` : 'bus'
  if (bus.kind === 'from') {
    return { long: `Retour en ${line} à ${formatHour(departAt)}`, short: `Retour à ${formatHour(departAt)}` }
  }
  return { long: `Pars à ${formatHour(leaveAt)}, ${line} à ${formatHour(departAt)}`, short: `${capitalize(line)} à ${formatHour(departAt)}` }
}

function joinFacts(facts, variant) {
  return facts.map((fact) => `${capitalize(fact[variant])}.`).join(' ')
}

// classes: { events: [{ start, end, title }], complete } from ADE, or null.
// deadlines: Moodle items ({ dueAt, submitted, overdue }), or null.
// bus: { kind: 'to' | 'from', leaveAt, departAt, line } from the « Bus »
// card, or null.
// Returns null when there is nothing useful to say (ADE or Moodle
// unavailable, nothing due): the card then shows the greeting alone.
export function buildDailyBriefing({ classes = null, deadlines = null, bus = null, now = new Date() } = {}) {
  const { fact: classesFact } = describeClasses(classes, now)
  const deadlinesFact = describeDeadlines(deadlines, now)
  const busFact = describeBus(bus, now)
  // Display and priority order: classes, the bus to take, then deadlines.
  // Work due today goes first: it is the most urgent, and reads oddly after
  // "Demain :".
  const facts = (deadlinesFact?.isToday
    ? [deadlinesFact, classesFact, busFact]
    : [classesFact, busFact, deadlinesFact]
  ).filter(Boolean)

  if (facts.length === 0) {
    return null
  }

  let picked = facts.slice(0, MAX_FACTS)
  for (;;) {
    for (const variant of ['long', 'short']) {
      const text = joinFacts(picked, variant)
      if (text.length <= MAX_BRIEFING_LENGTH || (variant === 'short' && picked.length === 1)) {
        return text
      }
    }
    picked = picked.slice(0, -1)
  }
}
