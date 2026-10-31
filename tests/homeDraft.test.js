import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHomeFeed, buildWeekStrip, formatDueLabel, pickAgendaDay } from '../src/homeDraft.js'

// Days of October 2026 (the 29th is a Thursday), local time; day 33 is
// 2 November.
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute)
const event = (day, startHour, endHour, title = 'R5.02 Anglais') => ({
  start: at(day, startHour).toISOString(),
  end: at(day, endHour).toISOString(),
  title,
  location: 'B12',
})

test('the agenda shows today while classes remain, with each class’s status', () => {
  const events = [event(29, 8, 10, 'Maths'), event(29, 10, 12, 'Anglais'), event(29, 14, 16, 'Projet'), event(30, 9, 11)]
  const agenda = pickAgendaDay(events, at(29, 10, 30))
  assert.equal(agenda.isToday, true)
  assert.equal(agenda.label, 'Aujourd’hui')
  assert.deepEqual(agenda.classes.map((item) => item.status), ['past', 'now', 'next'])
})

test('the agenda moves to the next day with classes once today is over', () => {
  const events = [event(29, 8, 10), event(33, 9, 11)]
  const agenda = pickAgendaDay(events, at(29, 19))
  assert.equal(agenda.isToday, false)
  assert.equal(agenda.dayKey, '2026-11-02')
  assert.equal(agenda.label, 'Lundi 2 novembre')
  assert.equal(agenda.freeToday, false)
})

test('a free day says so and shows tomorrow', () => {
  const agenda = pickAgendaDay([event(30, 9, 11)], at(29, 9))
  assert.equal(agenda.label, 'Demain')
  assert.equal(agenda.freeToday, true)
  assert.equal(pickAgendaDay([], at(29, 9)), null)
})

test('duplicated slots (one per group) count once', () => {
  const agenda = pickAgendaDay([event(29, 14, 16), event(29, 14, 16)], at(29, 9))
  assert.equal(agenda.classes.length, 1)
})

test('the week strip counts classes and open deadlines per day', () => {
  const days = buildWeekStrip(
    [event(29, 8, 10), event(29, 14, 17), event(31, 9, 11)],
    [{ dueAt: at(29, 23, 59).toISOString() }, { dueAt: at(30, 12).toISOString(), submitted: true }],
    at(29, 7),
  )
  assert.equal(days.length, 7)
  assert.deepEqual(
    days.slice(0, 3).map(({ dayKey, classCount, firstStart, lastEnd, deadlineCount }) => ({ dayKey, classCount, firstStart, lastEnd, deadlineCount })),
    [
      { dayKey: '2026-10-29', classCount: 2, firstStart: '8h', lastEnd: '17h', deadlineCount: 1 },
      { dayKey: '2026-10-30', classCount: 0, firstStart: null, lastEnd: null, deadlineCount: 0 },
      { dayKey: '2026-10-31', classCount: 1, firstStart: '9h', lastEnd: '11h', deadlineCount: 0 },
    ],
  )
  assert.equal(days[0].isToday, true)
  assert.equal(days[0].weekday, 'Jeu')
})

test('due labels go from minutes to days', () => {
  const now = at(29, 10)
  assert.equal(formatDueLabel(at(29, 10, 20), now), 'Dans 20 min')
  assert.equal(formatDueLabel(at(29, 12), now), 'Dans 2 h')
  assert.equal(formatDueLabel(at(29, 23, 59), now), 'Aujourd’hui à 23h59')
  assert.equal(formatDueLabel(at(30, 12), now), 'Demain à 12h')
  assert.equal(formatDueLabel(at(31, 8, 30), now), 'Samedi à 8h30')
  assert.equal(formatDueLabel(at(28, 12), now), 'En retard')
})

test('« À traiter » puts urgent deadlines first, then new grades, unread mails, later deadlines', () => {
  const now = at(29, 10)
  const feed = buildHomeFeed({
    deadlines: [
      { id: 'later', title: 'Rapport', dueAt: at(34, 12).toISOString() },
      { id: 'soon', title: 'Quiz', dueAt: at(29, 18).toISOString() },
      { id: 'done', title: 'Rendu', dueAt: at(29, 18).toISOString(), submitted: true },
      { id: 'far', title: 'Mémoire', dueAt: at(60, 12).toISOString() },
    ],
    mails: [
      { id: '1', subject: 'Salle changée', unread: true, from: { name: 'Scolarité' } },
      { id: '2', subject: 'Lu', unread: false },
    ],
    grades: [
      { id: 7, description: 'Partiel', note: '14.50', noteSur: '20', resource: 'R5.01', date: at(27, 9).toISOString() },
      { id: 6, description: 'TP', note: '12', noteSur: '20', resource: 'R5.02', date: at(20, 9).toISOString() },
    ],
    seenGradeIds: ['6'],
    now,
  })
  assert.deepEqual(feed.map((item) => item.id), ['deadline:soon', 'grade:7', 'mail:1', 'deadline:later'])
  assert.equal(feed[0].urgent, true)
  assert.equal(feed[1].meta, '14.5/20')
  assert.equal(feed[2].detail, 'Scolarité')
})

test('without a « Mes notes » visit, only a recent latest grade shows', () => {
  const now = at(29, 10)
  const grades = [{ id: 7, description: 'Partiel', note: '14', date: at(27, 9).toISOString() }, { id: 6, description: 'TP', note: '12', date: at(26, 9).toISOString() }]
  assert.deepEqual(buildHomeFeed({ grades, now }).map((item) => item.id), ['grade:7'])
  assert.deepEqual(buildHomeFeed({ grades: [{ ...grades[0], date: at(1, 9).toISOString() }], now }), [])
  assert.deepEqual(buildHomeFeed(), [])
})
