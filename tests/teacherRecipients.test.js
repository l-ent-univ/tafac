import assert from 'node:assert/strict'
import test from 'node:test'
import { searchDemoMailContacts } from '../server/mailAutocomplete.js'
import {
  isStudentAddress,
  lookupTeacherRecipients,
  matchesTeacher,
  parseTeacherName,
  parseTeacherNames,
  planTeacherRecipients,
  resolveTeacher,
} from '../src/teacherRecipients.js'

const person = (name, email, kind = 'directory') => ({ name, email, kind })

test('a teacher\'s name, as ADE and TEMPO write it', () => {
  const pick = (text) => {
    const teacher = parseTeacherName(text)
    return teacher && { surname: teacher.surname, given: teacher.given, initials: teacher.initials, certain: teacher.certain, queries: teacher.queries }
  }
  assert.deepEqual(pick('M. Lemoine'), { surname: ['lemoine'], given: [], initials: [], certain: true, queries: ['Lemoine'] })
  assert.deepEqual(pick('Mme Le Fur'), { surname: ['le', 'fur'], given: [], initials: [], certain: true, queries: ['Le Fur'] })
  assert.deepEqual(pick('Dr. Ménard'), { surname: ['menard'], given: [], initials: [], certain: true, queries: ['Ménard'] })
  // ADE's « NOM Prénom », either way round: the capitals are the surname.
  assert.deepEqual(pick('LEMOINE Thomas'), { surname: ['lemoine'], given: ['thomas'], initials: [], certain: true, queries: ['LEMOINE'] })
  assert.deepEqual(pick('Thomas LEMOINE'), { surname: ['lemoine'], given: ['thomas'], initials: [], certain: true, queries: ['LEMOINE'] })
  assert.deepEqual(pick('Jean-Pierre LE GALL'), { surname: ['le', 'gall'], given: ['jean', 'pierre'], initials: [], certain: true, queries: ['LE GALL'] })
  // TEMPO's « Martin C. ».
  assert.deepEqual(pick('Martin C.'), { surname: ['martin'], given: [], initials: ['c'], certain: true, queries: ['Martin'] })
  assert.deepEqual(pick('Le Goff J.-P.'), { surname: ['le', 'goff'], given: [], initials: ['j', 'p'], certain: true, queries: ['Le Goff'] })
  // Which is the surname unknown: the whole name, then its first word.
  assert.deepEqual(pick('Dupont Marie'), { surname: ['dupont', 'marie'], given: [], initials: [], certain: true, queries: ['Dupont Marie', 'Dupont'] })
  assert.deepEqual(pick('Le Fur Anne').queries, ['Le Fur Anne', 'Le Fur'])
  // A lone word: looked up, never sure.
  assert.deepEqual(pick('LEMOINE'), { surname: ['lemoine'], given: [], initials: [], certain: false, queries: ['LEMOINE'] })
  // Not names.
  for (const text of ['', '  ', 'TP1', '(Exporté le:28/10/2026 10:15)', 'M.', 'prof@univ.fr', 'x'.repeat(90)]) assert.equal(parseTeacherName(text), null)
})

test('a class\'s teachers: split as the sources join them, once each, three at most', () => {
  const names = (text) => parseTeacherNames(text).map((teacher) => teacher.display)
  assert.deepEqual(names('Ménard A. - Le Goff B.'), ['Ménard A.', 'Le Goff B.'])
  assert.deepEqual(names('DUPONT Marie\nMARTIN Jean\n(Exporté le:28/10/2026)'), ['DUPONT Marie', 'MARTIN Jean'])
  assert.deepEqual(names('M. Lemoine, Mme Le Fur; M. Guillou / Mme Riou'), ['M. Lemoine', 'Mme Le Fur', 'M. Guillou'])
  assert.deepEqual(names('M. Lemoine - m. lemoine'), ['M. Lemoine'])
  // A hyphen inside a name stays.
  assert.deepEqual(names('Jean-Pierre DUPONT'), ['Jean-Pierre DUPONT'])
  assert.deepEqual(names(null), [])
  assert.deepEqual(names(''), [])
})

