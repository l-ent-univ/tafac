import assert from 'node:assert/strict'
import test from 'node:test'
import { searchDemoMailContacts } from '../server/mailAutocomplete.js'
import { buildDemoGradesPayload, buildDemoTimetablePayload } from '../src/demoAccount.js'
import { prepareGradeMail } from '../src/gradeMail.js'
import { buildGradesReport } from '../src/gradesReport.js'
import { findModuleTeacherNames, isModuleCode, moduleWindowMondays, normalizeModuleCode, titleModuleCodes } from '../src/moduleTeachers.js'
import { mergeEvents, toPlanningEvent } from '../src/planningEvents.js'
import { lookupTeacherRecipients, offerOnly } from '../src/teacherRecipients.js'

const at = (month, day, hours) => new Date(2026, month - 1, day, hours).getTime()
const lesson = (title, month, day, teacher) => toPlanningEvent({ uid: `${title}-${day}`, title, startMs: at(month, day, 8), endMs: at(month, day, 10), teacher })
const today = '2026-10-28'

test('module codes, written however', () => {
  for (const code of ['R5.11', 'R511', 'r5-11', 'R 5.11', 'R5_11']) assert.equal(normalizeModuleCode(code), 'R511', code)
  for (const code of ['SAÉ 3.01', 'SAE3.01', 'SAE 301', 'saé3.01']) assert.equal(normalizeModuleCode(code), 'SAE301', code)
  assert.equal(normalizeModuleCode('R5.A.11'), 'R5A11')
  for (const code of ['', null, 'Anglais', '5.11', 'ABCDE1.01']) assert.equal(normalizeModuleCode(code), '', String(code))
})

test('the codes a class\'s title carries, and which are the module\'s', () => {
  assert.deepEqual(titleModuleCodes('R5.11 Développement Front'), ['R511'])
  assert.deepEqual(titleModuleCodes('TD - R511 Web'), ['R511'])
  assert.deepEqual(titleModuleCodes('SAÉ 5.01 Projet tutoré'), ['SAE501'])
  assert.deepEqual(titleModuleCodes('R5.11-TP Front'), ['R511TP'])
  assert.deepEqual(titleModuleCodes('SAE Prototype interactif'), [])
  assert.deepEqual(titleModuleCodes('Développement'), [])
  assert.equal(isModuleCode('R511', 'R511'), true)
  assert.equal(isModuleCode('R511TP', 'R511'), true)
  assert.equal(isModuleCode('R5110', 'R511'), false)
  assert.equal(isModuleCode('R511', 'R51'), false)
  assert.equal(isModuleCode('R511', ''), false)
})

test('a module\'s teachers: its classes in the window, the most seen first', () => {
  assert.deepEqual(moduleWindowMondays(today), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'])
  const events = mergeEvents([
    lesson('R5.11 Développement Front', 10, 26, 'M. Lemoine'),
    lesson('R511 TP Front', 10, 20, 'M. Lemoine - Mme Riou'),
    lesson('R5.11 Développement Front', 11, 2, 'Mme Riou'),
    lesson('R5.11 Développement Front', 10, 27, 'M. Lemoine'),
    // Out of the window, another module, a near code, no teacher.
    lesson('R5.11 Développement Front', 9, 1, 'M. Ancien'),
    lesson('R5.12 Back-end', 10, 27, 'M. Guillou'),
    lesson('R5.110 Autre', 10, 27, 'M. Autre'),
    lesson('R5.11 Libre', 10, 29, ''),
  ])
  assert.deepEqual(findModuleTeacherNames(events, 'R5.11', today), ['M. Lemoine', 'Mme Riou'])
  assert.deepEqual(findModuleTeacherNames(events, 'R511', today), ['M. Lemoine', 'Mme Riou'])
  assert.deepEqual(findModuleTeacherNames(events, 'R5.12', today), ['M. Guillou'])
  // No class of it, no code, no planning: none.
  assert.deepEqual(findModuleTeacherNames(events, 'SAÉ 5.01', today), [])
  assert.deepEqual(findModuleTeacherNames(events, 'Anglais', today), [])
  assert.deepEqual(findModuleTeacherNames([], 'R5.11', today), [])
  assert.deepEqual(findModuleTeacherNames(null, 'R5.11', today), [])
})

const demoSearch = async (query) => ({ status: 'ok', suggestions: searchDemoMailContacts(query) })

test('a grade\'s teachers from the planning are offered, never put in À', async () => {
  // The demo's: R5.03 is Mme Riou's in its planning.
  const events = mergeEvents(buildDemoTimetablePayload({ date: today }).events.map(toPlanningEvent))
  const names = findModuleTeacherNames(events, 'R5.03', today)
  assert.deepEqual(names, ['Mme Riou'])
  const found = await lookupTeacherRecipients(names.join('\n'), { search: demoSearch })
  // As a class's teacher she'd be sure (one match): for a grade, offered.
  assert.equal(found.prefill.length, 1)
  const plan = offerOnly(found)
  assert.deepEqual(plan.prefill, [])
  assert.deepEqual(plan.suggestions, [{ name: 'Mme Riou', matches: [{ name: 'Sophie Riou', email: 'sophie.riou@univ-rennes.fr' }] }])
})

test('a grade\'s mail keeps its relevé teacher in À and names its module for the planning', async () => {
  const payload = buildDemoGradesPayload()
  const report = buildGradesReport(payload['relevé'], { config: payload.config })
  const module = report.resources.find((entry) => entry.code === 'R5.11')
  const evaluation = module.evaluations.find((entry) => entry.grade.kind === 'number')
  const request = await prepareGradeMail({ report, module, evaluation, absences: payload.absences })
  assert.deepEqual(request.to, [{ name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr' }])
  assert.equal(request.moduleCode, 'R5.11')
  assert.equal(request.kind, 'grade')
  assert.equal(request.teachers, undefined)
})
