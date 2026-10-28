import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoGradesPayload } from '../src/demoAccount.js'
import { findEvaluation } from '../src/gradeDetail.js'
import {
  buildGradeMailHtml,
  buildGradeMailSubject,
  buildGradeSummaryRows,
  describeMailGrade,
  findModuleTeacher,
  gradeImageAlt,
} from '../src/gradeMail.js'
import { buildGradesReport } from '../src/gradesReport.js'
import { draftInlineImageItems, inlineImageCids, inlineImageReferences, isInlineImageHref } from '../src/mailInlineImages.js'
import { buildComposePayload } from '../src/mailSendPayload.js'
import { composerHtmlToText, normalizeComposePayload } from '../server/mailSend.js'

const payload = buildDemoGradesPayload()
const report = buildGradesReport(payload['relevé'], { config: payload.config })
const module = report.resources.find((entry) => entry.code === 'R5.11')
const evaluation = module.evaluations.find((entry) => entry.grade.kind === 'number')

test('a grade\'s mail: its subject, short', () => {
  assert.equal(buildGradeMailSubject(module, evaluation), `Note de R5.11 – ${evaluation.description}`)
  assert.equal(buildGradeMailSubject({ code: 'R1.01' }, { description: 'x'.repeat(200) }).length, 'Note de R1.01 – '.length + 90)
  assert.match(buildGradeMailSubject({ code: 'R1.01' }, { description: 'x'.repeat(200) }), /…$/)
  assert.equal(buildGradeMailSubject({ code: '' }, { description: 'Partiel' }), 'Note – Partiel')
})

test('a grade\'s summary: what « Mes notes » shows of it, in French', () => {
  const grade = { description: 'Contrôle TP1', typeLabel: 'Rattrapage', coef: 1.5, date: '2026-10-14T08:00:00+02:00', grade: { kind: 'number', value: 15.5 }, promo: { min: 4, moy: 12.25, max: 19.5 } }
  const subject = { code: 'R5.01', title: 'Développement web', kind: 'resource' }
  assert.deepEqual(buildGradeSummaryRows(subject, grade, { showPromoStats: true }), [
    { label: 'Évaluation', value: 'Contrôle TP1 (Rattrapage)' },
    { label: 'Ressource', value: 'R5.01 – Développement web' },
    { label: 'Note', value: '15,5/20' },
    { label: 'Coefficient', value: '1,5' },
    { label: 'Date', value: '14 octobre 2026' },
    { label: 'Moyenne promo', value: '12,25/20' },
    { label: 'Min. promo', value: '4/20' },
    { label: 'Max. promo', value: '19,5/20' },
  ])
  // Without the promo's stats, none; an SAÉ's code says what it is; a
  // grade not given, its label.
  const rows = buildGradeSummaryRows({ code: 'SAÉ 5.01', title: 'Prototype', kind: 'sae' }, { ...grade, typeLabel: null, coef: null, date: null, grade: { kind: 'absent', label: 'Absent' } })
  assert.deepEqual(rows, [
    { label: 'Évaluation', value: 'Contrôle TP1' },
    { label: 'Matière', value: 'SAÉ 5.01 – Prototype' },
    { label: 'Note', value: 'Absent' },
  ])
  assert.equal(describeMailGrade({ kind: 'number', value: 16.666 }), '16,67/20')
})

test('a grade\'s mail: the editor\'s HTML, escaped, the caret\'s line, the summary and the image', () => {
  const rows = [{ label: 'Note', value: '<b>15</b>/20' }]
  const image = { cid: 'tafac-img-0123abcd-4567@tafac.fr', alt: 'Note de "TP"', width: 520, height: 300 }
  const { html, focusBlock } = buildGradeMailHtml({ code: 'R5.01', title: 'Web & co' }, { description: 'TP <1>' }, rows, image)
  assert.equal(html, [
    '<p>Bonjour,</p><p></p>',
    '<p>Je vous écris au sujet de ma note de TP &lt;1&gt; en Web &amp; co.</p>',
    '<p></p><p></p>',
    '<table data-mail-summary=""><tbody><tr><th>Note</th><td>&lt;b&gt;15&lt;/b&gt;/20</td></tr></tbody></table>',
    '<img data-inline-cid="tafac-img-0123abcd-4567@tafac.fr" alt="Note de &quot;TP&quot;" width="520" height="300">',
  ].join(''))
  assert.equal(focusBlock, 3)
  assert.equal(inlineImageCids(html).length, 1)
  // Without an image: the rest as it is.
  assert.doesNotMatch(buildGradeMailHtml({ code: 'R5.01', title: 'Web' }, { description: 'TP' }, rows).html, /<img/)
  assert.equal(gradeImageAlt(module, evaluation), `Note de ${evaluation.description} (R5.11)`)
})

test('the mail\'s text version: the summary as lines, the image as its alt', () => {
  const rows = buildGradeSummaryRows({ code: 'R5.01', title: 'Web', kind: 'resource' }, { description: 'TP', coef: 2, grade: { kind: 'number', value: 12 }, promo: {} })
  const image = { cid: 'tafac-img-0123abcd-4567@tafac.fr', alt: 'Note de TP (R5.01)', width: 520, height: 300 }
  const { html } = buildGradeMailHtml({ code: 'R5.01', title: 'Web' }, { description: 'TP' }, rows, image)
  const parsed = normalizeComposePayload(
    { to: [{ email: 'prof@univ.fr' }], html: `${html}<div data-mail-signature=""></div>`, sendUid: 'uid-00000001', inlineImages: [{ cid: image.cid, source: 'upload', aid: 'aid-1', width: 520, height: 300 }] },
    { isValidMessageId: () => true, isValidUploadId: () => true },
  )
  assert.equal(composerHtmlToText(parsed.value.html, { signatureText: '-- \nCamille' }), [
    'Bonjour,',
    '',
    'Je vous écris au sujet de ma note de TP en Web.',
    '',
    'Évaluation : TP',
    'Ressource : R5.01 – Web',
    'Note : 12/20',
    'Coefficient : 2',
    '',
    '[Image : Note de TP (R5.01)]',
    '',
    '-- ',
    'Camille',
  ].join('\n'))
})

