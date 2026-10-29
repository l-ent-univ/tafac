import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoGradesPayload } from '../src/demoAccount.js'
import { buildGradesReport } from '../src/gradesReport.js'
import {
  buildUeWash,
  describeSubjectProgress,
  formatScore,
  listSubjectGroups,
  listUeGroups,
  placeInPromo,
  sortEvaluations,
} from '../src/gradesSubjects.js'

function buildDemoReport() {
  const payload = buildDemoGradesPayload()
  return buildGradesReport(payload['relevé'], { config: payload.config })
}

test('subjects come as ressources then SAÉ, each in code order', () => {
  const groups = listSubjectGroups(buildDemoReport())

  assert.deepEqual(groups.map((group) => group.label), ['Ressources', 'SAÉ'])
  assert.deepEqual(groups[0].modules.map((module) => module.code), ['R5.02', 'R5.03', 'R5.04', 'R5.07', 'R5.09', 'R5.11', 'R5.12'])
  assert.deepEqual(groups[1].modules.map((module) => module.code), ['SAÉ 5.01', 'SAÉ 5.02'])
})

test('a group without subjects is left out', () => {
  const groups = listSubjectGroups({ resources: [{ code: 'R1.01' }], saes: [] })
  assert.deepEqual(groups.map((group) => group.kind), ['resource'])
  assert.deepEqual(listSubjectGroups(null), [])
})

test('a subject’s progress counts its grades, absences and pending ones', () => {
  const modules = Object.fromEntries(listSubjectGroups(buildDemoReport())
    .flatMap((group) => group.modules)
    .map((module) => [module.code, module]))

  assert.equal(describeSubjectProgress(modules['R5.02']), '2 notes · 1 absence')
  assert.equal(describeSubjectProgress(modules['R5.04']), '1 note · 1 en attente')
  assert.equal(describeSubjectProgress(modules['R5.09']), 'Aucune évaluation')
  assert.equal(describeSubjectProgress({
    evaluations: [{ grade: { kind: 'excused' } }],
    gradedCount: 0,
    pendingCount: 0,
  }), 'Pas encore de note')
})

test('evaluations run in date order, undated ones last', () => {
  const sorted = sortEvaluations([
    { id: 'b', date: '2026-10-01T08:00:00' },
    { id: 'none-1', date: null },
    { id: 'a', date: '2026-09-15T08:00:00' },
    { id: 'none-2', date: null },
  ])
  assert.deepEqual(sorted.map((evaluation) => evaluation.id), ['a', 'b', 'none-1', 'none-2'])
})

test('a grade is placed in its promo on the 0–20 bar', () => {
  assert.deepEqual(
    placeInPromo({ grade: { kind: 'number', value: 15 }, promo: { min: 5, moy: 10, max: 20 } }),
    { min: 25, max: 100, moy: 50, value: 75 },
  )
  // No promo mean: still a spread and a dot.
  assert.equal(placeInPromo({ grade: { kind: 'number', value: 12 }, promo: { min: 4, moy: null, max: 18 } }).moy, null)
  assert.equal(placeInPromo({ grade: { kind: 'absent', value: null }, promo: { min: 4, moy: 10, max: 18 } }), null)
  assert.equal(placeInPromo({ grade: { kind: 'number', value: 12 }, promo: { min: null, moy: null, max: null } }), null)
})

test('the UE wash follows the colours and weights of the UEs', () => {
  const colors = { 'UE1': '#ff0000', 'UE2': '#0000ff' }
  assert.equal(buildUeWash([{ ue: 'UE1', weight: 3 }], colors), '#ff0000')
  assert.equal(
    buildUeWash([{ ue: 'UE1', weight: 3 }, { ue: 'UE2', weight: 1 }], colors),
    'linear-gradient(90deg, #ff0000 37.5%, #0000ff 87.5%)',
  )
  assert.equal(buildUeWash([{ ue: 'UE3', weight: 1 }], colors), null)
})

