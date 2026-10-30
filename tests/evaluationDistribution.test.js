import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoEvaluationDistribution, buildDemoSemesterGradesPayload } from '../src/demoAccount.js'
import {
  bucketOfGrade,
  buildDistribution,
  findReleveEvaluation,
  generateDemoGrades,
  normalizeDistributionAnswer,
  readDistributionCounts,
} from '../src/evaluationDistribution.js'
import { bucketOfGrade as bucketFromReport, parseGradeNumber } from '../src/gradesReport.js'

const sum = (values) => values.reduce((total, value) => total + value, 0)

test('bucketOfGrade bins like the passerelle (Math.floor, 21 bars)', () => {
  assert.equal(bucketFromReport, bucketOfGrade)
  assert.equal(bucketOfGrade(0), 0)
  assert.equal(bucketOfGrade(9.99), 9)
  assert.equal(bucketOfGrade(10), 10)
  assert.equal(bucketOfGrade(14.75), 14)
  assert.equal(bucketOfGrade(19.5), 19)
  assert.equal(bucketOfGrade(20), 20)
  assert.equal(bucketOfGrade('12.50'), 12)
  assert.equal(bucketOfGrade('12,5'), 12)
  // value / note_max × 20 can fall a hair under the integer it means.
  assert.equal(bucketOfGrade((7 / 10) * 20 - 1e-12), 14)
  assert.equal(bucketOfGrade(21), 20)
  assert.equal(bucketOfGrade(-1), 0)
  for (const value of [null, undefined, '', 'ABS', '~', Number.NaN, Infinity]) {
    assert.equal(bucketOfGrade(value), null, String(value))
  }
})

test('the listeNotes answer becomes 21 counts', () => {
  const answer = normalizeDistributionAnswer([12.5, 8, 20, 0, 14.25, 14.75, 19.999])
  assert.deepEqual(answer.bins, 'integer')
  assert.equal(answer.status, 'ok')
  assert.equal(answer.total, 7)
  assert.equal(answer.counts.length, 21)
  assert.deepEqual(
    answer.counts.flatMap((count, bucket) => Array(count).fill(bucket)),
    [0, 8, 12, 14, 14, 19, 20],
  )
})

test('the passerelle refusals become reasons', () => {
  assert.deepEqual(normalizeDistributionAnswer(['too low']), { status: 'unavailable', reason: 'too-few' })
  assert.deepEqual(normalizeDistributionAnswer([]), { status: 'unavailable', reason: 'too-few' })
  assert.deepEqual(normalizeDistributionAnswer([10, 11, 12, 13, 14]), { status: 'unavailable', reason: 'too-few' })
  assert.deepEqual(
    normalizeDistributionAnswer({ erreur: "L'histogramme n'est pas activé" }),
    { status: 'unavailable', reason: 'disabled' },
  )
  // Anything else isn't a listeNotes answer.
  assert.equal(normalizeDistributionAnswer({ erreur: 'Mauvaise requête.' }), null)
  assert.equal(normalizeDistributionAnswer({ redirect: '/' }), null)
  assert.equal(normalizeDistributionAnswer([10, 11, 'x', 12, 13, 14]), null)
  assert.equal(normalizeDistributionAnswer(null), null)
  assert.equal(normalizeDistributionAnswer(new Array(6000).fill(10)), null)
})

test('relayed counts are checked again', () => {
  const ok = buildDistribution([1, 2, 3, 4, 5, 6])
  assert.deepEqual(readDistributionCounts(ok), { counts: ok.counts, total: 6 })
  assert.equal(readDistributionCounts({ ...ok, total: 7 }), null)
  assert.equal(readDistributionCounts({ counts: ok.counts.slice(1), total: 6 }), null)
  assert.equal(readDistributionCounts({ counts: ok.counts.map((count) => count - 0.5), total: 3 }), null)
  assert.equal(readDistributionCounts({ counts: new Array(21).fill(0), total: 0 }), null)
})