test('a suggestion is the teacher when every piece of the name is in it', () => {
  const lemoine = parseTeacherName('M. Lemoine')
  assert.equal(matchesTeacher(lemoine, person('Thomas Lemoine', 'thomas.lemoine@univ-rennes.fr')), true)
  assert.equal(matchesTeacher(lemoine, person('Thomas Lemoine-Riou', 'tlr@univ-rennes.fr')), true)
  // A word that only starts like it isn't.
  assert.equal(matchesTeacher(lemoine, person('Julie Lemoineau', 'julie.lemoineau@univ-rennes.fr')), false)
  // Never a mailing list or a student.
  assert.equal(matchesTeacher(lemoine, person('Lemoine fans', 'lemoine@listes.univ-rennes.fr', 'group')), false)
  assert.equal(matchesTeacher(lemoine, person('Hugo Lemoine', 'hugo.lemoine@etudiant.univ-rennes.fr')), false)
  // Accents and case aside; the address when there's no name.
  assert.equal(matchesTeacher(parseTeacherName('MENARD Aurélie'), person('Aurelie Ménard', 'a.menard@univ-rennes2.fr')), true)
  assert.equal(matchesTeacher(parseTeacherName('M. Lemoine'), person('', 'thomas.lemoine@univ-rennes.fr', 'recent')), true)
  // The first name and the initial have to be there too, once each.
  const martin = parseTeacherName('Martin C.')
  assert.equal(matchesTeacher(martin, person('Claire Martin', 'claire.martin@univ-rennes2.fr')), true)
  assert.equal(matchesTeacher(martin, person('Hugo Martin', 'hugo.martin@univ-rennes2.fr')), false)
  assert.equal(matchesTeacher(parseTeacherName('LEMOINE Thomas'), person('Julie Lemoine', 'julie.lemoine@univ-rennes.fr')), false)
  assert.equal(matchesTeacher(parseTeacherName('Mme Le Fur'), person('Anne Le Fur', 'anne.le-fur@univ-rennes.fr')), true)
  assert.equal(matchesTeacher(parseTeacherName('Mme Le Fur'), person('Anne Fur', 'anne.fur@univ-rennes.fr')), false)
  assert.equal(isStudentAddress('a@etudiant.univ-rennes2.fr'), true)
  assert.equal(isStudentAddress('a@etu.univ-rennes.fr'), true)
  assert.equal(isStudentAddress('a@univ-rennes.fr'), false)
  assert.equal(isStudentAddress('etudiant@univ-rennes.fr'), false)
})

