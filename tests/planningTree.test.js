import assert from 'node:assert/strict'
import test from 'node:test'
import { adeTreeRoot, buildDirectory, focusAdeTree, followedGroups } from '../src/planningTree.js'
import { classOfCourse, toPlanningEvent } from '../src/planningEvents.js'

// tonAPI's ResourceNode, as /__ent_auth/timetable/tree gives it.
const leaf = (id, name, kind = 'group', extra = {}) => ({ id: String(id), name, kind, folder: false, children: [], ...extra })
const folder = (id, name, children, kind = 'group') => ({ id: String(id), name, kind, folder: true, children })

// The tree of planningPortalApi.test.js (the server's before), in tonAPI's
// shape: a BUT, its years, a TD, its TP groups.
function butGroups({ followed = '14961' } = {}) {
  const tp = (id, name) => leaf(id, name, 'group', String(id) === followed ? { selected: true } : {})
  return [
    folder(100, 'IUT Lannion', [
      folder(200, 'BUT MMI', [
        folder(300, 'MMI A2', [
          folder(400, '2B MMI', [
            folder(500, '2B2 MMI', [tp(14961, '2B2-StratUX MMI'), tp(14962, '2B2-Dev MMI')]),
          ]),
        ]),
        folder(301, 'MMI A1', [tp(14960, '1A MMI')]),
      ]),
    ]),
  ]
}

const lawGroups = () => [
  folder(600, 'Droit', [folder(601, 'RENNES', [folder(602, 'LICENCE 1', [folder(603, 'GROUPES TD', [folder(604, 'TD 04', [leaf(605, 'TP 04B', 'group', { selected: true })])])])])]),
]

function picked(groups, options = {}) {
  return focusAdeTree(adeTreeRoot(groups), { ownResources: followedGroups(groups), ...options })
}

test('the group picker\'s tree is the server\'s before, from tonAPI\'s', () => {
  const tree = picked(butGroups())
  assert.equal(tree.currentResourceId, '14961')
  assert.deepEqual(tree.currentPathIds, ['-100', '-1', '100', '200', '300', '400', '500', '14961'])
  assert.deepEqual(tree.selectionPathIds, ['100', '200', '300', '400', '14961'])
  assert.equal(tree.defaultSelection.resourceId, '14961')
  assert.equal(tree.defaultSelection.label, '2B2-StratUX MMI')
  assert.equal(tree.defaultSelection.programLabel, 'BUT MMI')
  assert.equal(tree.defaultSelection.yearLabel, 'MMI A2')
  assert.equal(tree.defaultSelection.tdLabel, '2B MMI')
  assert.equal(tree.defaultSelection.tpLabel, '2B2-StratUX MMI')
  assert.equal(tree.defaultSelection.contextLabel, 'IUT Lannion / BUT MMI')
  assert.deepEqual(tree.root.children.map(({ id }) => id), ['-1'])
  // The path, as the establishment's detection reads it.
  const student = tree.root.children[0].children[0]
  assert.equal(student.path, 'Ressources.Etudiants.IUT Lannion')

  // A TD asked: its TP groups offered.
  const td = picked(butGroups(), { requestedResourceId: '400' })
  const tdFocus = td.root.children[0].children[0].children[0].children[0].children[0]
  assert.deepEqual(tdFocus.children.map(({ id }) => id), ['14961', '14962'])
  assert.equal(td.defaultSelection, null)
})

test('a path without a BUT reads a level, a TD and a TP all the same', () => {
  const tree = picked(lawGroups())
  assert.deepEqual(tree.selectionPathIds, ['600', '601', '602', '604', '605'])
  assert.equal(tree.defaultSelection.yearLabel, 'LICENCE 1')
  assert.equal(tree.defaultSelection.tdLabel, 'TD 04')
  assert.equal(tree.defaultSelection.tpLabel, 'TP 04B')
  // A level asked: its TDs, those of the « Groupes TD » folder in its place.
  const level = picked(lawGroups(), { requestedResourceId: '602' })
  const levelFocus = level.root.children[0].children[0].children[0].children[0]
  assert.deepEqual(levelFocus.children.map(({ id }) => id), ['604'])
})

test('a group found elsewhere stands in for an account without one, never over its own', () => {
  const none = butGroups({ followed: null })
  assert.deepEqual(followedGroups(none), [])
  const bare = picked(none)
  assert.equal(bare.defaultSelection, null)
  assert.equal(bare.currentResourceId, null)

  const found = picked(none, { fallbackResourceId: '14962' })
  assert.equal(found.defaultSelection.resourceId, '14962')
  assert.equal(found.defaultSelection.yearLabel, 'MMI A2')
  assert.equal(found.defaultSelection.tpLabel, '2B2-Dev MMI')
  assert.deepEqual(found.selectionPathIds, ['100', '200', '300', '400', '14962'])
  assert.equal(picked(none, { fallbackResourceId: '999' }).defaultSelection, null)

  assert.equal(picked(butGroups(), { fallbackResourceId: '14962' }).defaultSelection.resourceId, '14961')
})

