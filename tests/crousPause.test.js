import assert from 'node:assert/strict'
import test from 'node:test'
import { findLunchBreak, formatDuration, formatMinutes, parseServiceWindow, serviceStatus } from '../src/crousPause.js'

const iso = (day, time) => {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(2026, 9, day, hours, minutes).toISOString()
}
const at = (time) => {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(2026, 9, 26, hours, minutes)
}
const WINDOW = parseServiceWindow('11h30-13h45')

test('parseServiceWindow reads the CROUS notation', () => {
  assert.deepEqual(WINDOW, { open: 690, close: 825 })
  assert.deepEqual(parseServiceWindow('11h-14h'), { open: 660, close: 840 })
  assert.equal(parseServiceWindow('fermé'), null)
})

test('serviceStatus: before, during and after the service, and days off', () => {
  assert.deepEqual(serviceStatus(WINDOW, at('10:50'), true), { state: 'soon', minutesLeft: 40 })
  const open = serviceStatus(WINDOW, at('12:00'), true)
  assert.equal(open.state, 'open')
  assert.equal(open.minutesLeft, 105)
  assert.equal(serviceStatus(WINDOW, at('14:00'), true).state, 'over')
  assert.equal(serviceStatus(WINDOW, at('12:00'), false).state, 'closed')
})

test('findLunchBreak: the gap between classes over the service', () => {
  const events = [
    { start: iso(26, '08:00'), end: iso(26, '10:00') },
    { start: iso(26, '10:15'), end: iso(26, '12:15') },
    { start: iso(26, '13:30'), end: iso(26, '15:30') },
    { start: iso(27, '08:00'), end: iso(27, '18:00') },
  ]
  assert.deepEqual(findLunchBreak(events, '2026-10-26', WINDOW), { start: 735, end: 810 })
  // Classes all day: no break.
  assert.equal(findLunchBreak(events, '2026-10-27', WINDOW), null)
  // Morning only: free from the last class to the end of service.
  assert.deepEqual(findLunchBreak([{ start: iso(28, '09:00'), end: iso(28, '12:00') }], '2026-10-28', WINDOW), { start: 720, end: 825 })
  assert.equal(findLunchBreak(events, '2026-10-29', WINDOW), null)
})

test('formatting', () => {
  assert.equal(formatMinutes(690), '11h30')
  assert.equal(formatDuration(75), '1h15')
  assert.equal(formatDuration(60), '1h')
  assert.equal(formatDuration(40), '40 min')
})
