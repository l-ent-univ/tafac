import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoGradesPayload, buildDemoSemesterGradesPayload } from '../src/demoAccount.js'
import {
  buildAbsenceReport,
  buildGradesReport,
  canDownloadReportPdf,
  computeAverageHistory,
  computeGeneralAverage,
  computeIndicativeAverage,
  computeUeAverages,
  describeGrade,
  describeUeValidation,
  evaluationTypeLabel,
  findNewGrades,
  formatGrade,
  formatHour,
  hasJuryDecision,
  htmlToPlainText,
  listGradeSignatures,
  listGradesSemesters,
  projectAverages,
  summarizeAverage,
} from '../src/gradesReport.js'

test('describeGrade reads numbers and ScoDoc codes', () => {
  assert.deepEqual(describeGrade('15.50'), { kind: 'number', value: 15.5, label: '15,5' })
  assert.equal(describeGrade('12,25').value, 12.25)
  assert.equal(describeGrade('~').kind, 'pending')
  assert.equal(describeGrade('ABS').kind, 'absent')
  assert.equal(describeGrade('abs').kind, 'absent')
  assert.equal(describeGrade('EXC').kind, 'excused')
  assert.equal(describeGrade('').kind, 'none')
  assert.equal(describeGrade(null).kind, 'none')
  assert.deepEqual(describeGrade('DEF'), { kind: 'other', value: null, label: 'DEF' })
})

test('formatGrade uses a decimal comma and drops trailing zeros', () => {
  assert.equal(formatGrade('14.00'), '14')
  assert.equal(formatGrade(12.333), '12,33')
  assert.equal(formatGrade('n/a'), '—')
})

test('the indicative module average counts an unjustified absence as 0, skips excused and pending grades', () => {
  const evaluation = (value, coef) => ({ type: 0, grade: describeGrade(value), coef })
  assert.equal(computeIndicativeAverage([evaluation('10', 1), evaluation('16', 2)]), 14)
  assert.equal(computeIndicativeAverage([evaluation('10', 1), evaluation('ABS', 1)]), 5)
  assert.equal(computeIndicativeAverage([evaluation('10', 1), evaluation('EXC', 1), evaluation('ATT', 1), evaluation('~', 3)]), 10)
  assert.equal(computeIndicativeAverage([evaluation('~', 1)]), null)
  // No coefficient (null) weighs 1, as in ScoDoc's averages.
  assert.equal(computeIndicativeAverage([evaluation('10', null), evaluation('16', 2)]), 14)
})

test('a rattrapage replaces the indicative average when better, a session 2 always', () => {
  const evaluation = (value, coef, type = 0) => ({ type, grade: describeGrade(value), coef })
  // Normal: (10 + 0) / 2 = 5; the rattrapage's 13.5 is better.
  assert.equal(computeIndicativeAverage([evaluation('10', 1), evaluation('ABS', 1), evaluation('13.5', null, 1)]), 13.5)
  // A worse rattrapage, or one without a grade yet, changes nothing.
  assert.equal(computeIndicativeAverage([evaluation('12', 1), evaluation('8', null, 1)]), 12)
  assert.equal(computeIndicativeAverage([evaluation('12', 1), evaluation('~', null, 1)]), 12)
  // Nothing to replace: a rattrapage alone isn't an average (ScoDoc).
  assert.equal(computeIndicativeAverage([evaluation('~', 1), evaluation('15', null, 1)]), null)
  // Several rattrapages: their mean.
  assert.equal(computeIndicativeAverage([evaluation('6', 1), evaluation('12', 1, 1), evaluation('16', 1, 1)]), 14)
  // Session 2 replaces, even when lower; an absence there counts 0.
  assert.equal(computeIndicativeAverage([evaluation('12', 1), evaluation('9', null, 2)]), 9)
  assert.equal(computeIndicativeAverage([evaluation('12', 1), evaluation('ABS', null, 2)]), 0)
  // A session 2 module ignores its rattrapages; without a session 2 grade
  // yet, the first session stands.
  assert.equal(computeIndicativeAverage([evaluation('8', 1), evaluation('18', 1, 1), evaluation('~', 1, 2)]), 8)
  // Bonus evaluations stay out.
  assert.equal(computeIndicativeAverage([evaluation('12', 1), evaluation('20', 1, 3)]), 12)
})

