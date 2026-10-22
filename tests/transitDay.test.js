import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDayQueries, buildLastBusQueries, buildReminders, classDays, mergeDayJourneys, pickNextTrip } from '../src/transitDay.js'
import { formatClock, formatCountdown } from '../src/transitClock.js'

const at = (day, time) => {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(2026, 9, day, hours, minutes).getTime()
}
const iso = (day, time) => new Date(at(day, time)).toISOString()
const home = { placeId: 'gare' }
const campus = { campus: 'iutlan' }

const EVENTS = [
  { start: iso(23, '10:00'), end: iso(23, '12:00'), title: 'Réseaux' },
  { start: iso(23, '08:00'), end: iso(23, '10:00'), title: 'Maths' },
  { start: iso(23, '14:00'), end: iso(23, '18:30'), title: 'Projet' },
  { start: iso(26, '13:30'), end: iso(26, '15:30'), title: 'Anglais' },
  { start: iso(22, '08:00'), end: iso(22, '09:00'), title: 'Passé' },
]

function journey(leave, arrive, line = 'A', tripId = `${line}-${leave}`) {
  return {
    leaveAt: leave,
    arriveAt: arrive,
    transfers: 0,
    legs: [{ tripId, line, fromStopId: 'gare1', toStopId: 'iut1', departAt: leave + 120_000, scheduledDepartAt: leave + 120_000, arriveAt: arrive }],
  }
}

test('classDays keeps the first and last class of each coming day', () => {
  const days = classDays(EVENTS, at(22, '20:00'))
  assert.deepEqual(days.map((day) => day.dayKey), ['2026-10-23', '2026-10-26'])
  assert.equal(days[0].first.title, 'Maths')
  assert.equal(days[0].last.end, at(23, '18:30'))
})

test('buildDayQueries: to the campus margin minutes early, home after the last class', () => {
  const now = at(23, '09:00')
  const queries = buildDayQueries(classDays(EVENTS, now), { home, campus, marginMin: 5, now })
  // Today's first class already started: no outbound query for it.
  assert.deepEqual(queries.map((entry) => `${entry.dayKey} ${entry.kind}`), ['2026-10-23 from', '2026-10-26 to', '2026-10-26 from'])
  assert.equal(queries[1].query.arriveBy, at(26, '13:25'))
  assert.equal(queries[0].query.departAt, at(23, '18:30'))
})

test('reminders: the morning bus, the bus home, and the warning when there is none', () => {
  const now = at(22, '21:00')
  const days = classDays(EVENTS, now)
  const queries = buildDayQueries(days, { home, campus, marginMin: 5, now })
  const results = queries.map((entry) => {
    if (entry.dayKey === '2026-10-23' && entry.kind === 'to') return [journey(at(23, '07:30'), at(23, '07:48'))]
    if (entry.dayKey === '2026-10-23' && entry.kind === 'from') return [journey(at(24, '07:00'), at(24, '07:20'))]
    if (entry.dayKey === '2026-10-26' && entry.kind === 'from') return [journey(at(26, '15:50'), at(26, '16:05'), 'C')]
    return []
  })
  const plans = mergeDayJourneys(days, queries, results)
  // The return found is next morning's: not a return.
  assert.deepEqual(plans[0].from, [])
  const lastBusQueries = buildLastBusQueries(plans, { home, campus })
  assert.deepEqual(lastBusQueries.map((entry) => entry.query.lastOfDay), ['20261023'])
  plans[0].lastBus = journey(at(23, '18:05'), at(23, '18:20'))

  const reminders = buildReminders(plans, { now, stopName: (id) => ({ gare1: 'Gare', iut1: 'IUT' })[id], campusLabel: 'IUT' })
  const byKind = Object.fromEntries(reminders.map((reminder) => [`${reminder.id.slice(0, 10)} ${reminder.kind}`, reminder]))

  const morning = byKind['2026-10-23 morning']
  assert.equal(morning.at, at(23, '07:20'))
  assert.equal(morning.title, 'Bus A à 7h32')
  assert.match(morning.body, /Pars à 7h30 pour Gare : cours à 8h00/)
  assert.equal(morning.tripId, 'A-' + at(23, '07:30'))

  // The evening before is already past: warned right away.
  const warning = byKind['2026-10-23 lastBus']
  assert.equal(warning.at, at(22, '21:01'))
  assert.match(warning.body, /finit à 18h30, le dernier bus part à 18h07/)

  const home2610 = byKind['2026-10-26 return']
  assert.equal(home2610.at, at(26, '15:25'))
  assert.equal(home2610.title, 'Retour : ligne C à 15h52')
  assert.equal(byKind['2026-10-26 morning'], undefined)
})

test('clock helpers', () => {
  assert.equal(formatClock(at(23, '07:05')), '7h05')
  assert.equal(formatCountdown(at(23, '07:05'), at(23, '07:01')), 'dans 4 min')
  assert.equal(formatCountdown(at(23, '09:05'), at(23, '07:01')), 'à 9h05')
})

test('pickNextTrip: the bus to class, then home, then the warning', () => {
  const plan = {
    dayKey: '2026-10-23',
    first: { start: at(23, '08:00') },
    last: { end: at(23, '18:30') },
    to: [journey(at(23, '07:30'), at(23, '07:48'))],
    from: [journey(at(23, '18:40'), at(23, '18:55'))],
  }
  assert.equal(pickNextTrip([plan], at(23, '07:00')).kind, 'to')
  assert.equal(pickNextTrip([plan], at(23, '12:00')).kind, 'from')
  assert.equal(pickNextTrip([{ ...plan, from: [], lastBus: journey(at(23, '18:05'), at(23, '18:20')) }], at(23, '12:00')).kind, 'none')
  assert.equal(pickNextTrip([plan], at(23, '19:00')), null)
})
