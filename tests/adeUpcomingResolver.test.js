import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdeUpcomingResolver } from '../adeUpcomingResolver.js'

test('without an ADE mobile API, no group chosen gives no events instead of an error', async () => {
  const { resolveAdeUpcoming } = createAdeUpcomingResolver({
    fetchAdeUpcomingFromApi: null,
    fetchPlanningTreeFromRpc: async () => { throw new Error('unused') },
    fetchPlanningTimetableFromRpc: async () => { throw new Error('unused') },
  })
  const result = await resolveAdeUpcoming(null, null, { date: '2026-11-16', lookaheadDays: 7 })
  assert.deepEqual(result.events, [])
  assert.equal(result.nextEvent, null)
})

test('without an ADE mobile API, the Planning error is the one surfaced', async () => {
  const { resolveAdeUpcoming } = createAdeUpcomingResolver({
    fetchAdeUpcomingFromApi: null,
    fetchPlanningTreeFromRpc: async () => [],
    fetchPlanningTimetableFromRpc: async () => { throw new Error('planning down') },
  })
  await assert.rejects(
    resolveAdeUpcoming(null, null, { date: '2026-11-16', lookaheadDays: 7, resourceIds: ['42'] }),
    /planning down/,
  )
})
