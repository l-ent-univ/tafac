import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCourseInsertion,
  buildCourseMailHtml,
  buildCourseMailSubject,
  buildCourseSummaryRows,
  courseAttachSubject,
  courseImageAlt,
  courseKind,
  formatCourseHour,
} from '../src/courseMail.js'
import { MAX_INLINE_IMAGES, inlineImageCids } from '../src/mailInlineImages.js'
import { toPlanningEvent } from '../src/planningEvents.js'
import { composerHtmlToText, normalizeComposePayload } from '../server/mailSend.js'

// Local times, as the Planning reads them (whatever the machine's zone).
const at = (day, hours, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime()

// ADE's shape (the portal's /ade/upcoming), and TEMPO's (no room nor
// teacher, its group as its description).
const ade = toPlanningEvent({ uid: 'ADE-1', title: 'R5.12 Développement back-end', startMs: at(3, 14), endMs: at(3, 16), location: 'A08 - Info 2', teacher: 'M. Lemoine', groupsLabel: 'MMI3 TP1' })
const tempo = toPlanningEvent({ uid: 'tempo-4', title: 'Anglais TD', startMs: at(4, 10, 15), endMs: at(4, 11, 45), location: '', teacher: '', groups: ['L2 INFO-COM'], groupsLabel: 'L2 INFO-COM' })

test('a class\'s mail: its subject, its course and day', () => {
  assert.equal(buildCourseMailSubject(ade), 'R5.12 Développement back-end – mardi 3 novembre')
  assert.equal(buildCourseMailSubject(tempo), 'Anglais TD – mercredi 4 novembre')
  const long = { ...ade, title: 'x'.repeat(200) }
  assert.match(buildCourseMailSubject(long), /^x{79}… – mardi 3 novembre$/)
})

test('a class\'s hour and kind, as a French reader says them', () => {
  assert.equal(formatCourseHour(at(3, 14)), '14 h')
  assert.equal(formatCourseHour(at(3, 8, 5)), '8 h 05')
  assert.equal(formatCourseHour(NaN), '')
  assert.equal(courseKind(tempo), 'TD')
  assert.equal(courseKind({ title: 'CM - Droit public' }), 'CM')
  assert.equal(courseKind({ title: 'TPs Réseaux' }), 'TP')
  assert.equal(courseKind({ title: 'R3.01 TP2 Web' }), 'TP')
  // A word that only holds the letters isn't one.
  assert.equal(courseKind(ade), null)
  assert.equal(courseKind({ title: 'Atelier TDA' }), null)
})

test('a class\'s summary: what the Planning shows, both sources', () => {
  assert.deepEqual(buildCourseSummaryRows(ade), [
    { label: 'Cours', value: 'R5.12 Développement back-end' },
    { label: 'Date', value: 'Mardi 3 novembre 2026' },
    { label: 'Horaire', value: '14:00 – 16:00 (2h00)' },
    { label: 'Salle', value: 'A08 - Info 2' },
    { label: 'Enseignant', value: 'M. Lemoine' },
    { label: 'Groupe', value: 'MMI3 TP1' },
  ])
  // TEMPO's: no room nor teacher, its kind from the title.
  assert.deepEqual(buildCourseSummaryRows(tempo), [
    { label: 'Cours', value: 'Anglais TD' },
    { label: 'Type', value: 'TD' },
    { label: 'Date', value: 'Mercredi 4 novembre 2026' },
    { label: 'Horaire', value: '10:15 – 11:45 (1h30)' },
    { label: 'Groupe', value: 'L2 INFO-COM' },
  ])
  // Several teachers, as ADE joins them.
  const shared = buildCourseSummaryRows({ ...ade, teacher: 'Mme Le Fur - M. Lemoine' })
  assert.deepEqual(shared.find((row) => row.label.startsWith('Enseignant')), { label: 'Enseignants', value: 'Mme Le Fur, M. Lemoine' })
})

test('a class\'s mail text: greeting, the line about it, a line to write on, the box, the image', () => {
  const rows = [{ label: 'Salle', value: '<A08>' }]
  const image = { cid: 'tafac-img-0123abcd-4567@tafac.fr', alt: courseImageAlt(ade), width: 400, height: 220 }
  const { html, focusBlock } = buildCourseMailHtml(ade, rows, image)
  assert.equal(html, [
    '<p>Bonjour,</p><p></p>',
    '<p>Je vous écris au sujet du cours de R5.12 Développement back-end du mardi 3 novembre à 14 h.</p>',
    '<p></p><p></p>',
    '<table data-mail-summary=""><tbody><tr><th>Salle</th><td>&lt;A08&gt;</td></tr></tbody></table>',
    '<img data-inline-cid="tafac-img-0123abcd-4567@tafac.fr" alt="Cours de R5.12 Développement back-end du mardi 3 novembre" width="400" height="220">',
  ].join(''))
  assert.equal(focusBlock, 3)
  assert.equal(inlineImageCids(html).length, 1)
  // « d’ » before a vowel; no image, no <img>.
  const plain = buildCourseMailHtml(tempo, rows).html
  assert.match(plain, /au sujet du cours d’Anglais TD du mercredi 4 novembre à 10 h 15\./)
  assert.doesNotMatch(plain, /<img/)
})

test('a class\'s mail as sent: the box as lines, the image as its alt', () => {
  const rows = buildCourseSummaryRows(ade)
  const image = { cid: 'tafac-img-0123abcd-4567@tafac.fr', alt: courseImageAlt(ade), width: 400, height: 220 }
  const { html } = buildCourseMailHtml(ade, rows, image)
  const parsed = normalizeComposePayload(
    { to: [{ email: 'thomas.lemoine@univ-rennes.fr' }], html: `${html}<div data-mail-signature=""></div>`, sendUid: 'uid-00000001', inlineImages: [{ cid: image.cid, source: 'upload', aid: 'aid-1', width: 400, height: 220 }] },
    { isValidMessageId: () => true, isValidUploadId: () => true },
  )
  assert.equal(composerHtmlToText(parsed.value.html, { signatureText: '-- \nCamille' }), [
    'Bonjour,',
    '',
    'Je vous écris au sujet du cours de R5.12 Développement back-end du mardi 3 novembre à 14 h.',
    '',
    'Cours : R5.12 Développement back-end',
    'Date : Mardi 3 novembre 2026',
    'Horaire : 14:00 – 16:00 (2h00)',
    'Salle : A08 - Info 2',
    'Enseignant : M. Lemoine',
    'Groupe : MMI3 TP1',
    '',
    '[Image : Cours de R5.12 Développement back-end du mardi 3 novembre]',
    '',
    '-- ',
    'Camille',
  ].join('\n'))
})

test('a class picked in « Un cours… »: its box and image, the box alone past the shared cap', () => {
  const image = { cid: 'tafac-img-0123abcd-4567@tafac.fr', width: 400, height: 220 }
  const { nodes, capped } = buildCourseInsertion({ event: ade, image, imagesInText: 0 })
  assert.equal(capped, false)
  assert.deepEqual(nodes.map((node) => node.type), ['mailSummary', 'mailInlineImage'])
  assert.deepEqual(nodes[0].attrs.rows, buildCourseSummaryRows(ade))
  assert.equal(nodes[1].attrs.alt, courseImageAlt(ade))
  // Grades' images count too: three in the text already, the box alone.
  const full = buildCourseInsertion({ event: ade, image, imagesInText: MAX_INLINE_IMAGES })
  assert.equal(full.capped, true)
  assert.deepEqual(full.nodes.map((node) => node.type), ['mailSummary'])
  assert.deepEqual(buildCourseInsertion({ event: ade, image: null }).nodes.map((node) => node.type), ['mailSummary'])
  // The subject only when it's empty.
  assert.equal(courseAttachSubject('', ade), 'R5.12 Développement back-end – mardi 3 novembre')
  assert.equal(courseAttachSubject('  ', ade), 'R5.12 Développement back-end – mardi 3 novembre')
  assert.equal(courseAttachSubject('Absence', ade), null)
})