test('the subject\'s teacher: one valid address named for it, never a guess', () => {
  // The demo's R5.11: two absences, one teacher (by the module's id).
  assert.deepEqual(findModuleTeacher(payload.absences, module), { name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr' })
  // By its label (« R5.02 - Anglais »).
  assert.deepEqual(findModuleTeacher(payload.absences, report.resources.find((entry) => entry.code === 'R5.02')), { name: 'Julie Morvan', email: 'julie.morvan@univ-rennes.fr' })
  // A subject with no absence: no one.
  assert.equal(findModuleTeacher(payload.absences, report.resources.find((entry) => entry.code === 'R5.03')), null)
  const subject = { id: '7', code: 'R1.01' }
  const absences = (...list) => ({ '2026-10-01': list })
  // Two teachers: who graded it? No one.
  assert.equal(findModuleTeacher(absences({ matiereComplet: 7, enseignant: 'a.b@univ.fr' }, { matiereComplet: 7, enseignant: 'c.d@univ.fr' }), subject), null)
  // The same one twice (case aside): them.
  assert.equal(findModuleTeacher(absences({ matiereComplet: 7, enseignant: 'a.b@univ.fr' }, { matiereComplet: '7', enseignant: 'A.B@univ.fr' }), subject).email, 'a.b@univ.fr')
  // Not an address (a name, an injected header), another subject's, nothing: no one.
  assert.equal(findModuleTeacher(absences({ matiereComplet: 7, enseignant: 'Jean Dupont' }), subject), null)
  assert.equal(findModuleTeacher(absences({ matiereComplet: 7, enseignant: 'a@b.fr\r\nBcc: x@y.fr' }), subject), null)
  assert.equal(findModuleTeacher(absences({ matiereComplet: 8, enseignant: 'a.b@univ.fr' }), subject), null)
  assert.equal(findModuleTeacher(absences({ matiereComplet: 'R1.011 - Autre', enseignant: 'a.b@univ.fr' }), subject), null)
  assert.equal(findModuleTeacher(absences({ matiereComplet: 'R1.01 - Init', enseignant: 'a.b@univ.fr' }), subject).email, 'a.b@univ.fr')
  assert.equal(findModuleTeacher(null, subject), null)
  assert.equal(findModuleTeacher({ x: 'pas une liste' }, subject), null)
})

test('the demo report has the grade the mail is written from', () => {
  assert.ok(findEvaluation(report, 'R5.11', evaluation.id))
})

test('the text\'s images as a send names them: shown, ready, a saved draft\'s part', () => {
  const cid = 'tafac-img-0123abcd-4567@tafac.fr'
  const other = 'tafac-img-89abcdef-0123@tafac.fr'
  const html = `<p>x</p><img data-inline-cid="${cid}" width="520" height="300">`
  const items = [
    { key: `inline:${cid}`, cid, source: 'upload', aid: 'aid-1', width: 520, height: 300, status: 'ready' },
    // Not in the text any more (removed): not named.
    { key: `inline:${other}`, cid: other, source: 'upload', aid: 'aid-2', width: 520, height: 300, status: 'ready' },
  ]
  assert.deepEqual(inlineImageReferences(items, html), [{ cid, source: 'upload', aid: 'aid-1', width: 520, height: 300 }])
  // Still uploading: not named (the server drops its <img>).
  assert.deepEqual(inlineImageReferences([{ ...items[0], status: 'uploading' }], html), [])
  // Saved in a draft: its part instead of its upload.
  const state = { to: [], cc: [], bcc: [], subject: '', html, attachments: [], inlineImages: items, signature: {} }
  assert.deepEqual(buildComposePayload(state, { refs: new Map([[`inline:${cid}`, { messageId: '400', part: '2.2' }]]) }).inlineImages, [
    { cid, source: 'message', messageId: '400', part: '2.2', width: 520, height: 300 },
  ])
  // A resumed draft's: its parts, shown from the part proxy or a data: URL only.
  const resumed = draftInlineImageItems({ id: '400', inlineImages: [
    { cid, part: '2.2', name: 'note.png', size: 1000, contentType: 'image/png', width: 520, height: 300, href: '/__ent_auth/mail/part?id=400&part=2.2' },
    { cid: other, part: '2.3', href: 'https://evil.example/x.png' },
    { cid: 'pas-un-cid', part: '2.4' },
  ] })
  assert.deepEqual(resumed.map((item) => [item.cid, item.source, item.messageId, item.part, item.url, item.status]), [
    [cid, 'message', '400', '2.2', '/__ent_auth/mail/part?id=400&part=2.2', 'ready'],
    [other, 'message', '400', '2.3', null, 'ready'],
  ])
  assert.equal(isInlineImageHref('data:image/svg+xml;base64,AAAA'), false)
  assert.equal(isInlineImageHref('blob:https://tafac.fr/1'), false)
})