test('the groups the student follows, in the tree\'s order', () => {
  const groups = butGroups()
  groups[0].children[0].children[1].selected = true
  assert.deepEqual(followedGroups(groups), [{ id: '14961', name: '2B2-StratUX MMI' }, { id: '301', name: 'MMI A1' }])
  assert.deepEqual(followedGroups(null), [])
})

test('« Salles et personnels » from the trees: each entry under its folders', () => {
  const trees = [
    ...butGroups(),
    folder(900, 'IUT Lannion', [leaf(901, 'DUPONT Camille', 'teacher')], 'teacher'),
    folder(800, 'Sites Univ Rennes', [
      folder(810, 'IUT Lannion', [leaf(811, 'Amphi 1 [180P]', 'room'), leaf(812, 'B03 - Salle Atelier [24P]', 'room')], 'room'),
      folder(820, 'Appariteurs - Salles fictives', [leaf(821, 'Salle à définir', 'room')], 'room'),
    ], 'room'),
    leaf(700, 'Matériel', 'other'),
  ]
  const { groups, items } = buildDirectory(trees)
  assert.deepEqual(groups, [
    { kind: 'group', path: ['IUT Lannion', 'BUT MMI', 'MMI A2', '2B MMI', '2B2 MMI'] },
    { kind: 'group', path: ['IUT Lannion', 'BUT MMI', 'MMI A1'] },
    { kind: 'person', path: ['IUT Lannion'] },
    { kind: 'room', path: ['Sites Univ Rennes', 'IUT Lannion'] },
  ])
  // The placeholders' folder and a resource of no kind the panel shows are left out.
  assert.deepEqual(items, [
    ['14961', '2B2-StratUX MMI', 0],
    ['14962', '2B2-Dev MMI', 0],
    ['14960', '1A MMI', 1],
    ['901', 'DUPONT Camille', 2],
    ['811', 'Amphi 1 [180P]', 3],
    ['812', 'B03 - Salle Atelier [24P]', 3],
  ])
})

test('a course of tonAPI\'s is a class as the page keeps it', () => {
  const course = {
    id: '7001',
    title: 'Sociologie des publics',
    kind: null,
    start: '2026-11-24T09:00:00+01:00',
    end: '2026-11-24T10:00:00+01:00',
    rooms: ['A1 Amphi - 133 pl.', 'B019 Amphi'],
    teachers: ['Exemple D.', 'Demo C.'],
    groups: ['L2 Démo', 'Mineure L2'],
    description: 'Cours annulé',
    color: '66ccff',
    activityId: null,
    link: { url: 'https://pix.exemple.test/planning', label: 'VOTRE PLANNING' },
  }
  assert.deepEqual(classOfCourse(course), {
    uid: '7001',
    title: 'Sociologie des publics',
    start: '2026-11-24T08:00:00.000Z',
    end: '2026-11-24T09:00:00.000Z',
    startMs: Date.UTC(2026, 10, 24, 8),
    endMs: Date.UTC(2026, 10, 24, 9),
    location: 'A1 Amphi - 133 pl. - B019 Amphi',
    teacher: 'Exemple D. - Demo C.',
    groups: ['L2 Démo', 'Mineure L2'],
    groupsLabel: 'L2 Démo, Mineure L2',
    notes: 'Cours annulé',
    link: 'https://pix.exemple.test/planning',
    linkLabel: 'VOTRE PLANNING',
  })
  // As the planning shows it: the link's label softened, the groups joined.
  const shown = toPlanningEvent(classOfCourse(course))
  assert.equal(shown.linkLabel, 'Votre planning')
  assert.equal(shown.group, 'L2 Démo, Mineure L2')

  // Without a start: no class. Without an end, or one before it: no length.
  assert.equal(classOfCourse({ ...course, start: 'demain' }), null)
  const instant = classOfCourse({ ...course, end: '2026-11-24T08:00:00+01:00' })
  assert.equal(instant.end, instant.start)
  // A link that isn't the web's is none; empty lists and texts read as nothing.
  const bare = classOfCourse({ ...course, link: { url: 'javascript:alert(1)', label: 'x' }, rooms: [], teachers: null, description: ' ', title: '' })
  assert.deepEqual([bare.link, bare.linkLabel, bare.location, bare.teacher, bare.notes, bare.title], [null, null, '', '', null, 'Cours'])
})
