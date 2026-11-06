import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoGradesPayload } from '../src/demoAccount.js'
import { buildAbsenceReport, buildGradesReport, summarizeAbsencesBySubject } from '../src/gradesReport.js'
import {
  absenceStart,
  buildSemesterTimeline,
  countAbsencesByStatus,
  findEvaluationsDuringAbsences,
  formatTimeLeft,
  groupAbsencesByMonth,
  listOpenJustifications,
  readJustificationWindow,
  sumAbsenceHours,
} from '../src/assiduity.js'
import {
  absenceTeacher,
  buildAbsenceSummaryRows,
  buildJustificationHtml,
  buildJustificationLines,
  buildJustificationSubject,
  describeJustification,
  listAbsenceReasons,
  prepareJustificationMail,
} from '../src/absenceMail.js'

function demoReport() {
  const payload = buildDemoGradesPayload()
  return { payload, report: buildAbsenceReport(payload, payload['relevé'], payload.config) }
}

test('absence entries carry their hours, module and teacher address', () => {
  const { report } = demoReport()
  const [justified, late, , unjustified] = report.entries
  assert.equal(justified.moduleCode, 'R5.11')
  assert.equal(justified.subjectTitle, 'Relations presse')
  assert.equal(justified.hours, 2)
  assert.equal(justified.teacherEmail, 'thomas.lemoine@univ-rennes.fr')
  // Named « R5.02 - Anglais » by the passerelle: found in the relevé.
  assert.equal(late.moduleCode, 'R5.02')
  assert.equal(late.subjectTitle, 'Anglais')
  assert.equal(late.hours, 0)
  assert.equal(unjustified.startHours, 8.25)
  assert.equal(unjustified.endHours, 10.25)
})

test('a subject the relevé lacks keeps the passerelle name, without its code', () => {
  const report = buildAbsenceReport({ absences: { '2026-10-06': [{ debut: 8, fin: 10, statut: 'absent', matiereComplet: 'R9.99 - Latin', enseignant: 'pas une adresse' }] } }, {}, { afficher_absences: true })
  assert.equal(report.entries[0].moduleCode, null)
  assert.equal(report.entries[0].subjectTitle, 'Latin')
  assert.equal(report.entries[0].teacherEmail, null)
})

test('an absence the passerelle ties to no subject (« Non défini ») has none, and its mail names none', () => {
  for (const placeholder of ['Non défini', 'non definie', 'Non renseigné', 'Aucune', '-']) {
    const report = buildAbsenceReport({ absences: { '2026-10-06': [{ debut: 8, fin: 10, statut: 'absent', matiereComplet: placeholder }] } }, {}, { afficher_absences: true })
    assert.equal(report.entries[0].subject, null, placeholder)
    assert.equal(report.entries[0].subjectTitle, null, placeholder)
  }
  const [entry] = buildAbsenceReport({ absences: { '2026-10-06': [{ debut: 8, fin: 10, statut: 'absent', matiereComplet: 'Non défini' }] } }, {}, { afficher_absences: true }).entries
  assert.equal(describeJustification(entry, 'illness'), 'Je vous prie d’excuser mon absence du mardi 6 octobre, de 8h00 à 10h00, pour raison de santé.')
  assert.equal(buildJustificationSubject(entry), 'Absence du mardi 6 octobre')
  assert.ok(!buildAbsenceSummaryRows(entry).some((row) => row.label === 'Matière'))
})

test('summarizeAbsencesBySubject adds up hours per module, lateness apart', () => {
  const { report } = demoReport()
  assert.deepEqual(summarizeAbsencesBySubject(report.entries).map((subject) => [subject.key, subject.hours, subject.unjustifiedHours, subject.count, subject.late]), [
    ['R5.11', 4, 2, 2, 0],
    ['SAÉ 5.01', 2, 0, 1, 0],
    ['R5.02', 0, 0, 0, 1],
  ])
})

