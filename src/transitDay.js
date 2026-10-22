// Buses fitted to the timetable: for each coming day with classes, the bus
// to the first one (arriving `marginMin` early), the bus home after the
// last one, and whether that last class ends after the last bus. Then the
// push reminders made of them (server/transitPush.js). Pure: `now` passed
// in, no fetch, unit tested (tests/transitDay.test.js).

import { formatClock } from './transitClock.js'

export const PLAN_DAYS = 7
const MORNING_NOTICE_MIN = 10
// The evening before a day whose last class ends after the last bus.
const LAST_BUS_WARNING_HOUR = 20

function dayKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// ADE events → [{ dayKey, first: { start, title }, last: { end, title } }]
// for the coming PLAN_DAYS days with classes, today included while its last
// class hasn't ended. Times in epoch ms.
export function classDays(events, now, days = PLAN_DAYS) {
  const byDay = new Map()
  const horizon = now + days * 24 * 60 * 60 * 1000
  for (const event of events ?? []) {
    const start = Date.parse(event?.start)
    const end = Date.parse(event?.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now || start > horizon) continue
    const dayKey = dayKeyOf(new Date(start))
    const day = byDay.get(dayKey) ?? { dayKey, first: null, last: null }
    if (!day.first || start < day.first.start) day.first = { start, title: event.title ?? '' }
    if (!day.last || end > day.last.end) day.last = { end, title: event.title ?? '' }
    byDay.set(dayKey, day)
  }
  return [...byDay.values()].sort((left, right) => left.first.start - right.first.start)
}

// The plan queries of those days (server: POST /transit/plan): to the
// campus before the first class (when still to come), home after the last.
export function buildDayQueries(days, { home, campus, marginMin, now }) {
  const queries = []
  for (const day of days) {
    if (day.first.start - marginMin * 60_000 > now) {
      queries.push({ dayKey: day.dayKey, kind: 'to', query: { from: home, to: campus, arriveBy: day.first.start - marginMin * 60_000, limit: 2 } })
    }
    queries.push({ dayKey: day.dayKey, kind: 'from', query: { from: campus, to: home, departAt: Math.max(day.last.end, now), limit: 2 } })
  }
  return queries
}

const sameDay = (left, right) => dayKeyOf(new Date(left)) === dayKeyOf(new Date(right))

// Answers of buildDayQueries (same order) → per day { ...day, to, from }:
// the journeys, a return only on the class's own day (not next morning).
export function mergeDayJourneys(days, queries, results) {
  const plans = new Map(days.map((day) => [day.dayKey, { ...day, to: null, from: null }]))
  queries.forEach((entry, index) => {
    const plan = plans.get(entry.dayKey)
    const journeys = results?.[index] ?? null
    if (!plan || !journeys) return
    plan[entry.kind] = entry.kind === 'from'
      ? journeys.filter((journey) => sameDay(journey.leaveAt, plan.last.end))
      : journeys
  })
  return [...plans.values()]
}

// Days whose last class ends with no bus home after it: the lastOfDay
// queries to tell when the last bus leaves.
export function buildLastBusQueries(plans, { home, campus }) {
  return plans
    .filter((plan) => plan.from && plan.from.length === 0)
    .map((plan) => ({ dayKey: plan.dayKey, query: { from: campus, to: home, lastOfDay: plan.dayKey.replaceAll('-', ''), limit: 1 } }))
}

// What a leg is called in a notification: "Ligne A" (or the line's name).
function lineLabel(leg) {
  return /^\d+$|^[A-Z]$/.test(leg.line) ? `ligne ${leg.line}` : leg.line
}

// The trip to show now (the « Bus » card): the bus to class while it
// hasn't left, else the bus home, else the warning of a day without one,
// else the next day's.
export function pickNextTrip(plans, now) {
  for (const plan of plans) {
    const to = plan.to?.[0]
    if (to && to.leaveAt > now - 60_000) return { kind: 'to', plan, journey: to }
    const from = plan.from?.[0]
    if (from && from.legs[0].departAt > now) return { kind: 'from', plan, journey: from }
    if (plan.lastBus && plan.from?.length === 0 && plan.last.end > now) return { kind: 'none', plan, journey: null }
  }
  return null
}

// → [{ id, kind, at, title, body, url, tripId, stopId, departAt, line }]
// stopName(stopId) names the stops. Reminders already past are left out.
export function buildReminders(plans, { now, stopName, campusLabel }) {
  const reminders = []
  for (const plan of plans) {
    const to = plan.to?.[0]
    if (to) {
      const leg = to.legs[0]
      const at = to.leaveAt - MORNING_NOTICE_MIN * 60_000
      if (at > now - 60_000) {
        reminders.push({
          id: `${plan.dayKey}-to-${leg.tripId}`,
          kind: 'morning',
          at,
          title: `Bus ${leg.line} à ${formatClock(leg.departAt)}`,
          body: `Pars à ${formatClock(to.leaveAt)} pour ${stopName(leg.fromStopId) ?? 'ton arrêt'} : cours à ${formatClock(plan.first.start)}${to.transfers ? `, changement à ${stopName(leg.toStopId) ?? 'mi-chemin'}` : ''}.`,
          url: '/bus',
          tripId: leg.tripId,
          stopId: leg.fromStopId,
          departAt: leg.scheduledDepartAt,
          line: leg.line,
        })
      }
    }
    const from = plan.from?.[0]
    if (from) {
      const leg = from.legs[0]
      const at = Math.max(plan.last.end - 5 * 60_000, now + 60_000)
      if (at < leg.departAt) {
        reminders.push({
          id: `${plan.dayKey}-from-${leg.tripId}`,
          kind: 'return',
          at,
          title: `Retour : ${lineLabel(leg)} à ${formatClock(leg.departAt)}`,
          body: `Depuis ${stopName(leg.fromStopId) ?? campusLabel}, chez toi vers ${formatClock(from.arriveAt)}.`,
          url: '/bus',
          tripId: leg.tripId,
          stopId: leg.fromStopId,
          departAt: leg.scheduledDepartAt,
          line: leg.line,
        })
      }
    }
    if (plan.lastBus && plan.from?.length === 0) {
      const evening = new Date(plan.first.start)
      evening.setDate(evening.getDate() - 1)
      evening.setHours(LAST_BUS_WARNING_HOUR, 0, 0, 0)
      // Too late for the evening before: the morning of the day itself.
      const at = evening.getTime() > now ? evening.getTime() : now + 60_000
      if (at < plan.last.end - 60 * 60_000) {
        const sameDayWarning = sameDay(at, plan.first.start)
        reminders.push({
          id: `${plan.dayKey}-lastbus`,
          kind: 'lastBus',
          at,
          title: sameDayWarning ? 'Pas de bus après ton dernier cours' : 'Demain, pas de bus après ton dernier cours',
          body: `Ton cours finit à ${formatClock(plan.last.end)}, le dernier bus part à ${formatClock(plan.lastBus.legs[0].departAt)}. Prévois un autre moyen de rentrer.`,
          url: '/bus',
        })
      }
    }
  }
  return reminders
}