test('scores keep at most two decimals', () => {
  assert.equal(formatScore(16.666666), '16.67')
  assert.equal(formatScore(14), '14')
  assert.equal(formatScore(12.5), '12.5')
})

test('listUeGroups puts each subject under the UEs it feeds, with that UE’s numbers', () => {
  const payload = buildDemoGradesPayload()
  const groups = listUeGroups(buildGradesReport(payload['relevé'], { config: payload.config }))

  assert.deepEqual(groups.map((ue) => [ue.code, ue.state]), [['UE5.1', 'validated'], ['UE5.2', 'validated'], ['UE5.3', 'validated']])
  // Biggest coefficient first.
  assert.deepEqual(groups[0].modules.map((module) => [module.code, module.coef]), [['SAÉ 5.01', 4], ['R5.07', 3], ['R5.04', 2]])

  // Stratégie de communication (R5.07) feeds UE5.1 and UE5.2, with ScoDoc's average in each.
  const uxIn51 = groups[0].modules.find((module) => module.code === 'R5.07')
  const uxIn52 = groups[1].modules.find((module) => module.code === 'R5.07')
  // UE5.1: (14 × 1 + 17 × 2) / 3; UE5.2, the diagnostic at half weight: 41 / 2.5.
  assert.equal(uxIn51.average, 16)
  assert.equal(uxIn52.average, 16.4)
  // Only the evaluations that count for the UE, with their weight in it.
  assert.ok(uxIn52.evaluations.every((entry) => entry.weight > 0))
  assert.deepEqual(uxIn52.evaluations.map((entry) => entry.weight), [0.5, 1])

  // A subject without a grade yet: no average, no evaluation.
  const culture = groups[1].modules.find((module) => module.code === 'R5.09')
  assert.equal(culture.average, null)
  assert.deepEqual(culture.evaluations, [])
})

test('listUeGroups gives a UE the state of the "UE validées" ring', () => {
  const ue = (code, average, extra = {}) => ({ code, title: code, color: '#000', average: { value: average }, modules: [{ code: 'R1', coef: 1, average }], ...extra })
  const report = {
    resources: [{ code: 'R1', title: 'R1', evaluations: [] }],
    saes: [],
    ues: [
      ue('A', 12),
      ue('B', 8.5),
      ue('C', null),
      ue('D', 7, { capitalized: true }),
      // Under 10, its ECTS awarded by the jury: compensated.
      ue('F', 8.7, { ects: { earned: 6, total: 6 } }),
      ue('G', 8.7, { decision: 'ADJ' }),
      { code: 'E', modules: [] },
    ],
  }

  assert.deepEqual(listUeGroups(report).map((group) => [group.code, group.state, group.validatedBy]), [
    ['A', 'validated', 'average'],
    ['B', 'below', null],
    ['C', 'pending', null],
    ['D', 'validated', 'capitalization'],
    ['F', 'validated', 'compensation'],
    ['G', 'validated', 'jury'],
  ])
})

test('new grades are told by evaluation ids, never by values', async () => {
  const { listGradedEvaluationIds, findNewEvaluationIds } = await import('../src/gradesSubjects.js')
  const report = {
    resources: [{ evaluations: [
      { id: 1, grade: { kind: 'number', value: 12 } },
      { id: 2, grade: { kind: 'pending' } },
      { id: 3, grade: { kind: 'absent' } },
    ] }],
    saes: [{ evaluations: [{ id: 4, grade: { kind: 'number', value: 15 } }] }],
  }
  assert.deepEqual(listGradedEvaluationIds(report), ['1', '3', '4'])
  // First visit of a semester: nothing is "new".
  assert.equal(findNewEvaluationIds(['1', '3', '4'], null).size, 0)
  assert.deepEqual([...findNewEvaluationIds(['1', '3', '4'], ['1', 3])], ['4'])
})