test('counts and sums per status', () => {
  const { report } = demoReport()
  assert.deepEqual(countAbsencesByStatus(report.entries), { all: 4, unjustified: 1, justified: 2, late: 1 })
  assert.deepEqual(sumAbsenceHours(report.entries), { justified: 4, unjustified: 2, late: 1 })
})

test('the justification delay is read from the department notice, never guessed', () => {
  assert.equal(readJustificationWindow("Les causes de l’absence doivent être notifiées par écrit à l'aide d'un justificatif dans les 48 heures à compter du début de l’absence."), 48)
  assert.equal(readJustificationWindow('Tout justificatif est à déposer sous 3 jours.'), 72)
  assert.equal(readJustificationWindow('Justificatif à fournir sous 72h au secrétariat'), 72)
  assert.equal(readJustificationWindow('Les absences sont comptées par demi-journée.'), null)
  assert.equal(readJustificationWindow(null), null)
})

test('open justifications: unjustified only, inside the delay, soonest first', () => {
  const entries = [
    { id: 'a', date: '2026-11-02', startHours: 8.25, status: 'unjustified' },
    { id: 'b', date: '2026-11-03', startHours: 10, status: 'unjustified' },
    { id: 'c', date: '2026-11-03', startHours: 8, status: 'justified' },
    { id: 'd', date: '2026-10-20', startHours: 8, status: 'unjustified' },
  ]
  const now = new Date(2026, 10, 3, 12, 0)
  const open = listOpenJustifications(entries, 48, now)
  assert.deepEqual(open.map((item) => item.entry.id), ['a', 'b'])
  assert.equal(Math.round(open[0].hoursLeft * 4) / 4, 20.25)
  assert.equal(open[0].deadline.getHours(), 8)
  assert.equal(open[0].deadline.getMinutes(), 15)
  assert.ok(open[1].share > open[0].share)
  assert.deepEqual(listOpenJustifications(entries, null, now), [])
  assert.equal(absenceStart({ date: '2026-11-02', startHours: 13.5 }).getHours(), 13)
})

test('formatTimeLeft', () => {
  assert.equal(formatTimeLeft(31.7), 'Reste 31 h')
  assert.equal(formatTimeLeft(0.4), 'Reste 24 min')
  assert.equal(formatTimeLeft(-1), null)
})

test('the semester line places months, marks (stacked per day) and today', () => {
  const entries = [
    { id: 'x', date: '2026-10-06', startHours: 14, status: 'justified' },
    { id: 'y', date: '2026-10-06', startHours: 10.25, status: 'late' },
    { id: 'z', date: '2026-09-25', startHours: 8.25, status: 'unjustified' },
  ]
  const line = buildSemesterTimeline({ start: '2026-09-01', end: '2027-01-24', entries, now: new Date(2026, 10, 3, 12) })
  assert.deepEqual(line.months.map((month) => month.label), ['sept', 'oct', 'nov', 'déc', 'janv'])
  assert.equal(line.months[0].position, 0)
  assert.deepEqual(line.marks.map((mark) => [mark.id, mark.stack]), [['z', 0], ['y', 0], ['x', 1]])
  assert.ok(line.marks[0].position < line.marks[1].position)
  assert.ok(line.today > 40 && line.today < 45)
  assert.equal(line.elapsed, line.today)

  const after = buildSemesterTimeline({ start: '2026-09-01', end: '2027-01-24', entries, now: new Date(2027, 2, 1) })
  assert.equal(after.today, null)
  assert.equal(after.elapsed, 100)
  // No semester dates: the absences' span, a week each side.
  const loose = buildSemesterTimeline({ entries, now: new Date(2026, 10, 3) })
  assert.equal(loose.start.getDate(), 18)
  assert.equal(buildSemesterTimeline({ entries: [] }), null)
})

