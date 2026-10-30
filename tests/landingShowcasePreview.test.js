import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEMO_OWN_MAIL_DOMAINS,
  buildGradeMailPreview,
  buildGradesPreview,
  buildMailPreview,
  buildPlanningPreview,
} from '../src/landingShowcasePreview.js'
import { buildGradeMailHtml, describeGradeMailAbout } from '../src/gradeMail.js'

test('« Mes notes »: the demo relevé and its latest grades, newest first', () => {
  const grades = buildGradesPreview()
  assert.equal(grades.report.status, 'ok')
  assert.ok(grades.releve && grades.config)
  assert.equal(grades.latest.length, 3)
  const dates = grades.latest.map((grade) => grade.date)
  assert.deepEqual(dates, [...dates].sort().reverse())
})

test('the mail about the latest grade is the one « Écrire au sujet de cette note » writes', () => {
  const grades = buildGradesPreview()
  const mail = buildGradeMailPreview(grades)
  const latest = grades.latest[0]
  assert.match(mail.subject, new RegExp(`^Note de ${latest.moduleCode.replace('.', '\\.')} – `))
  assert.equal(mail.rows[0].label, 'Évaluation')
  assert.ok(mail.rows.some((row) => row.label === 'Note' && /\/20$/.test(row.value)))
  // The relevé's absences name its teacher: the composer's « À ».
  assert.match(mail.to?.email ?? '', /@univ-rennes\.fr$/)
  // The same line the composer's text has.
  assert.ok(buildGradeMailHtml({ title: 'Anglais', code: 'R5.02' }, { description: 'Oral' }, []).html
    .includes(describeGradeMailAbout({ title: 'Anglais', code: 'R5.02' }, { description: 'Oral' })))
})

test('the Planning: upcoming classes of the next days, four at most, each its colour', () => {
  const now = new Date()
  const planning = buildPlanningPreview(now)
  assert.ok(planning.days.length >= 1 && planning.days.length <= 2)
  const classes = planning.days.flatMap((day) => day.classes)
  assert.ok(classes.length >= 1 && classes.length <= 4)
  for (const { event, accent } of classes) {
    assert.ok(event.end > now.getTime())
    assert.ok(Number.isInteger(accent))
  }
  for (const day of planning.days) {
    assert.ok(day.count >= day.classes.length)
    assert.ok(day.classes.every(({ event }) => event.day === day.day))
  }
})

test('the Messagerie: a few mails, the one from outside the university with its domain', () => {
  const mail = buildMailPreview(new Date(2026, 9, 29, 12))
  assert.equal(mail.messages.length, 3)
  const outsiders = mail.messages.filter((message) => message.domainCue)
  assert.equal(outsiders.length, 1)
  assert.equal(outsiders[0].domainCue, '@gmail.com')
  for (const message of mail.messages.filter((entry) => !entry.domainCue)) {
    assert.ok(DEMO_OWN_MAIL_DOMAINS.some((domain) => message.from.email.endsWith(`@${domain}`)))
  }
  assert.ok(mail.composer?.subject)
  // Demo data only: no link anywhere.
  assert.ok(mail.messages.every((message) => message.href === null))
})