test('findReleveEvaluation looks in ressources and SAÉs', () => {
  const releve = buildDemoSemesterGradesPayload(9105)['relevé']
  assert.equal(findReleveEvaluation(releve, '70111')?.description, 'Communiqué de presse')
  assert.equal(findReleveEvaluation(releve, 70201)?.description, 'Point d’étape')
  assert.equal(findReleveEvaluation(releve, '30104'), null)
  assert.equal(findReleveEvaluation(null, '1'), null)
})

test('generated demo grades match the promo stats', () => {
  const cases = [
    { seed: 1, total: 90, min: 4, moy: 12.5, max: 19.5, grade: 16 },
    { seed: 2, total: 15, min: 4, moy: 8.6, max: 12.5, grade: 6.5 },
    { seed: 3, total: 84, min: 8.25, moy: 12.4, max: 17.5, grade: null },
    { seed: 4, total: 40, min: 10, moy: 10, max: 10, grade: 10 },
  ]
  for (const spec of cases) {
    const grades = generateDemoGrades(spec)
    assert.equal(grades.length, spec.total)
    assert.equal(Math.min(...grades), spec.min)
    assert.equal(Math.max(...grades), spec.max)
    assert.ok(Math.abs(sum(grades) / grades.length - spec.moy) < 0.05, `mean of seed ${spec.seed}`)
    if (spec.grade != null) assert.ok(grades.includes(spec.grade))
  }
  assert.deepEqual(generateDemoGrades(cases[0]), generateDemoGrades(cases[0]))
  assert.notDeepEqual(generateDemoGrades(cases[0]), generateDemoGrades({ ...cases[0], seed: 5 }))
  assert.deepEqual(generateDemoGrades({ seed: 1, total: 10, min: 12, moy: 10, max: 8 }), [])
})

test('every demo evaluation has a histogram consistent with its relevé', () => {
  let checked = 0
  for (const semesterId of [9101, 9102, 9103, 9104, 9105]) {
    const releve = buildDemoSemesterGradesPayload(semesterId)['relevé']
    const promoSize = releve.semestre.rang.total
    for (const module of [...Object.values(releve.ressources), ...Object.values(releve.saes)]) {
      for (const evaluation of module.evaluations) {
        const answer = buildDemoEvaluationDistribution(String(semesterId), String(evaluation.id))
        const [min, moy, max] = ['min', 'moy', 'max'].map((key) => parseGradeNumber(evaluation.note[key]))
        if (min == null) {
          assert.deepEqual(answer, { status: 'unavailable', reason: 'too-few' })
          continue
        }

        const label = `${semesterId}/${evaluation.id}`
        assert.equal(answer.status, 'ok', label)
        assert.equal(sum(answer.counts), answer.total, label)
        assert.ok(answer.total <= promoSize && answer.total >= 6, label)
        if (evaluation.evaluation_type === 0) assert.ok(answer.total >= promoSize - 3, label)
        assert.ok(answer.counts[bucketOfGrade(min)] > 0, `${label} min bucket`)
        assert.ok(answer.counts[bucketOfGrade(max)] > 0, `${label} max bucket`)
        assert.ok(answer.counts.every((count, bucket) => count === 0 || (bucket >= bucketOfGrade(min) && bucket <= bucketOfGrade(max))), label)
        // Bucket midpoints put the mean within half a point of moy.
        const mean = sum(answer.counts.map((count, bucket) => count * (bucket + 0.5))) / answer.total
        assert.ok(Math.abs(mean - moy) < 0.75, `${label} mean ${mean} vs ${moy}`)
        const grade = parseGradeNumber(evaluation.note.value)
        if (grade != null && evaluation.note.value !== 'ABS') assert.ok(answer.counts[bucketOfGrade(grade)] > 0, `${label} own grade`)
        checked += 1
      }
    }
  }
  assert.ok(checked > 80)
  assert.deepEqual(buildDemoEvaluationDistribution('current', '70111'), buildDemoEvaluationDistribution('9105', '70111'))
  assert.equal(buildDemoEvaluationDistribution('9105', '30104'), null)
  assert.equal(buildDemoEvaluationDistribution('9999', '70111'), null)
})