test('the semester line names only the months mostly inside it', () => {
  // Starts on 26 January: no « janv » under « févr ».
  const spring = buildSemesterTimeline({ start: '2027-01-26', end: '2027-06-03', entries: [], now: new Date(2027, 2, 1) })
  assert.deepEqual(spring.months.map((month) => month.label), ['févr', 'mars', 'avr', 'mai'])
  assert.ok(spring.months[0].position > 0)
  // Starts on 12 January: « janv » kept, at the line's start.
  const early = buildSemesterTimeline({ start: '2027-01-12', end: '2027-06-30', entries: [], now: new Date(2027, 2, 1) })
  assert.deepEqual(early.months.map((month) => month.label), ['janv', 'févr', 'mars', 'avr', 'mai', 'juin'])
  assert.equal(early.months[0].position, 0)
  // A span shorter than a month: still one name.
  const short = buildSemesterTimeline({ start: '2027-01-26', end: '2027-02-05', entries: [], now: new Date(2027, 2, 1) })
  assert.deepEqual(short.months.map((month) => month.label), ['janv'])
})

test('evaluations held during an absence, matched by module, day and hours', () => {
  const { payload, report } = demoReport()
  const grades = buildGradesReport(payload['relevé'], { config: payload.config })
  const found = findEvaluationsDuringAbsences(grades, report.entries)
  const justified = report.entries[0]
  assert.deepEqual(Object.keys(found), [justified.id])
  assert.equal(found[justified.id][0].description, 'Quiz paysage médiatique')
  assert.equal(found[justified.id][0].grade.kind, 'excused')
  // Outside the absence's hours: not it.
  assert.deepEqual(findEvaluationsDuringAbsences(grades, [{ ...justified, startHours: 8, endHours: 10 }]), {})
})

test('groupAbsencesByMonth keeps the order given', () => {
  const { report } = demoReport()
  assert.deepEqual(groupAbsencesByMonth(report.entries).map((group) => [group.label, group.entries.length]), [['Octobre 2026', 2], ['Septembre 2026', 2]])
})

test('the justification mail says the absence, its reason and the justificatif', () => {
  const { report } = demoReport()
  const late = report.entries[1]
  const unjustified = report.entries[3]
  assert.equal(describeJustification(unjustified, 'illness'), 'Je vous prie d’excuser mon absence du vendredi 25 septembre, de 8h15 à 10h15, en Relations presse, pour raison de santé.')
  assert.equal(describeJustification(late, 'transport'), 'Je vous prie d’excuser mon retard du mardi 6 octobre, de 10h15 à 10h30, en Anglais, en raison d’un problème de transport.')
  // « Autre raison »: no phrase, the student's words instead.
  assert.deepEqual(buildJustificationLines(unjustified, { reason: 'other', details: '  Panne de réveil  ', proof: 'later' }), [
    'Bonjour,',
    'Je vous prie d’excuser mon absence du vendredi 25 septembre, de 8h15 à 10h15, en Relations presse.',
    'Panne de réveil',
    'Je vous ferai parvenir mon justificatif dès que possible.',
  ])
  assert.equal(buildJustificationLines(unjustified, { reason: 'illness', proof: 'none' }).length, 2)
  assert.equal(buildJustificationSubject(unjustified, { proof: 'attached' }), 'Justificatif d’absence du vendredi 25 septembre – Relations presse')
  assert.equal(buildJustificationSubject(late, { proof: 'later' }), 'Retard du mardi 6 octobre – Anglais')
  assert.deepEqual(buildAbsenceSummaryRows(unjustified), [
    { label: 'Matière', value: 'R5.11 – Relations presse' },
    { label: 'Date', value: 'Vendredi 25 septembre 2026' },
    { label: 'Horaire', value: '8h15 – 10h15 (2h)' },
    { label: 'Enseignant', value: 'Thomas Lemoine' },
  ])
  // « Manifestation » only where the establishment lists it, before « Autre raison ».
  assert.ok(!listAbsenceReasons(unjustified).some((reason) => reason.id === 'protest'))
  assert.deepEqual(listAbsenceReasons(unjustified, ['protest']).slice(-2).map((reason) => reason.id), ['protest', 'other'])
  assert.ok(listAbsenceReasons(late, ['protest']).some((reason) => reason.id === 'protest'))
  // « Congé menstruel »: listed by the establishment, after the medical
  // appointment; not for a lateness.
  assert.deepEqual(listAbsenceReasons(unjustified, ['menstrual']).map((reason) => reason.id).slice(1, 3), ['medical', 'menstrual'])
  assert.ok(!listAbsenceReasons(unjustified).some((reason) => reason.id === 'menstrual'))
  assert.ok(!listAbsenceReasons(late, ['menstrual']).some((reason) => reason.id === 'menstrual'))
  assert.equal(describeJustification(unjustified, 'menstrual'), 'Je vous prie d’excuser mon absence du vendredi 25 septembre, de 8h15 à 10h15, en Relations presse, au titre du congé menstruel.')
  assert.equal(describeJustification(unjustified, 'protest'), 'Je vous prie d’excuser mon absence du vendredi 25 septembre, de 8h15 à 10h15, en Relations presse, afin d’exercer mon droit de manifester.')
  // Fewer reasons for a lateness.
  assert.ok(listAbsenceReasons(late).length < listAbsenceReasons(unjustified).length)
  assert.ok(!listAbsenceReasons(late).some((reason) => reason.id === 'illness'))
})