test('evaluation types carry their label, a normal one none', () => {
  assert.deepEqual([0, 1, 2, 3, null, '1'].map(evaluationTypeLabel), [null, 'Rattrapage', 'Session 2', 'Bonus', null, 'Rattrapage'])
  // The demo's rattrapage reaches "Dernières notes" with its label.
  const report = buildGradesReport(buildDemoGradesPayload()['relevé'])
  const rattrapage = report.latest.find((evaluation) => evaluation.id === '70123')
  assert.equal(rattrapage.typeLabel, 'Rattrapage')
  // R5.02: (ABS + 12.75) / 2 = 6.375, replaced by the rattrapage's 13.5.
  assert.equal(report.resources.find((module) => module.code === 'R5.02').average, 13.5)
})

test('listGradesSemesters puts the newest semester first', () => {
  const semesters = listGradesSemesters(buildDemoGradesPayload().semestres)
  assert.deepEqual(semesters.map((semester) => semester.id), ['9105', '9104', '9103', '9102', '9101'])
  assert.deepEqual(semesters[0], { id: '9105', number: 5, title: 'BUT Info-Com', year: '2026/2027' })
})

test('buildGradesReport reads the semester, UEs and modules of a BUT relevé', () => {
  const payload = buildDemoGradesPayload()
  // The demo hides its ranks: shown here, as a department may.
  const releve = { ...payload['relevé'], options: { ...payload['relevé'].options, show_rangs: true, show_ue_rangs: true } }
  const report = buildGradesReport(releve, { config: payload.config })

  assert.equal(report.status, 'ok')
  assert.equal(report.department, 'INFOCOM')
  assert.equal(report.semester.number, 5)
  assert.deepEqual(report.semester.groups, ['TD B', 'TP 3', 'Com-Orga'])
  assert.equal(report.average.value, 14.5)
  assert.equal(report.average.moy, 12.44)
  assert.deepEqual(report.rank, { value: '9', total: 84 })
  assert.deepEqual(report.ects, { earned: 0, total: 30 })

  const ue = report.ues.find((entry) => entry.code === 'UE5.3')
  assert.equal(ue.average.value, 15.29)
  assert.equal(ue.bonus, 0.1)
  assert.equal(ue.color, '#80cb3f')
  assert.deepEqual(ue.modules.map((module) => [module.code, module.coef]), [['R5.11', 4], ['R5.03', 2], ['R5.12', 3], ['SAÉ 5.01', 4]])

  const strategy = report.resources.find((module) => module.code === 'R5.07')
  // (14 × 1 + 17 × 2) / 3
  assert.equal(strategy.average, 16)
  assert.equal(strategy.averageIsIndicative, true)
  assert.deepEqual(strategy.ueCoefs.map((entry) => [entry.ue, entry.coef]), [['UE5.1', 3], ['UE5.2', 2]])
  assert.deepEqual(strategy.evaluations[1].weights, [{ ue: 'UE5.1', weight: 1 }, { ue: 'UE5.2', weight: 1 }])
  assert.deepEqual(strategy.evaluations[1].promo, { min: 8, moy: 13.9, max: 19 })

  const english = report.resources.find((module) => module.code === 'R5.02')
  assert.equal(english.evaluations[2].typeLabel, 'Rattrapage')
  assert.equal(english.evaluations[2].coef, null)

  assert.equal(report.resources.find((module) => module.code === 'R5.04').pendingCount, 1)
  assert.deepEqual(report.latest.slice(0, 3).map((evaluation) => evaluation.description), ['Revue de presse', 'Pitch portfolio', 'Cas pratique : droit à l’image'])
  assert.ok(report.latest.every((evaluation) => evaluation.grade.kind === 'number'))
})

