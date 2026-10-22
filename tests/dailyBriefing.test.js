import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDailyBriefing } from '../src/dailyBriefing.js'

// Local-time helpers: the briefing reads the device clock, so fixtures are
// built in local time too. October 2026: the 12th is a Monday.
function at(day, hour, minute = 0) {
  return new Date(2026, 9, day, hour, minute)
}

function course(day, [startHour, startMinute = 0], [endHour, endMinute = 0], title = 'Cours') {
  return {
    start: at(day, startHour, startMinute).toISOString(),
    end: at(day, endHour, endMinute).toISOString(),
    title,
  }
}

// Monday 12: three classes. Tuesday 13: two classes from 10h. Then nothing
// until Monday 19.
const WEEK = {
  complete: true,
  events: [
    course(12, [8], [10], 'R101 Algo'),
    course(12, [10, 15], [12, 15], 'R102 Web'),
    course(12, [14, 30], [16, 30], 'R103 Anglais'),
    course(13, [10], [12]),
    course(13, [13, 30], [15, 30]),
    course(19, [8], [10]),
  ],
}

test('morning: count, first class and end of the day', () => {
  assert.equal(
    buildDailyBriefing({ classes: WEEK, now: at(12, 7, 10) }),
    '3 cours aujourd’hui, premier à 8h, fin à 16h30.',
  )
})

test('morning with a single class gives its time slot', () => {
  const classes = { complete: true, events: [course(12, [10], [12])] }
  assert.equal(buildDailyBriefing({ classes, now: at(12, 8) }), '1 cours aujourd’hui, de 10h à 12h.')
})

test('during the day: classes left, including the one in progress', () => {
  assert.equal(buildDailyBriefing({ classes: WEEK, now: at(12, 11) }), 'Encore 2 cours, fin à 16h30.')
  assert.equal(buildDailyBriefing({ classes: WEEK, now: at(12, 13) }), 'Plus qu’un cours, à 14h30.')
  assert.equal(buildDailyBriefing({ classes: WEEK, now: at(12, 15) }), 'Dernier cours, fin à 16h30.')
})

test('after the last class: tomorrow', () => {
  assert.equal(
    buildDailyBriefing({ classes: WEEK, now: at(12, 17) }),
    'Demain\u202f: 2 cours, premier à 10h.',
  )
})

test('evening before a free day says when classes resume', () => {
  assert.equal(
    buildDailyBriefing({ classes: WEEK, now: at(13, 19) }),
    'Pas de cours demain, reprise lundi à 8h.',
  )
})

test('weekend and holidays: no classes today', () => {
  assert.equal(
    buildDailyBriefing({ classes: WEEK, now: at(17, 11) }),
    'Pas de cours aujourd’hui, reprise lundi à 8h.',
  )

  const holidays = { complete: true, events: [course(30, [9], [11])] }
  assert.equal(
    buildDailyBriefing({ classes: holidays, now: at(19, 10) }),
    'Pas de cours aujourd’hui, reprise le 30 octobre à 9h.',
  )
  assert.equal(
    buildDailyBriefing({ classes: { complete: true, events: [] }, now: at(19, 10) }),
    'Pas de cours aujourd’hui.',
  )
})

test('duplicate slots from several groups count once', () => {
  const classes = { complete: true, events: [course(12, [8], [10], 'Algo'), course(12, [8], [10], 'Algo'), course(12, [14], [16])] }
  assert.equal(buildDailyBriefing({ classes, now: at(12, 7) }), '2 cours aujourd’hui, premier à 8h, fin à 16h.')
})

test('deadlines due today or tomorrow, skipping submitted and overdue work; today first', () => {
  const deadlines = [
    { dueAt: at(13, 23, 59).toISOString(), submitted: false },
    { dueAt: at(13, 12).toISOString(), submitted: true },
    { dueAt: at(12, 6).toISOString(), overdue: true },
    { dueAt: at(20, 12).toISOString() },
  ]
  assert.equal(
    buildDailyBriefing({ classes: WEEK, deadlines, now: at(12, 11) }),
    'Encore 2 cours, fin à 16h30. 1 devoir à rendre demain.',
  )

  const dueToday = [
    { dueAt: at(12, 23, 59).toISOString() },
    { dueAt: at(12, 22).toISOString() },
    { dueAt: at(13, 18).toISOString() },
  ]
  assert.equal(
    buildDailyBriefing({ deadlines: dueToday, now: at(12, 14) }),
    '2 devoirs à rendre aujourd’hui, 1 demain.',
  )
  assert.equal(
    buildDailyBriefing({ classes: WEEK, deadlines: dueToday, now: at(12, 19) }),
    '2 devoirs à rendre ce soir. Demain\u202f: premier cours à 10h.',
  )
})

test('long briefings switch to the short form of each fact', () => {
  const deadlines = [{ dueAt: at(13, 12).toISOString() }]

  assert.equal(
    buildDailyBriefing({ classes: WEEK, deadlines, now: at(12, 7) }),
    '3 cours aujourd’hui, premier à 8h. 1 devoir à rendre demain.',
  )
  for (let hour = 0; hour < 24; hour += 1) {
    const text = buildDailyBriefing({ classes: WEEK, deadlines, now: at(12, hour) })
    assert.ok(text.length <= 64, `${hour}h: ${text}`)
  }
})

test('nothing to say gives null (the card shows the greeting alone)', () => {
  assert.equal(buildDailyBriefing({ now: at(12, 9) }), null)
  assert.equal(buildDailyBriefing({ classes: null, deadlines: null, now: at(12, 20) }), null)
  assert.equal(buildDailyBriefing({ deadlines: [], now: at(17, 9) }), null)

  // An incomplete ADE answer never claims a free day.
  assert.equal(buildDailyBriefing({ classes: { complete: false, events: [] }, now: at(12, 9) }), null)
  // Malformed events are ignored rather than crashing.
  assert.equal(buildDailyBriefing({ classes: { events: [{ start: 'n/a' }, null] }, now: at(12, 9) }), 'Pas de cours aujourd’hui.')
})

test('the bus card\'s next bus joins the briefing when it leaves soon', () => {
  const bus = { kind: 'to', leaveAt: at(12, 7, 28), departAt: at(12, 7, 32), line: 'A' }
  const text = buildDailyBriefing({ classes: { events: [], complete: false }, bus, now: at(12, 7) })
  assert.equal(text, 'Pars à 7h28, bus A à 7h32.')
  assert.equal(buildDailyBriefing({ classes: { events: [], complete: false }, bus, now: at(12, 3) }), null)
  assert.equal(buildDailyBriefing({ classes: { events: [], complete: false }, bus: { ...bus, kind: 'from' }, now: at(12, 7) }), 'Retour en bus A à 7h32.')
})