test('À is filled only with one sure match for one teacher', () => {
  const lemoine = parseTeacherName('M. Lemoine')
  const thomas = person('Thomas Lemoine', 'thomas.lemoine@univ-rennes.fr')
  const julie = person('Julie Lemoine', 'julie.lemoine@univ-rennes.fr')
  assert.deepEqual(resolveTeacher(lemoine, [thomas, person('Léa Moreau', 'lea@etudiant.univ-rennes.fr')]), { matches: [thomas], confident: true })
  // Two of them: offered, not chosen.
  assert.deepEqual(resolveTeacher(lemoine, [thomas, julie]), { matches: [thomas, julie], confident: false })
  // A list cut at the server's limit: the only match so far isn't sure.
  assert.equal(resolveTeacher(lemoine, [thomas], { complete: false }).confident, false)
  // A lone word without a civility: never sure.
  assert.equal(resolveTeacher(parseTeacherName('LEMOINE'), [thomas]).confident, false)

  const one = planTeacherRecipients([{ teacher: lemoine, matches: [thomas], confident: true }])
  assert.deepEqual(one.prefill, [{ name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr' }])
  assert.deepEqual(one.suggestions, [{ name: 'M. Lemoine', matches: [{ name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr' }] }])
  const several = planTeacherRecipients([{ teacher: lemoine, matches: [thomas, julie], confident: false }])
  assert.deepEqual(several.prefill, [])
  assert.equal(several.suggestions[0].matches.length, 2)
  assert.equal(several.canAddAll, false)
  // Two teachers, each found once: offered each, « Tout ajouter ».
  const furs = parseTeacherName('Mme Le Fur')
  const anne = person('Anne Le Fur', 'anne.le-fur@univ-rennes.fr')
  const two = planTeacherRecipients([{ teacher: furs, matches: [anne], confident: true }, { teacher: lemoine, matches: [thomas], confident: true }])
  assert.deepEqual(two.prefill, [])
  assert.deepEqual(two.suggestions.map((entry) => entry.name), ['Mme Le Fur', 'M. Lemoine'])
  assert.equal(two.canAddAll, true)
  // None found: nothing at all.
  assert.deepEqual(planTeacherRecipients([{ teacher: lemoine, matches: [], confident: false }]), { prefill: [], suggestions: [], canAddAll: false })
  assert.deepEqual(planTeacherRecipients([]), { prefill: [], suggestions: [], canAddAll: false })
})

// The demo's address book, as the route answers it.
const demoSearch = async (query) => ({ status: 'ok', suggestions: searchDemoMailContacts(query) })

test('the demo planning\'s teachers resolve in the demo address book', async () => {
  assert.deepEqual((await lookupTeacherRecipients('M. Lemoine', { search: demoSearch })).prefill, [{ name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr' }])
  // Mme Martin: the student Hugo Martin left out, Claire Martin found.
  assert.deepEqual((await lookupTeacherRecipients('Mme Martin', { search: demoSearch })).prefill.map((entry) => entry.email), ['claire.martin@univ-rennes.fr'])
  // Two Le Fur: offered, À left alone.
  const furs = await lookupTeacherRecipients('Mme Le Fur', { search: demoSearch })
  assert.deepEqual(furs.prefill, [])
  assert.deepEqual(furs.suggestions[0].matches.map((entry) => entry.email), ['anne.le-fur@univ-rennes.fr', 'yann.le-fur@univ-rennes.fr'])
  // The demo's shared class.
  const shared = await lookupTeacherRecipients('Mme Le Fur - M. Lemoine', { search: demoSearch })
  assert.deepEqual(shared.prefill, [])
  assert.deepEqual(shared.suggestions.map((entry) => [entry.name, entry.matches.length]), [['Mme Le Fur', 2], ['M. Lemoine', 1]])
  assert.equal(shared.canAddAll, false)
  for (const name of ['M. Le Goff', 'Mme Kerjean', 'Mme Riou', 'M. Guillou']) {
    assert.equal((await lookupTeacherRecipients(name, { search: demoSearch })).prefill.length, 1, name)
  }
  assert.deepEqual(await lookupTeacherRecipients('M. Inconnu', { search: demoSearch }), { prefill: [], suggestions: [], canAddAll: false })
})

test('the lookup: queries in turn, a failure as none found, nothing asked without a name', async () => {
  const asked = []
  const search = async (query) => {
    asked.push(query)
    if (query === 'Dupont Marie') return { status: 'ok', suggestions: [] }
    if (query === 'Dupont') return { status: 'ok', suggestions: [person('Marie Dupont', 'marie.dupont@univ-rennes2.fr')] }
    return { status: 'error', suggestions: [] }
  }
  const found = await lookupTeacherRecipients('Dupont Marie', { search })
  assert.deepEqual(asked, ['Dupont Marie', 'Dupont'])
  assert.deepEqual(found.prefill, [{ name: 'Marie Dupont', email: 'marie.dupont@univ-rennes2.fr' }])
  assert.deepEqual(await lookupTeacherRecipients('M. Lemoine', { search }), { prefill: [], suggestions: [], canAddAll: false })
  asked.length = 0
  await lookupTeacherRecipients('', { search })
  await lookupTeacherRecipients('TP1', { search })
  assert.deepEqual(asked, [])
  // Twelve answers (the route's most): the one match isn't sure.
  const crowded = async () => ({ status: 'ok', suggestions: [person('Thomas Lemoine', 'thomas.lemoine@univ-rennes.fr'), ...Array.from({ length: 11 }, (_, index) => person(`Autre ${index}`, `autre${index}@univ-rennes.fr`))] })
  const cut = await lookupTeacherRecipients('M. Lemoine', { search: crowded })
  assert.deepEqual(cut.prefill, [])
  assert.equal(cut.suggestions[0].matches.length, 1)
})