test('buildGradesReport honours ScoDoc display options and publication', () => {
  const releve = buildDemoGradesPayload()['relevé']
  const hidden = buildGradesReport({ ...releve, options: { show_rangs: false, show_ects: false } })
  assert.equal(hidden.rank, null)
  assert.equal(hidden.ects, null)
  assert.ok(hidden.ues.every((ue) => ue.rank === null))

  // The promo stats are in the relevé whatever show_minmax says.
  const noMinmax = buildGradesReport({ ...releve, options: { show_minmax: false, show_moypromo: false } })
  assert.equal(noMinmax.showPromoStats, true)
  const withoutStats = structuredClone(releve)
  for (const section of [withoutStats.ressources, withoutStats.saes]) {
    for (const module of Object.values(section)) {
      for (const evaluation of module.evaluations) evaluation.note = { value: evaluation.note.value }
    }
  }
  assert.equal(buildGradesReport(withoutStats).showPromoStats, false)

  assert.deepEqual(
    buildGradesReport({ publie: false, message: '<b>Relevé</b> bloqué' }),
    { status: 'unpublished', message: 'Relevé bloqué' },
  )
  assert.equal(buildGradesReport({ type: 'DUT' }).status, 'unsupported')
  assert.equal(buildGradesReport(null).status, 'empty')
})

test('appreciations follow the passerelle department list', () => {
  const payload = buildDemoSemesterGradesPayload('9104')
  const releve = payload['relevé']
  assert.deepEqual(buildGradesReport(releve, { config: payload.config }).appreciations, ['Très bon semestre, travail régulier et sérieux.'])
  assert.deepEqual(buildGradesReport(releve, { config: { liste_dep_affichage_appreciations: 'INFO' } }).appreciations, [])
  // An empty list means "everyone", like the PDF and absence lists.
  assert.deepEqual(buildGradesReport(releve, { config: { liste_dep_affichage_appreciations: '' } }).appreciations, ['Très bon semestre, travail régulier et sérieux.'])
})

test('buildAbsenceReport orders absences of one day by start hour', () => {
  const payload = {
    absences: {
      '2026-10-06': [
        { debut: 8, fin: 10, statut: 'absent' },
        { debut: 10, fin: 12, statut: 'absent' },
        { debut: 9.5, fin: 10, statut: 'retard' },
      ],
    },
  }
  const report = buildAbsenceReport(payload, {}, { afficher_absences: true })
  assert.deepEqual(report.entries.map((entry) => entry.start), ['10h00', '9h30', '8h00'])
})

test('buildAbsenceReport lists absences newest first with passerelle totals', () => {
  const payload = buildDemoGradesPayload()
  const report = buildAbsenceReport(payload, payload['relevé'], payload.config)

  assert.equal(report.visible, true)
  assert.deepEqual(report.entries.map((entry) => [entry.date, entry.start, entry.status]), [
    ['2026-10-06', '14h00', 'justified'],
    ['2026-10-06', '10h15', 'late'],
    ['2026-09-29', '13h30', 'justified'],
    ['2026-09-25', '8h15', 'unjustified'],
  ])
  assert.equal(report.entries[0].subject, 'R5.11 – Relations presse')
  assert.equal(report.entries[1].subject, 'R5.02 - Anglais')
  assert.equal(report.entries[0].teacher, 'Thomas Lemoine')
  assert.deepEqual(report.totals, { justified: '4h', unjustified: '2h', late: '1' })

  assert.equal(buildAbsenceReport(payload, payload['relevé'], { ...payload.config, afficher_absences: false }).visible, false)
  assert.equal(buildAbsenceReport(payload, payload['relevé'], { ...payload.config, liste_dep_publi_absences: 'INFO,GEA' }).visible, false)
})

test('buildAbsenceReport prefers ScoDoc totals in the configured unit', () => {
  const payload = {
    absences: {},
    totauxAbsences: { absent: { justifie: { demi: 3 }, non_justifie: { demi: 1 } } },
  }
  const report = buildAbsenceReport(payload, {}, { afficher_absences: true, metrique_absences: 'demi' })
  assert.equal(report.totals.justified, '3 demi-journées')
  assert.equal(report.totals.unjustified, '1 demi-journée')
})

test('PDF download follows the passerelle switches', () => {
  assert.equal(canDownloadReportPdf({ releve_PDF: true, liste_dep_publi_PDF: '' }, 'INFO'), true)
  assert.equal(canDownloadReportPdf({ releve_PDF: true, liste_dep_publi_PDF: 'MMI,GEA' }, 'INFO'), false)
  assert.equal(canDownloadReportPdf({ releve_PDF: false }, 'INFO'), false)
  assert.equal(canDownloadReportPdf(null, 'INFO'), false)
})

