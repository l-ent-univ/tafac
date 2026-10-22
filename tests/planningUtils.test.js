import assert from 'node:assert/strict'
import test from 'node:test'
import { findFreeRooms } from '../src/planningUtils.js'

const at = (hour, minute = 0) => new Date(2026, 9, 20, hour, minute)
const course = (location, startHour, endHour, title = 'Cours') => ({
  title,
  location,
  start: at(startHour).toISOString(),
  end: at(endHour).toISOString(),
})

test('findFreeRooms lists every room, free all day without a course', () => {
  const rooms = [{ id: '1', name: 'A1' }, { id: '2', name: 'A10' }, { id: '3', name: 'B03 - Salle Atelier' }]
  const events = [
    course('A10 - Amphi Nord', 9, 11, 'Maths'),
    course('B03 - Salle Atelier', 11, 12, 'UX'),
  ]
  const results = findFreeRooms(events, at(10), rooms)
  const byRoom = Object.fromEntries(results.map((result) => [result.room, result]))

  // "A1" is not "A10": it's free all day.
  assert.equal(byRoom.A1.isFree, true)
  assert.equal(byRoom.A1.availableMinutes, 999)
  assert.equal(byRoom.A10.isFree, false)
  assert.equal(byRoom.A10.currentClass, 'Maths')
  assert.equal(byRoom['B03 - Salle Atelier'].isFree, true)
  assert.equal(byRoom['B03 - Salle Atelier'].availableMinutes, 60)
  // Free rooms first, the longest free first.
  assert.deepEqual(results.map((result) => result.room), ['A1', 'B03 - Salle Atelier', 'A10'])
})

test('findFreeRooms matches the demo courses by room id', () => {
  const results = findFreeRooms([{ ...course('ailleurs', 9, 11), roomId: 'r1' }], at(10), [{ id: 'r1', name: 'Salle 1' }])
  assert.equal(results[0].isFree, false)
})
