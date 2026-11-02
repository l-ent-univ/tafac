import assert from 'node:assert/strict'
import test from 'node:test'
import { getAdeSelectionResourceIds } from '../adeApi.js'

test('the courses added beside the group come after its own resources', () => {
  const selection = {
    resourceId: '12',
    tpResourceId: '12',
    tdResourceId: '11',
    yearResourceId: '10',
    extraResources: [{ resourceId: '40', label: 'Majeure IA' }, { resourceId: '11', label: 'Doublon' }, { resourceId: '41', label: 'Option' }],
  }
  assert.deepEqual(getAdeSelectionResourceIds(selection), ['12', '11', '10', '40', '41'])
})

test('at most 12 added courses reach the planning', () => {
  const extraResources = Array.from({ length: 20 }, (_, index) => ({ resourceId: String(100 + index), label: 'C' }))
  assert.equal(getAdeSelectionResourceIds({ resourceId: '1', extraResources }).length, 13)
})
