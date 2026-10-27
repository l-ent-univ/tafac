import assert from 'node:assert/strict'
import test from 'node:test'
import { RETRY_AFTER_MS, failedWeeks, pageStatus, shouldAskWeek } from '../src/planningStates.js'

test('a week is asked once, again only when refreshed, retried or 30s after failing', () => {
  const now = 1_000_000
  assert.equal(shouldAskWeek(undefined, { now }), true)
  // On its way: never twice, even forced.
  assert.equal(shouldAskWeek({ status: 'loading' }, { now, force: true, retry: true }), false)
  // Answered: only a refresh asks again; a retry leaves it be.
  const loaded = { status: 'loaded', events: [] }
  assert.equal(shouldAskWeek(loaded, { now }), false)
  assert.equal(shouldAskWeek(loaded, { now, retry: true }), false)
  assert.equal(shouldAskWeek(loaded, { now, force: true }), true)
  // Failed: on its own after 30s, at once on a retry.
  const failed = { status: 'unavailable', failedAt: now - 1000 }
  assert.equal(shouldAskWeek(failed, { now }), false)
  assert.equal(shouldAskWeek(failed, { now, retry: true }), true)
  assert.equal(shouldAskWeek(failed, { now, force: true }), true)
  assert.equal(shouldAskWeek({ status: 'unavailable', failedAt: now - RETRY_AFTER_MS }, { now }), true)
})

test('a page without classes says first what is not set up, on its way, or failed', () => {
  assert.equal(pageStatus(['loaded', 'loaded']), 'loaded')
  assert.equal(pageStatus(['loaded', 'unavailable']), 'unavailable')
  assert.equal(pageStatus(['unavailable', 'loading']), 'loading')
  assert.equal(pageStatus(['loading', 'unconfigured']), 'unconfigured')
})

test('a page retries each of its failed weeks once', () => {
  const statuses = { '2026-10-18': 'loaded', '2026-10-19': 'unavailable', '2026-10-20': 'unavailable', '2026-10-26': 'unavailable' }
  const statusOn = (day) => statuses[day]
  assert.deepEqual(failedWeeks(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-26'], statusOn), ['2026-10-19', '2026-10-26'])
  assert.deepEqual(failedWeeks(['2026-10-18'], statusOn), [])
})

test('a planning service without any timetable for the account is a page state of its own', () => {
  assert.equal(pageStatus(['no-timetable', 'no-timetable']), 'no-timetable')
  assert.equal(pageStatus(['no-timetable', 'loading']), 'loading')
  assert.equal(pageStatus(['no-timetable', 'unavailable']), 'unavailable')
})