test('computeUeAverages follows module coefficients and evaluation weights', () => {
  const releve = {
    ressources: {
      R1: {
        evaluations: [
          { id: 1, evaluation_type: 0, coef: '1', poids: { UE1: 1 }, note: { value: '10' } },
          { id: 2, evaluation_type: 0, coef: '3', poids: { UE1: 1, UE2: 1 }, note: { value: '14' } },
          { id: 3, evaluation_type: 0, coef: '1', poids: { UE1: 1 }, note: { value: '~' } },
          // Below the module's 13 in UE1: changes nothing.
          { id: 4, evaluation_type: 1, coef: null, poids: { UE1: 1 }, note: { value: '9' } },
        ],
      },
    },
    saes: { S1: { evaluations: [{ id: 5, evaluation_type: 0, coef: '1', poids: { UE1: 1 }, note: { value: 'ABS' } }] } },
    ues: {
      UE1: { ressources: { R1: { coef: 1 } }, saes: { S1: { coef: 1 } } },
      UE2: { ressources: { R1: { coef: 2 } } },
    },
  }

  // UE1: R1 = (10 + 42) / 4 = 13, S1 = 0 (ABS) → 6.5. UE2: R1 = 14.
  assert.deepEqual(computeUeAverages(releve), { UE1: 6.5, UE2: 14 })
  // The pending evaluation simulated at 18 (R1 = 70 / 5 = 14), the absence
  // replaced by 12 → UE1 = 13.
  assert.deepEqual(computeUeAverages(releve, { 3: 18, 5: 12 }), { UE1: 13, UE2: 14 })
})

test('computeUeAverages applies rattrapages UE by UE and session 2 to all the module’s UEs', () => {
  const evaluation = (id, type, value, poids, coef = '1') => ({ id, evaluation_type: type, coef, poids, note: { value } })
  const ues = {
    UE1: { ressources: { R1: { coef: 1 } } },
    UE2: { ressources: { R1: { coef: 1 } } },
  }
  // Normal: 8 in UE1, (8 + 16) / 2 = 12 in UE2. The rattrapage (11) beats
  // UE1's only.
  const withRattrapage = {
    ues,
    ressources: { R1: { evaluations: [
      evaluation(1, 0, '8', { UE1: 1, UE2: 1 }),
      evaluation(2, 0, '16', { UE2: 1 }),
      evaluation(3, 1, '11', { UE1: 1, UE2: 1 }, null),
    ] } },
  }
  assert.deepEqual(computeUeAverages(withRattrapage), { UE1: 11, UE2: 12 })
  // A simulated grade plays against the rattrapage too: 16 beats it.
  assert.deepEqual(computeUeAverages(withRattrapage, { 1: 16 }), { UE1: 16, UE2: 16 })

  // Session 2 replaces in every UE, rattrapage ignored…
  const withSession2 = {
    ues,
    ressources: { R1: { evaluations: [
      evaluation(1, 0, '8', { UE1: 1, UE2: 1 }),
      evaluation(3, 1, '18', { UE1: 1, UE2: 1 }),
      evaluation(4, 2, 'ABS', { UE1: 1, UE2: 1 }),
      evaluation(5, 2, '10', { UE1: 1, UE2: 1 }),
    ] } },
  }
  assert.deepEqual(computeUeAverages(withSession2), { UE1: 5, UE2: 5 })
  // …but only when it has a grade for each UE of the module: weighing
  // toward UE1 alone, it's the first session everywhere.
  const partial = structuredClone(withSession2)
  partial.ressources.R1.evaluations = [evaluation(1, 0, '8', { UE1: 1, UE2: 1 }), evaluation(4, 2, '12', { UE1: 1 })]
  assert.deepEqual(computeUeAverages(partial), { UE1: 8, UE2: 8 })
})

