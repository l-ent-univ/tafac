import assert from 'node:assert/strict'
import test from 'node:test'
import { absenceOn, findFocusedEvent } from '../src/planningAbsences.js'
import { toPlanningEvent } from '../src/planningEvents.js'

const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const lesson = (title, day, from, to) => toPlanningEvent({ id: title, title, startMs: at(day, from), endMs: at(day, to) })
const absence = (day, startHours, endHours, extra = {}) => ({
  id: `${day}-${startHours}`,
  date: `2026-10-${String(day).padStart(2, '0')}`,
  startHours,
  endHours,
  status: 'unjustified',
  moduleCode: null,
  subjectTitle: null,
  ...extra,
})

test('an absence marks the classes within its hours, on its day only', () => {
  const morning = lesson('R5.11 Anglais', 12, 8, 10)
  const noon = lesson('R5.12 UX', 12, 10, 12)
  const afternoon = lesson('R5.12 UX', 12, 14, 16)
  const nextDay = lesson('R5.11 Anglais', 13, 8, 10)
  const entries = [absence(12, 8.25, 10)]
  assert.equal(absenceOn(entries, morning), entries[0])
  // Ends as the next class starts: not that one.
  assert.equal(absenceOn(entries, noon), null)
  assert.equal(absenceOn(entries, afternoon), null)
  assert.equal(absenceOn(entries, nextDay), null)
})

test('a lateness marks the class it was in', () => {
  const entries = [absence(12, 9.5, 9.5, { status: 'late' })]
  assert.equal(absenceOn(entries, lesson('Anglais', 12, 8, 10)), entries[0])
  assert.equal(absenceOn(entries, lesson('UX', 12, 10, 12)), null)
})

test('an absence picks its class by module, then subject, else the first within its hours', () => {
  const english = lesson('R5.11 Anglais', 12, 8, 10)
  const ux = lesson('R5.12 UX', 12, 8, 10)
  const events = [english, ux]
  assert.equal(findFocusedEvent(events, absence(12, 8, 10, { moduleCode: 'R5.12' })), ux)
  assert.equal(findFocusedEvent(events, absence(12, 8, 10, { subjectTitle: 'Anglais' })), english)
  assert.equal(findFocusedEvent(events, absence(12, 8, 10)), english)
  assert.equal(findFocusedEvent(events, absence(12, 14, 16)), null)
})
