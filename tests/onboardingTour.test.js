import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TOUR_STATE_KEY,
  TOUR_STEPS,
  doneTourValue,
  findAvailableStep,
  readTourValue,
  resolveTourVisit,
  writeTourValue,
} from '../src/onboardingTour.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test('a brand-new device gets the tour and remembers it is pending', () => {
  assert.deepEqual(
    resolveTourVisit({ rawTour: null, rawChangelogSeen: null }),
    { pending: true, nextValue: 'pending' },
  )
})

test('a device that already recorded a changelog visit never gets the tour', () => {
  assert.deepEqual(
    resolveTourVisit({ rawTour: null, rawChangelogSeen: '{"ids":[]}' }),
    { pending: false, nextValue: 'done' },
  )
})

test('students arriving from the old l\'ent address skip the tour', () => {
  assert.deepEqual(
    resolveTourVisit({ rawTour: null, rawChangelogSeen: null, arrivedFromLent: true }),
    { pending: false, nextValue: 'done' },
  )
})

test('a pending tour survives a reload, a finished one stays finished', () => {
  assert.deepEqual(
    resolveTourVisit({ rawTour: 'pending', rawChangelogSeen: '{"ids":[]}' }),
    { pending: true, nextValue: null },
  )
  assert.deepEqual(
    resolveTourVisit({ rawTour: 'done', rawChangelogSeen: null }),
    { pending: false, nextValue: null },
  )
})

test('findAvailableStep skips unavailable steps in both directions', () => {
  const available = (step) => step.id !== 'search'
  const searchIndex = TOUR_STEPS.findIndex((step) => step.id === 'search')
  assert.equal(findAvailableStep(TOUR_STEPS, searchIndex - 1, 1, available), searchIndex + 1)
  assert.equal(findAvailableStep(TOUR_STEPS, searchIndex + 1, -1, available), searchIndex - 1)
  assert.equal(findAvailableStep(TOUR_STEPS, TOUR_STEPS.length - 1, 1, available), -1)
  assert.equal(findAvailableStep(TOUR_STEPS, 0, -1, available), -1)
})

test('step ids are unique and the first step has no target', () => {
  assert.equal(new Set(TOUR_STEPS.map((step) => step.id)).size, TOUR_STEPS.length)
  assert.equal(TOUR_STEPS[0].target, undefined)
})

test('storage helpers round-trip and survive a broken storage', () => {
  const storage = memoryStorage()
  assert.equal(readTourValue(storage), null)
  writeTourValue(doneTourValue(), storage)
  assert.equal(storage.getItem(TOUR_STATE_KEY), 'done')

  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readTourValue(broken), null)
  assert.doesNotThrow(() => writeTourValue('done', broken))
})