test('a UE is validated by its average, a capitalisation, or the jury’s ECTS and codes', () => {
  const ue = (average, extra = {}) => ({ average: { value: average }, ects: { earned: 0, total: 6 }, decision: null, capitalized: false, ...extra })
  const read = (entry) => describeUeValidation(entry)
  assert.deepEqual(read(ue(12)), { state: 'validated', validatedBy: 'average' })
  assert.deepEqual(read(ue(10)), { state: 'validated', validatedBy: 'average' })
  assert.deepEqual(read(ue(8.7)), { state: 'below', validatedBy: null })
  assert.deepEqual(read(ue(null)), { state: 'pending', validatedBy: null })
  assert.deepEqual(read(ue(7, { capitalized: true })), { state: 'validated', validatedBy: 'capitalization' })
  // Under 10 with its ECTS awarded: compensated, before any code is read.
  assert.deepEqual(read(ue(8.7, { ects: { earned: 6, total: 6 } })), { state: 'validated', validatedBy: 'compensation' })
  assert.deepEqual(read(ue(8.7, { ects: { earned: 3, total: 6 } })).state, 'below')
  // The jury's code wins over the ECTS when there is one.
  assert.deepEqual(read(ue(8.7, { decision: 'CMP' })), { state: 'validated', validatedBy: 'compensation' })
  for (const code of ['ADJ', 'ADJR', 'ADSUP']) assert.deepEqual(read(ue(8.7, { decision: code })), { state: 'validated', validatedBy: 'jury' })
  for (const code of ['AJ', 'RAT', 'ATJ', 'DEF']) assert.equal(read(ue(8.7, { decision: code, ects: { earned: 6, total: 6 } })).state, 'below')
  // A bonus-only UE (no ECTS) isn't "awarded" by 0 / 0.
  assert.equal(read(ue(8, { ects: { earned: 0, total: 0 } })).state, 'below')
})

test('buildGradesReport reads the jury’s UE codes and ScoDoc’s capitalised UEs', () => {
  const releve = {
    type: 'BUT',
    semestre: { decision_ue: [{ ue_id: 11, acronyme: 'UE1.1', code: 'adm' }, { ue_id: 99, acronyme: 'UE1.3', code: 'CMP' }] },
    ues: {
      'UE1.1': { id: 11, moyenne: { value: '12' } },
      'UE1.2': { id: 12, moyenne: { value: '7' } },
      'UE1.3': { id: 13, moyenne: { value: '8.7' } },
    },
    ues_capitalisees: { 'UE1.2': { moyenne: '12.40' } },
  }
  const ues = buildGradesReport(releve).ues
  assert.deepEqual(ues.map((ue) => [ue.code, ue.decision, ue.capitalized]), [['UE1.1', 'ADM', false], ['UE1.2', null, true], ['UE1.3', 'CMP', false]])
  assert.deepEqual(ues.map((ue) => describeUeValidation(ue).validatedBy), ['average', 'capitalization', 'compensation'])
})

test('projectAverages shifts the official averages by the simulated change', () => {
  const releve = buildDemoGradesPayload()['relevé']
  const unchanged = projectAverages(releve, {})
  assert.equal(unchanged.ues['UE5.1'].projected, 14.44)
  assert.equal(unchanged.general.projected, 14.5)

  // Soutenance de cadrage (R5.04, UE5.1 only) at 20.
  const projection = projectAverages(releve, { 70142: 20 })
  assert.ok(projection.ues['UE5.1'].projected > 14.44)
  assert.equal(projection.ues['UE5.2'].projected, 13.76)
  assert.equal(projection.ues['UE5.3'].projected, 15.29)
  assert.ok(projection.general.projected > 14.5)
})

test('computeAverageHistory follows the average day by day and ends on the card’s value', () => {
  const releve = buildDemoGradesPayload()['relevé']
  const history = computeAverageHistory(releve, 14.5)

  // 15 Sept. only holds an absence in one UE of three: too thin to start on.
  assert.equal(history[0].date, '2026-09-17')
  assert.equal(history.at(-1).date, '2026-10-14')
  assert.equal(history.at(-1).average, 14.5)
  assert.ok(history.every((point, i) => i === 0 || point.date > history[i - 1].date))

  // A single grading day: nothing to draw.
  const oneDay = { ...releve, ressources: { R: { evaluations: [releve.ressources['R5.07'].evaluations[0]] } }, saes: {} }
  assert.deepEqual(computeAverageHistory(oneDay, 14), [])
})

