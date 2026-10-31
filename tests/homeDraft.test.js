import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDueList, buildGradeList, buildUnreadList, formatDueLabel, formatMark, pickAgendaDay } from '../src/homeDraft.js'

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

test('due labels go from minutes to days', () => {
  const now = at(29, 10)
  assert.equal(formatDueLabel(at(29, 10, 20), now), 'Dans 20 min')
  assert.equal(formatDueLabel(at(29, 12), now), 'Dans 2 h')
  assert.equal(formatDueLabel(at(29, 23, 59), now), 'Aujourd’hui à 23h59')
  assert.equal(formatDueLabel(at(30, 12), now), 'Demain à 12h')
  assert.equal(formatDueLabel(at(31, 8, 30), now), 'Samedi à 8h30')
  assert.equal(formatDueLabel(at(28, 12), now), 'En retard')
})

test('« À rendre » keeps open deadlines of the week, soonest first', () => {
  const now = at(29, 10)
  const items = buildDueList([
    { id: 'later', title: 'Rapport', courseName: 'R5.01', dueAt: at(34, 12).toISOString() },
    { id: 'soon', title: 'Quiz', dueAt: at(29, 18).toISOString() },
    { id: 'late', title: 'TP noté', dueAt: at(28, 12).toISOString() },
    { id: 'done', title: 'Rendu', dueAt: at(29, 18).toISOString(), submitted: true },
    { id: 'far', title: 'Mémoire', dueAt: at(60, 12).toISOString() },
  ], now)
  assert.deepEqual(items.map((item) => item.id), ['deadline:late', 'deadline:soon', 'deadline:later'])
  assert.deepEqual(items.map((item) => item.urgent), [true, true, false])
  assert.equal(items[0].overdue, true)
  assert.equal(items[2].detail, 'R5.01')
  assert.deepEqual(buildDueList(null, now), [])
})

test('« Notes » lists the latest grades, new ones flagged once « Mes notes » was opened here', () => {
  const grades = [
    { id: 7, description: 'Partiel', note: '14.50', noteSur: '20', resource: 'R5.01' },
    { id: 6, description: 'TP', note: '12', noteSur: '20' },
  ]
  assert.deepEqual(buildGradeList(grades, ['6']).map(({ id, meta, isNew }) => ({ id, meta, isNew })), [
    { id: 'grade:7', meta: '14,5/20', isNew: true },
    { id: 'grade:6', meta: '12/20', isNew: false },
  ])
  assert.deepEqual(buildGradeList(grades, null).map((item) => item.isNew), [false, false])
  assert.equal(buildGradeList(grades, null, 1).length, 1)
  assert.equal(formatMark('ABS'), 'ABS/20')
  assert.equal(formatMark(''), '')
})

test('« Non lus » keeps unread mails only', () => {
  const items = buildUnreadList([
    { id: '1', subject: 'Salle changée', unread: true, from: { name: 'Scolarité' } },
    { id: '2', subject: 'Lu', unread: false },
    { id: '3', subject: '  ', unread: true, from: { email: 'x@univ.fr' } },
  ])
  assert.deepEqual(items.map(({ id, title, detail }) => ({ id, title, detail })), [
    { id: 'mail:1', title: 'Salle changée', detail: 'Scolarité' },
    { id: 'mail:3', title: '(Sans objet)', detail: 'x@univ.fr' },
  ])
})