test('listUeGroups carries a UE’s bonus, malus and rank, as ScoDoc gave them', () => {
  const payload = buildDemoGradesPayload()
  const releve = payload['relevé']
  releve.ues['UE5.2'].malus = '0.50'
  // The demo hides its ranks: shown here, as a department may.
  releve.options = { ...releve.options, show_rangs: true, show_ue_rangs: true }
  const groups = Object.fromEntries(listUeGroups(buildGradesReport(releve, { config: payload.config })).map((ue) => [ue.code, ue]))

  // Already in the average: carried as is, nothing added.
  assert.equal(groups['UE5.3'].bonus, 0.1)
  assert.equal(groups['UE5.3'].average, 15.29)
  assert.equal(groups['UE5.2'].malus, 0.5)
  assert.equal(groups['UE5.1'].bonus, null)
  assert.equal(groups['UE5.1'].malus, null)
  assert.deepEqual(groups['UE5.1'].rank, { value: '12', total: 84 })

  // Ranks hidden by the department: none on the UEs.
  releve.options = { ...releve.options, show_ue_rangs: false }
  assert.ok(listUeGroups(buildGradesReport(releve)).every((ue) => ue.rank === null))
})

test('ranks read "Rang 9 / 84", ex aequo kept', async () => {
  const { formatRank } = await import('../src/gradesSubjects.js')
  assert.deepEqual(formatRank({ value: '9', total: 84 }), { text: 'Rang 9 / 84', spoken: 'Rang 9 sur 84' })
  assert.equal(formatRank({ value: '12 ex æquo', total: 45 }).text, 'Rang 12 / 45 ex æquo')
  assert.equal(formatRank({ value: '3', total: null }).text, 'Rang 3')
  assert.equal(formatRank(null), null)
  assert.equal(formatRank({ value: '', total: 45 }), null)
})

test('bonus and malus points carry their sign', async () => {
  const { formatSignedPoints } = await import('../src/gradesSubjects.js')
  assert.equal(formatSignedPoints(0.25), '+0.25')
  assert.equal(formatSignedPoints(-0.5), '−0.5')
})

test('group ranks keyed by id take the group’s name, or are left out', async () => {
  const { nameGroupRanks } = await import('../src/gradesSubjects.js')
  const groups = [{ id: 412, group_name: 'TD B' }, { id: 413, group_name: 'TP 3' }]
  assert.deepEqual(
    nameGroupRanks([{ name: '412', value: '3', total: 28 }, { name: '999', value: '1', total: 14 }, { name: 'TP 3', value: '2', total: 14 }], groups),
    [{ name: 'TD B', value: '3', total: 28 }, { name: 'TP 3', value: '2', total: 14 }],
  )
  assert.deepEqual(nameGroupRanks(null, null), [])
})

test('the relevé’s update reads relative to today, in French', async () => {
  const { formatReportUpdate } = await import('../src/gradesSubjects.js')
  const now = new Date(2026, 9, 15, 16, 0)
  const at = (...parts) => new Date(...parts).toISOString()

  assert.equal(formatReportUpdate(at(2026, 9, 15, 14, 32), now), 'Mis à jour aujourd’hui à 14:32')
  assert.equal(formatReportUpdate(at(2026, 9, 14, 9, 5), now), 'Mis à jour hier à 09:05')
  assert.equal(formatReportUpdate(at(2026, 9, 3, 14, 32), now), 'Mis à jour le 3 oct. à 14:32')
  assert.equal(formatReportUpdate(at(2025, 4, 3, 14, 32), now), 'Mis à jour le 3 mai 2025 à 14:32')
  // ScoDoc's own shape: microseconds and a UTC "Z".
  assert.match(formatReportUpdate('2026-10-15T12:32:10.123456Z', now), /^Mis à jour (aujourd’hui|hier|le .+) à \d{2}:\d{2}$/)
  assert.equal(formatReportUpdate('2026-10-03', now), 'Mis à jour le 3 oct.')
  assert.equal(formatReportUpdate('pas une date', now), null)
  assert.equal(formatReportUpdate('', now), null)
  assert.equal(formatReportUpdate(null, now), null)
})