test('an average is final once the jury has ruled on the semester or its BUT year', () => {
  assert.equal(summarizeAverage(buildDemoGradesPayload()['relevé']).final, false)
  // ScoDoc leaves a BUT semester's own code empty and puts the year's decision.
  assert.equal(summarizeAverage(buildDemoSemesterGradesPayload('9104')['relevé']).final, true)

  assert.equal(hasJuryDecision({ semestre: { decision: { code: '', etat: 'I' }, decision_annee: null } }), false)
  assert.equal(hasJuryDecision({ semestre: { decision: { code: 'ADM' } } }), true)
  assert.equal(hasJuryDecision({ semestre: { decision: { code: '' }, decision_annee: { code: 'ADM' } } }), true)
})

test('summarizeAverage shows nothing before the first grade, whatever ScoDoc sends', () => {
  const releve = buildDemoGradesPayload()['relevé']
  assert.equal(summarizeAverage(releve).average, 14.5)

  // ScoDoc still sends a semester average, but no evaluation has a grade.
  const ungraded = structuredClone(releve)
  for (const sectionKey of ['ressources', 'saes']) {
    for (const module of Object.values(ungraded[sectionKey])) {
      for (const evaluation of module.evaluations) evaluation.note = { ...evaluation.note, value: '~' }
    }
  }
  assert.equal(ungraded.semestre.notes.value, releve.semestre.notes.value)
  assert.equal(summarizeAverage(ungraded), null)
})

test('computeGeneralAverage uses ScoDoc’s average, else the UEs weighted by ECTS', () => {
  const official = computeGeneralAverage(buildDemoGradesPayload()['relevé'])
  assert.equal(official.source, 'semestre.notes')
  assert.equal(official.average, 14.5)
  assert.equal(official.promoAverage, 12.44)
  // show_moypromo only hides it from the passerelle's page.
  const hiddenPromo = computeGeneralAverage({ ...buildDemoGradesPayload()['relevé'], options: { show_moypromo: false } })
  assert.equal(hiddenPromo.promoAverage, 12.44)

  // A department that blocks the general average and the promo one: ScoDoc
  // sends "~" (and a placeholder promo average), the UE averages stay.
  const blocked = computeGeneralAverage({
    options: { block_moyenne_generale: true, show_moypromo: false },
    semestre: { notes: { value: '~', min: '12.78', moy: '12.78', max: '12.78' } },
    ues: {
      'UE 1': { moyenne: { value: '13.50', moy: '11.00' }, ECTS: { total: 4 } },
      'UE 2': { moyenne: { value: '12.00', moy: '12.50' }, ECTS: { total: 4 } },
      'UE 3': { moyenne: { value: '~', moy: '10.00' }, ECTS: { total: 8 } },
      'UE 4': { moyenne: { value: '15.00', moy: '13.00' }, ECTS: { total: 6 } },
    },
  })
  assert.equal(blocked.source, 'ues-ects')
  assert.deepEqual(computeAverageHistory({ ues: {} }), [])
  // (13.5 × 4 + 12 × 4 + 15 × 6) / 14; UE 3 has no average yet.
  assert.equal(blocked.average, 192 / 14)
  // The promo's, over the same UEs: (11 × 4 + 12.5 × 4 + 13 × 6) / 14.
  assert.equal(blocked.promoAverage, 172 / 14)

  const noPromoStats = computeGeneralAverage({
    semestre: { notes: { value: '~' } },
    ues: { 'UE 1': { moyenne: { value: '13.50' }, ECTS: { total: 4 } } },
  })
  assert.equal(noPromoStats.promoAverage, null)
})

test('findNewGrades only flags grades unseen in a semester already visited', () => {
  const report = buildGradesReport(buildDemoGradesPayload()['relevé'])
  assert.equal(findNewGrades(report, null).size, 0)

  const seen = listGradeSignatures(report).filter((signature) => !signature.startsWith('70112:'))
  assert.deepEqual([...findNewGrades(report, seen)], ['70112'])
  // A grade that changed counts as new again.
  const changed = listGradeSignatures(report).map((signature) => (signature.startsWith('70101:') ? '70101:9' : signature))
  assert.deepEqual([...findNewGrades(report, changed)], ['70101'])
})

test('formatHour and htmlToPlainText', () => {
  assert.equal(formatHour(13.5), '13h30')
  assert.equal(formatHour(8.25), '8h15')
  assert.equal(
    htmlToPlainText('<p>Jurys le <b>28&nbsp;janvier</b>.<br>Merci&#8239;!</p><script>alert(1)</script>'),
    'Jurys le 28 janvier.\nMerci !',
  )
})
