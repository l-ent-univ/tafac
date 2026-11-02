import assert from 'node:assert/strict'
import test from 'node:test'
import { formatHour, pickNextClassesDay } from '../src/nextClassesDay.js'

// Days of October 2026 (the 29th is a Thursday), local time; day 33 is
// 2 November.
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute)
const event = (day, startHour, endHour, title = 'R5.02 Anglais') => ({
  start: at(day, startHour).toISOString(),
  end: at(day, endHour).toISOString(),
  title,
  location: 'B12',
})

test('today while a class remains: the ones left, the current one flagged', () => {
  const events = [event(29, 8, 10, 'Maths'), event(29, 10, 12, 'Anglais'), event(29, 14, 16, 'Projet'), event(30, 9, 11)]
  const day = pickNextClassesDay(events, at(29, 10, 30))
  assert.equal(day.label, 'Aujourd’hui')
  assert.equal(day.isToday, true)
  assert.deepEqual(day.classes.map(({ title, isNow }) => ({ title, isNow })), [
    { title: 'Anglais', isNow: true },
    { title: 'Projet', isNow: false },
  ])
})

test('once today is over, the next day with classes, all of them', () => {
  const day = pickNextClassesDay([event(29, 8, 10), event(33, 9, 11, 'A'), event(33, 14, 16, 'B'), event(34, 9, 11)], at(29, 19))
  assert.equal(day.dayKey, '2026-11-02')
  assert.equal(day.label, 'Lundi 2 novembre')
  assert.deepEqual(day.classes.map((item) => item.title), ['A', 'B'])
})

test('tomorrow is named, duplicates count once, nothing to come is null', () => {
  const day = pickNextClassesDay([event(30, 9, 11), event(30, 9, 11)], at(29, 20))
  assert.equal(day.label, 'Demain')
  assert.equal(day.classes.length, 1)
  assert.equal(pickNextClassesDay([event(28, 9, 11)], at(29, 9)), null)
  assert.equal(pickNextClassesDay(null, at(29, 9)), null)
})

test('hours as the dashboard writes them', () => {
  assert.equal(formatHour(at(29, 8)), '8h')
  assert.equal(formatHour(at(29, 16, 30)), '16h30')
})