test('the justification mail: caret on the empty line, words escaped, file attached', () => {
  const { report } = demoReport()
  const unjustified = report.entries[3]
  const { html, focusBlock } = buildJustificationHtml(unjustified, { reason: 'other', details: '<b>a</b>', proof: 'attached' })
  assert.match(html, /&lt;b&gt;a&lt;\/b&gt;/)
  // Bonjour, · empty · sentence · words · proof · (empty: the caret's) · box · closing
  const blocks = html.match(/<p>.*?<\/p>|<table[\s\S]*?<\/table>/g)
  assert.equal(blocks[focusBlock], '<p></p>')
  assert.match(blocks[focusBlock + 1], /^<table/)
  assert.equal(blocks.at(-1), '<p>Bien cordialement,</p>')

  const file = { name: 'certificat.jpg' }
  const mail = prepareJustificationMail(unjustified, { reason: 'illness', proof: 'attached', file })
  assert.equal(mail.kind, 'absence')
  // À left for the secretariat, the teacher ScoDoc names in Cc: no lookup.
  assert.deepEqual(mail.to, [])
  assert.deepEqual(mail.cc, [{ name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr' }])
  assert.equal(mail.absenceClass, null)
  assert.deepEqual(mail.attachFiles, [file])
  assert.match(mail.subject, /^Justificatif/)
  // No address from ScoDoc: the class looked up in the planning, for Cc.
  const looked = prepareJustificationMail({ ...unjustified, teacherEmail: null })
  assert.deepEqual(looked.cc, [])
  assert.deepEqual(looked.absenceClass, { day: '2026-09-25', startHours: 8.25, endHours: 10.25, moduleCode: 'R5.11' })
  // The teacher left out: no one in Cc, nothing looked up.
  const without = prepareJustificationMail({ ...unjustified, teacherEmail: null }, { toTeacher: false })
  assert.deepEqual([without.cc, without.absenceClass], [[], null])
  assert.deepEqual(prepareJustificationMail(unjustified, { toTeacher: false }).cc, [])
  // No file after all: nothing claimed attached.
  const noFile = prepareJustificationMail(unjustified, { proof: 'attached', file: null })
  assert.deepEqual(noFile.attachFiles, [])
  assert.doesNotMatch(noFile.html, /pièce jointe/)
  assert.equal(absenceTeacher({ ...unjustified, teacherEmail: 'jdupont' }), null)
})
