import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoGradesPayload } from '../src/demoAccount.js'
import { readHiddenRank } from '../src/gradesReport.js'
import { estimateRank, normalCdf, normalQuantile } from '../src/rankEstimate.js'
import { describePocRank } from '../src/rankPoc.js'

test('the normal curve and its inverse', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7)
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4)
  for (const p of [0.01, 0.1, 0.5, 0.9, 0.99]) assert.ok(Math.abs(normalCdf(normalQuantile(p)) - p) < 1e-6, String(p))
})

test('the estimate: the ends, the middle, and an order that follows the average', () => {
  const promo = { min: 6, moy: 12, max: 18, total: 51 }
  assert.deepEqual(estimateRank({ ...promo, average: 18 }), { position: 1, total: 51 })
  assert.deepEqual(estimateRank({ ...promo, average: 19 }), { position: 1, total: 51 })
  assert.deepEqual(estimateRank({ ...promo, average: 5 }), { position: 51, total: 51 })
  // At the mean of a symmetric promo: the middle.
  assert.equal(estimateRank({ ...promo, average: 12 }).position, 26)
  // A better average never ranks worse.
  let last = Infinity
  for (let average = 6; average <= 18; average += 0.25) {
    const { position } = estimateRank({ ...promo, average })
    assert.ok(position <= last, `${average}`)
    last = position
  }
  // Lopsided: a long tail below the mean puts more students above it.
  assert.ok(estimateRank({ min: 2, moy: 12, max: 15, total: 51, average: 12 }).position < 26)
  assert.equal(estimateRank({ ...promo, average: 12, total: 1 }), null)
  assert.equal(estimateRank({ ...promo, average: null }), null)
  assert.equal(estimateRank({ min: 12, moy: 10, max: 18, total: 51, average: 12 }), null)
})

test('the rank ScoDoc sends though the department hides it', () => {
  const releve = buildDemoGradesPayload()['relevé']
  // The demo hides ranks, as the Rennes department seen: the rank is there anyway.
  assert.equal(releve.options.show_rangs, false)
  assert.deepEqual(readHiddenRank(releve), { value: '9', total: 84 })
  // Shown by the department: nothing hidden to reveal.
  assert.equal(readHiddenRank({ ...releve, options: { ...releve.options, show_rangs: true } }), null)
  const poc = describePocRank(releve)
  assert.deepEqual(poc.hidden, { value: '9', total: 84 })
  assert.equal(poc.estimate.total, 84)
  assert.ok(poc.estimate.position >= 1 && poc.estimate.position <= 84)
  // Masked as « - » with the promo's size: the estimate alone.
  const masked = { ...releve, semestre: { ...releve.semestre, rang: { value: '-', total: 84 } } }
  assert.equal(readHiddenRank(masked), null)
  assert.deepEqual(describePocRank(masked), { hidden: null, estimate: poc.estimate })
  // No rank sent at all: the promo's size isn't known either, so nothing.
  const stripped = { ...releve, semestre: { ...releve.semestre, rang: undefined } }
  assert.equal(describePocRank(stripped), null)
})
