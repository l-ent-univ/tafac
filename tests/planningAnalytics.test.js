import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLANNING_PAGE_SOURCES,
  createNavigationReporter,
  describePlanningLoad,
  getStepsBucket,
  toPlanningPageSource,
  toPlanningView,
} from '../src/planningAnalytics.js'
import { sanitizeAnalyticsEvent } from '../server/analyticsSchema.js'

// Timers the test advances by hand.
function createClock() {
  let now = 0
  let nextId = 1
  const timers = new Map()
  return {
    setTimer: (callback, delay) => {
      const id = nextId++
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.callback()
        }
      }
    },
  }
}

test('page sources outside the list count as other', () => {
  assert.equal(toPlanningPageSource('dashboard_card'), 'dashboard_card')
  assert.equal(toPlanningPageSource('history'), 'history')
  // The Planning's launch card (PlanningLaunchCard).
  assert.equal(toPlanningPageSource('launch_card'), 'launch_card')
  assert.equal(toPlanningPageSource('sidebar'), 'other')
  assert.equal(toPlanningPageSource(undefined), 'other')
})

test('every planning source and view gets through the server allowlist', () => {
  for (const source of PLANNING_PAGE_SOURCES) {
    for (const id of ['day', 'twoDays', 'week', 'list']) {
      const view = toPlanningView(id)
      const kept = sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'planning', source, view } }, { hasSession: true })
      assert.deepEqual(kept?.properties, { page: 'planning', source, view })
    }
  }
})

test('views are named for the analytics, unknown ones dropped', () => {
  assert.equal(toPlanningView('twoDays'), 'two_days')
  assert.equal(toPlanningView('week'), 'week')
  assert.equal(toPlanningView('month'), null)
  assert.equal(toPlanningView('toString'), null)
  assert.equal(toPlanningView(undefined), null)
})

test('the first week\'s load follows usePlanningWeeks\' state', () => {
  assert.equal(describePlanningLoad(), null)
  assert.equal(describePlanningLoad({ status: 'loading' }), null)
  assert.deepEqual(describePlanningLoad({ status: 'unconfigured' }), { status: 'unconfigured' })
  assert.deepEqual(describePlanningLoad({ status: 'loaded', hasClasses: true }), { status: 'ok' })
  assert.deepEqual(describePlanningLoad({ status: 'loaded', hasClasses: false }), { status: 'empty' })
  assert.deepEqual(describePlanningLoad({ status: 'unavailable', errorKind: 'timeout' }), { status: 'unavailable', errorKind: 'timeout' })
  // Unknown or missing categories never pass through as they are.
  assert.deepEqual(describePlanningLoad({ status: 'unavailable', errorKind: 'Connexion requise' }), { status: 'unavailable', errorKind: 'other' })
  assert.deepEqual(describePlanningLoad({ status: 'unavailable' }), { status: 'unavailable', errorKind: 'other' })
})

test('steps are bucketed', () => {
  assert.equal(getStepsBucket(0), null)
  assert.equal(getStepsBucket(undefined), null)
  assert.equal(getStepsBucket(1), '1')
  assert.equal(getStepsBucket(3), '2-3')
  assert.equal(getStepsBucket(40), '4+')
})

test('a burst of steps is reported once, when it settles', () => {
  const clock = createClock()
  const sent = []
  const reporter = createNavigationReporter((action, props) => sent.push({ action, ...props }), { delayMs: 1500, ...clock })
  // A held arrow key: one event.
  for (let index = 0; index < 12; index += 1) {
    reporter.report('day_changed', 'keyboard')
    clock.advance(100)
  }
  assert.deepEqual(sent, [])
  clock.advance(1500)
  assert.deepEqual(sent, [{ action: 'day_changed', via: 'keyboard', steps: '4+' }])
  // A single swipe, later.
  reporter.report('week_changed', 'swipe')
  clock.advance(1600)
  assert.deepEqual(sent.at(-1), { action: 'week_changed', via: 'swipe', steps: '1' })
  assert.equal(sent.length, 2)
})

test('another kind of step ends the burst, and flush sends what is open', () => {
  const clock = createClock()
  const sent = []
  const reporter = createNavigationReporter((action, props) => sent.push({ action, ...props }), clock)
  reporter.report('week_changed', 'arrow')
  reporter.report('week_changed', 'arrow')
  reporter.report('week_changed', 'strip')
  reporter.report('day_changed', 'strip')
  assert.deepEqual(sent, [
    { action: 'week_changed', via: 'arrow', steps: '2-3' },
    { action: 'week_changed', via: 'strip', steps: '1' },
  ])
  reporter.flush()
  assert.deepEqual(sent.at(-1), { action: 'day_changed', via: 'strip', steps: '1' })
  // Nothing open: nothing sent, and the old timer is gone.
  reporter.flush()
  clock.advance(5000)
  assert.equal(sent.length, 3)
})

test('no timetable at all is reported as an empty week', () => {
  assert.deepEqual(describePlanningLoad({ status: 'no-timetable' }), { status: 'empty' })
})
