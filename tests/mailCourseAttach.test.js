import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoTimetablePayload } from '../src/demoAccount.js'
import { courseWindow, courseWindowMondays, filterCourseDays, listCourseDays, pickCourseStartDay } from '../src/mailCourseAttach.js'
import { mergeEvents, toPlanningEvent } from '../src/planningEvents.js'

const at = (month, day, hours) => new Date(2026, month - 1, day, hours).getTime()
const lesson = (id, month, day, hours, extra = {}) => toPlanningEvent({ uid: id, title: `Cours ${id}`, startMs: at(month, day, hours), endMs: at(month, day, hours + 2), ...extra })

// Wednesday 28 October 2026.
const today = '2026-10-28'

test('the drawer\'s window: the week before today and the week after, the weeks it spans', () => {
  assert.deepEqual(courseWindow(today), { from: '2026-10-21', to: '2026-11-04' })
  assert.deepEqual(courseWindowMondays(today), ['2026-10-19', '2026-10-26', '2026-11-02'])
  // A Monday: from the Monday before to the Monday after.
  assert.deepEqual(courseWindowMondays('2026-11-02'), ['2026-10-26', '2026-11-02', '2026-11-09'])
})

test('the drawer\'s classes: the window\'s, by day in order, opened on today or the next day', () => {
  const events = mergeEvents([
    lesson('old', 10, 20, 8),
    lesson('a', 10, 22, 8),
    lesson('b', 10, 27, 14),
    lesson('c', 10, 27, 8),
    lesson('d', 10, 29, 10),
    lesson('e', 11, 4, 9),
    lesson('far', 11, 5, 9),
  ])
  const days = listCourseDays(events, today)
  assert.deepEqual(days.map((entry) => [entry.day, entry.events.map((event) => event.uid)]), [
    ['2026-10-22', ['a']],
    ['2026-10-27', ['c', 'b']],
    ['2026-10-29', ['d']],
    ['2026-11-04', ['e']],
  ])
  // No class today: the next day with some.
  assert.equal(pickCourseStartDay(days, today), '2026-10-29')
  assert.equal(pickCourseStartDay(days, '2026-10-27'), '2026-10-27')
  // All past: the last.
  assert.equal(pickCourseStartDay(days.slice(0, 2), today), '2026-10-27')
  assert.equal(pickCourseStartDay([], today), null)
  assert.deepEqual(listCourseDays(null, today), [])
})

test('the drawer\'s search: every word in the class or its day, accents aside', () => {
  const events = mergeEvents([
    lesson('1', 10, 27, 8, { title: 'R5.12 Développement back-end', location: 'A08 - Info 2', teacher: 'M. Lemoine' }),
    lesson('2', 10, 27, 14, { title: 'R5.02 Anglais', location: 'B12 - Langues', teacher: 'Mme Kerjean' }),
    // TEMPO's: no room nor teacher.
    lesson('3', 10, 29, 10, { title: 'Anglais TD', groupsLabel: 'L2 INFO-COM' }),
  ])
  const days = listCourseDays(events, today)
  const uids = (query) => filterCourseDays(days, query, today).flatMap((entry) => entry.events.map((event) => event.uid))
  assert.equal(filterCourseDays(days, '  ', today), days)
  assert.deepEqual(uids('developpement'), ['1'])
  assert.deepEqual(uids('anglais'), ['2', '3'])
  assert.deepEqual(uids('LEMOINE a08'), ['1'])
  assert.deepEqual(uids('info-com'), ['3'])
  // By its day: « hier », « demain », its weekday or date.
  assert.deepEqual(uids('hier'), ['1', '2'])
  assert.deepEqual(uids('demain'), ['3'])
  assert.deepEqual(uids('jeudi anglais'), ['3'])
  assert.deepEqual(uids('zzz'), [])
  // A day left empty goes.
  assert.deepEqual(filterCourseDays(days, 'kerjean', today).map((entry) => entry.day), ['2026-10-27'])
})

test('the demo\'s week lists in the drawer, its shared class with its two teachers', () => {
  const payload = buildDemoTimetablePayload({ date: today })
  const events = mergeEvents(payload.events.map(toPlanningEvent))
  const days = listCourseDays(events, today)
  assert.ok(days.length >= 5)
  const shared = events.find((event) => event.title === 'SAE Prototype interactif' && event.teacher.includes(' - '))
  assert.equal(shared.teacher, 'Mme Le Fur - M. Lemoine')
})
