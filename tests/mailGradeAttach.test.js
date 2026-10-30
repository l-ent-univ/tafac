import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoGradesPayload } from '../src/demoAccount.js'
import { buildGradeSummaryRows } from '../src/gradeMail.js'
import { buildGradesReport } from '../src/gradesReport.js'
import { buildGradeInsertion, filterRecentGrades, gradeAttachFields, listRecentGrades, pickGradeInsertIndex } from '../src/mailGradeAttach.js'
import { MAX_INLINE_IMAGES } from '../src/mailInlineImages.js'

const payload = buildDemoGradesPayload()
const report = buildGradesReport(payload['relevé'], { config: payload.config })

const evaluation = (id, date, grade = { kind: 'number', value: 12 }, description = `Éval ${id}`) => ({ id, date, grade, description })

test('the sheet\'s grades: all of the semester, newest first, undated last, none pending', () => {
  const fake = {
    status: 'ok',
    resources: [{ code: 'R1.01', title: 'Initiation au développement', evaluations: [
      evaluation(1, '2026-10-02T08:00:00+02:00'),
      evaluation(2, null),
      evaluation(3, '2026-10-20T08:00:00+02:00', { kind: 'pending', label: 'En attente' }),
    ] }],
    saes: [{ code: 'SAÉ 1.01', title: 'Implémentation', evaluations: [
      evaluation(4, '2026-10-12T08:00:00+02:00', { kind: 'absent', label: 'Absent' }),
      evaluation(5, '2026-10-02T08:00:00+02:00'),
    ] }],
  }
  assert.deepEqual(listRecentGrades(fake).map((entry) => entry.key), ['SAÉ 1.01:4', 'R1.01:1', 'SAÉ 1.01:5', 'R1.01:2'])
  assert.deepEqual(listRecentGrades({ status: 'unpublished' }), [])
  assert.deepEqual(listRecentGrades(null), [])

  // The demo's: more than « Dernières notes » shows (6), in its order.
  const grades = listRecentGrades(report)
  assert.ok(grades.length > report.latest.length)
  assert.deepEqual(grades.slice(0, report.latest.length).map((entry) => entry.evaluation.id), report.latest.map((grade) => grade.id))
  for (let index = 1; index < grades.length; index += 1) {
    if (grades[index].evaluation.date) assert.ok(grades[index - 1].evaluation.date >= grades[index].evaluation.date)
  }
})

test('the sheet\'s search: each word in the evaluation or the subject, accents aside', () => {
  const grades = listRecentGrades(report)
  assert.equal(filterRecentGrades(grades, ''), grades)
  assert.equal(filterRecentGrades(grades, '   '), grades)
  const byCode = filterRecentGrades(grades, 'r5.11')
  assert.ok(byCode.length > 0)
  assert.ok(byCode.every((entry) => entry.module.code === 'R5.11'))
  const title = grades[0].module.title
  const folded = title.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
  assert.ok(filterRecentGrades(grades, folded).some((entry) => entry.key === grades[0].key))
  assert.deepEqual(filterRecentGrades(grades, 'zzz introuvable'), [])
})

test('where a grade goes: after the caret\'s line, or under the text', () => {
  const p = (empty = false) => ({ type: 'paragraph', empty })
  const signature = { type: 'mailSignature', empty: false }
  // A new mail, never in the text: before the signature.
  assert.deepEqual(pickGradeInsertIndex([p(true), signature]), { index: 1, withLine: false })
  assert.deepEqual(pickGradeInsertIndex([p(true), signature], null), { index: 1, withLine: false })
  // No signature: at the end.
  assert.deepEqual(pickGradeInsertIndex([p(), p()]), { index: 2, withLine: false })
  // A reply without a signature: before the empty line and the quote's header.
  const reply = [p(true), p(), p(true), p(), { type: 'blockquote', empty: false }]
  assert.deepEqual(pickGradeInsertIndex(reply), { index: 2, withLine: false })
  // The caret in a written line: after it, a line to go on.
  assert.deepEqual(pickGradeInsertIndex([p(), p(), signature], 0), { index: 1, withLine: true })
  // In an empty line: before it, the caret staying there.
  assert.deepEqual(pickGradeInsertIndex([p(), p(true), signature], 1), { index: 1, withLine: false })
  // In the quote (or past the signature): under the text instead.
  assert.deepEqual(pickGradeInsertIndex(reply, 4), { index: 2, withLine: false })
  assert.deepEqual(pickGradeInsertIndex([p(), signature, p()], 2), { index: 1, withLine: false })
  assert.deepEqual(pickGradeInsertIndex([], 0), { index: 0, withLine: false })
})

test('a grade\'s blocks: its summary box, then its image, the box alone past the cap', () => {
  const module = report.resources.find((entry) => entry.code === 'R5.11')
  const graded = module.evaluations.find((entry) => entry.grade.kind === 'number')
  const rows = buildGradeSummaryRows(module, graded, { showPromoStats: true })
  const image = { cid: 'tafac-img-0123abcd@tafac.fr', width: 400, height: 260 }
  const { nodes, capped } = buildGradeInsertion({ module, evaluation: graded, showPromoStats: true, image, imagesInText: 1 })
  assert.equal(capped, false)
  assert.deepEqual(nodes[0], { type: 'mailSummary', attrs: { rows } })
  assert.equal(nodes[1].type, 'mailInlineImage')
  assert.equal(nodes[1].attrs.cid, image.cid)
  assert.equal(nodes[1].attrs.width, 400)
  assert.match(nodes[1].attrs.alt, /R5\.11/)

  const full = buildGradeInsertion({ module, evaluation: graded, image, imagesInText: MAX_INLINE_IMAGES })
  assert.equal(full.capped, true)
  assert.deepEqual(full.nodes.map((node) => node.type), ['mailSummary'])
  // No image drawn: the box alone, not capped.
  const without = buildGradeInsertion({ module, evaluation: graded, image: null })
  assert.equal(without.capped, false)
  assert.deepEqual(without.nodes.map((node) => node.type), ['mailSummary'])
})

test('a grade fills the subject and À only when they are empty', () => {
  const module = { code: 'R5.11', title: 'Qualité' }
  const graded = { description: 'Partiel' }
  const teacher = { name: 'Claire Rivoal', email: 'claire.rivoal@univ.fr' }
  assert.deepEqual(gradeAttachFields({ subject: '', to: [], toInput: '' }, { module, evaluation: graded, teacher }), { subject: 'Note de R5.11 – Partiel', to: [teacher] })
  assert.deepEqual(gradeAttachFields({ subject: '  ', to: [] }, { module, evaluation: graded }), { subject: 'Note de R5.11 – Partiel', to: null })
  // What the student wrote stays.
  assert.deepEqual(gradeAttachFields({ subject: 'Question', to: [{ email: 'x@y.fr' }] }, { module, evaluation: graded, teacher }), { subject: null, to: null })
  assert.deepEqual(gradeAttachFields({ subject: '', to: [], toInput: 'jean' }, { module, evaluation: graded, teacher }).to, null)
})
