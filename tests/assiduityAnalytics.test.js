import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ASSIDUITY_PAGE_SOURCES,
  advanceJustifyReach,
  describeAssiduityLoad,
  toAssiduityPageSource,
  toProofChoice,
} from '../src/assiduityAnalytics.js'

test('arrival sources: the known ones, else other', () => {
  for (const source of ASSIDUITY_PAGE_SOURCES) assert.equal(toAssiduityPageSource(source), source)
  assert.equal(toAssiduityPageSource('tile'), 'other')
  assert.equal(toAssiduityPageSource(undefined), 'other')
})

test('the load as categories, never what the absences are', () => {
  assert.equal(describeAssiduityLoad({ status: 'loading' }), null)
  assert.deepEqual(describeAssiduityLoad({ status: 'ok', hasReleve: true, visible: true, count: 4 }), { status: 'ok' })
  assert.deepEqual(describeAssiduityLoad({ status: 'ok', hasReleve: true, visible: true, count: 0 }), { status: 'empty' })
  assert.deepEqual(describeAssiduityLoad({ status: 'ok', hasReleve: true, visible: false, count: 0 }), { status: 'hidden' })
  assert.deepEqual(describeAssiduityLoad({ status: 'ok', hasReleve: false }), { status: 'missing' })
  // No ScoDoc relevé at all: missing, not an error.
  assert.deepEqual(describeAssiduityLoad({ status: 'error', unavailable: true }), { status: 'missing' })
  assert.deepEqual(describeAssiduityLoad({ status: 'error', errorKind: 'timeout' }), { status: 'error', errorKind: 'timeout' })
  assert.deepEqual(describeAssiduityLoad({ status: 'error', errorKind: 'ScoDoc down' }), { status: 'error', errorKind: 'other' })
})

test('« Justifier » keeps the furthest step reached', () => {
  assert.equal(advanceJustifyReach(null, 'reason'), 'reason')
  assert.equal(advanceJustifyReach('reason', 'review'), 'review')
  // Back to an earlier step: still the furthest.
  assert.equal(advanceJustifyReach('review', 'proof'), 'review')
  assert.equal(advanceJustifyReach('review', 'composed'), 'composed')
  assert.equal(advanceJustifyReach('proof', 'illness'), 'proof')
  assert.equal(toProofChoice('attached'), 'attached')
  assert.equal(toProofChoice('certificat.jpg'), null)
})
