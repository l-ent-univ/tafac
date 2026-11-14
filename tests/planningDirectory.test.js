import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPortalDirectory } from '../planningPortalApi.js'
import {
  cleanFolderName,
  entryPlace,
  groupCollections,
  prepareDirectory,
  roomCapacity,
  roomKind,
  roomLabel,
  roomLayout,
  searchDirectory,
  sectionEntries,
  siteEntries,
  siteLabelFromSelection,
} from '../src/planningDirectory.js'

const leaf = (id, name) => ({ id, name, children: [] })
const folder = (id, name, children) => ({ id, name, children })

// The shape of the Rennes ADE portal's tree (normalizePortalTreePayload).
const ROOT = folder('-100', 'Ressources', [
  folder('-1', 'Etudiants', [
    folder('3414', 'IUT Lannion', [
      folder('426', 'BUT MMI', [
        folder('8294', 'MMI A2', [folder('8399', '2A MMI', [leaf('3309', '2A2 MMI'), leaf('11667', '2A1 MMI')])]),
        folder('8295', 'MMI A1', [folder('8400', '1A MMI', [leaf('879', '1A1 MMI')])]),
      ]),
      folder('427', 'BUT INFO', [folder('8500', 'INFO A1', [folder('8501', '1A I', [leaf('5101', '1A1 I')])])]),
    ]),
    folder('3500', 'Droit', [folder('3501', 'LICENCE 2', [leaf('7095', 'L2 - Droit des contrats')])]),
  ]),
  folder('-2', 'Enseignants', [
    folder('700', 'IUT Lannion', [
      folder('701', 'Permanents', [folder('702', 'Info Com', [leaf('7101', 'FONTAINE Aurelie'), leaf('7102', 'MORVAN SMITH Soraya')])]),
      folder('703', 'Vacataires', [folder('704', 'BUT INFO-COM', [leaf('7201', 'CHAGNOUX Marie')])]),
    ]),
    folder('710', '.Chercheurs - laboratoires', [folder('711', 'IRISA UMR 6074', [leaf('7301', 'MARTIN Philippe')])]),
    folder('portal-category-4', 'portal-category-4', [leaf('7401', 'DUPONT Leonard')]),
  ]),
  folder('-3', 'Salles', [
    folder('800', '19-Lannion IUT - Institut Universitaire de Technologie de Lannion', [
      folder('801', 'Bâtiment 05 - INFO', [
        folder('802', 'Salle informatique', [leaf('8101', 'B05 - 107'), leaf('8102', 'B05 - 215')]),
        folder('803', 'Salle de cours', [leaf('8103', 'B05 - 102')]),
      ]),
      folder('804', 'Bâtiment 03 - Amphithéatres', [folder('805', 'Amphithéâtre', [leaf('8201', 'B03 - Amphi 1 (007)')])]),
    ]),
    folder('830', '00-Beaulieu - Campus Scientifique et Technologique de Beaulieu', [
      folder('831', 'Appariteurs  -  salles fictives', [leaf('8501', 'salle à définir'), folder('832', 'MATH', [leaf('8502', 'en attente')])]),
    ]),
    folder('810', '00-Beaulieu - Campus Scientifique et Technologique de Beaulieu', [
      folder('811', 'Bâtiment 09B', [folder('812', 'Amphithéâtre', [leaf('8301', 'B09B - Amphi TA (009) [142P]')])]),
    ]),
    // A leaf seen twice in the tree is listed once.
    folder('820', 'Sites extérieurs', [folder('821', 'LANNION', [leaf('8101', 'B05 - 107'), leaf('8401', 'Salle des Ursulines')])]),
  ]),
])

const directory = buildPortalDirectory(ROOT)
const entries = prepareDirectory(directory)

test('the directory lists the rooms, staff and student groups, their folders as places', () => {
  const ids = directory.items.map(([id]) => id)
  assert.ok(ids.includes('3309'))
  // Folders (a TD, a year) have no timetable of their own in ADE.
  assert.ok(!ids.includes('8399') && !ids.includes('426'))
  assert.deepEqual(directory.groups[directory.items.find(([id]) => id === '3309')[2]], { kind: 'group', path: ['IUT Lannion', 'BUT MMI', 'MMI A2', '2A MMI'] })
  assert.equal(ids.filter((id) => id === '8101').length, 1)
  assert.deepEqual(
    directory.groups[directory.items.find(([id]) => id === '8301')[2]],
    { kind: 'room', path: ['00-Beaulieu - Campus Scientifique et Technologique de Beaulieu', 'Bâtiment 09B', 'Amphithéâtre'] },
  )
  // Placeholder rooms are left out, with all their folder holds.
  assert.ok(!ids.includes('8501') && !ids.includes('8502'))
  // A synthetic folder name is left out of the path.
  assert.deepEqual(directory.groups[directory.items.find(([id]) => id === '7401')[2]], { kind: 'person', path: [] })
})

test('an entry knows its kind and folders', () => {
  const amphi = entries.find((entry) => entry.id === '8301')
  assert.equal(amphi.kind, 'room')
  assert.equal(entries.find((entry) => entry.id === '7101').kind, 'person')
  assert.equal(entryPlace(amphi), 'Bâtiment 09B · Amphithéâtre')
})

test('folder names lose ADE sort prefixes', () => {
  assert.equal(cleanFolderName('19-Lannion IUT - Institut'), 'Lannion IUT - Institut')
  assert.equal(cleanFolderName('.Chercheurs - laboratoires'), 'Chercheurs - laboratoires')
  assert.equal(cleanFolderName('Bâtiment 05 - INFO'), 'Bâtiment 05 - INFO')
})

test('a room shows its seats apart', () => {
  assert.equal(roomCapacity('B09B - Amphi TA (009) [142P]'), 142)
  assert.equal(roomCapacity('B27 - 115 [46p]'), 46)
  assert.equal(roomCapacity('B05 - 107'), null)
  assert.equal(roomLabel('B09B - Amphi TA (009) [142P]'), 'B09B - Amphi TA (009)')
})

test('the site comes from the group’s context', () => {
  assert.equal(siteLabelFromSelection({ contextLabel: 'IUT Lannion / BUT Info-Com' }), 'IUT Lannion')
  assert.equal(siteLabelFromSelection({ contextLabel: '' }), null)
  assert.equal(siteLabelFromSelection(null), null)
})

test('the site’s rooms and staff are found by its words, not its exact name', () => {
  assert.deepEqual(siteEntries(entries, 'room', 'IUT Lannion').map(({ id }) => id).sort(), ['8101', '8102', '8103', '8201'])
  assert.deepEqual(siteEntries(entries, 'person', 'IUT Lannion').map(({ id }) => id).sort(), ['7101', '7102', '7201'])
  assert.deepEqual(siteEntries(entries, 'room', null), [])
})

test('the site’s rooms are in sections by building, their type on the row', () => {
  const sections = sectionEntries(siteEntries(entries, 'room', 'IUT Lannion'), 'room')
  assert.deepEqual(sections.map(({ title }) => title), ['Bâtiment 03 - Amphithéatres', 'Bâtiment 05 - INFO'])
  assert.deepEqual(sections[1].entries.map(({ name, detail }) => `${name} | ${detail}`), [
    'B05 - 102 | Salle de cours',
    'B05 - 107 | Salle informatique',
    'B05 - 215 | Salle informatique',
  ])
  const people = sectionEntries(siteEntries(entries, 'person', 'IUT Lannion'), 'person')
  assert.deepEqual(people.map(({ title }) => title), ['Permanents · Info Com', 'Vacataires · BUT INFO-COM'])
})

test('a search matches every word, names first, the site first', () => {
  assert.deepEqual(searchDirectory(entries, 'person', 'martin').map(({ id }) => id), ['7301'])
  assert.deepEqual(searchDirectory(entries, 'room', 'amphi', { siteLabel: 'IUT Lannion' }).map(({ id }) => id), ['8201', '8301'])
  assert.deepEqual(searchDirectory(entries, 'room', 'amphi').map(({ id }) => id), ['8201', '8301'])
  // Accents and case don't matter; a folder's words count too.
  assert.deepEqual(searchDirectory(entries, 'room', 'beaulieu').map(({ id }) => id), ['8301'])
  assert.deepEqual(searchDirectory(entries, 'room', 'b05 informatique').map(({ id }) => id), ['8101', '8102'])
  assert.deepEqual(searchDirectory(entries, 'person', '  '), [])
  // People aren't rooms.
  assert.deepEqual(searchDirectory(entries, 'room', 'fontaine'), [])
})

test('a room’s kind comes from its type and name, not its building', () => {
  const room = (name, type) => ({ name, path: ['19-Lannion IUT', 'Bâtiment 05 - INFO', ...(type ? [type] : [])] })
  assert.equal(roomKind(room('B03 - Amphi 1 (007)', 'Amphithéâtre')), 'amphi')
  assert.equal(roomKind(room('B05 - 107', 'Salle informatique')), 'computer')
  assert.equal(roomKind(room('B05 - 102', 'Salle de cours')), 'class')
  assert.equal(roomKind(room('B12 - TP Info (010)', 'Salle de travaux pratiques')), 'computer')
  assert.equal(roomKind(room('B04 - Atelier Makerspace (001)', 'Atelier')), 'lab')
  assert.equal(roomKind(room('B01 - Salle de réunion (110-111)', 'Salle de réunion')), 'meeting')
  assert.equal(roomKind(room('B01 - Bibliothèque (106)', 'Documentation')), 'library')
  assert.equal(roomKind(room('B03 - 101', 'Salle de travail étudiants')), 'study')
  assert.equal(roomKind(room('B01 - Studio TV (102)', 'Salle de travaux pratiques')), 'lab')
  assert.equal(roomKind(room('B01 - Hall (001)', 'Hall')), 'hall')
  assert.equal(roomKind(room('Carré Magique')), 'other')
})

test('a room keeps its own layout', () => {
  assert.deepEqual(roomLayout('8101'), roomLayout('8101'))
  const layouts = ['8101', '8102', '8103', '8201', '8301', '15099', '13662'].map(roomLayout)
  assert.ok(new Set(layouts.map((layout) => JSON.stringify(layout))).size > 1)
  for (const layout of layouts) {
    assert.ok(layout.width >= 12 && layout.width <= 15)
    assert.ok(layout.depth >= 9 && layout.depth <= 11)
    assert.ok(layout.variant >= 0 && layout.variant <= 2)
  }
})

test('the site’s groups are collections by formation, year and TD, the student’s own formation first', () => {
  const groups = siteEntries(entries, 'group', 'IUT Lannion')
  assert.deepEqual(groups.map(({ id }) => id).sort(), ['11667', '3309', '5101', '879'])
  const collections = groupCollections(groups, { ownId: '3309' })
  assert.deepEqual(collections.map(({ label, own }) => `${label} | ${own}`), ['BUT MMI | true', 'BUT INFO | false'])
  const [mmi, info] = collections
  assert.deepEqual(mmi.years.map(({ label }) => label), ['1re année', '2e année'])
  assert.deepEqual(info.years.map(({ label }) => label), ['1re année'])
  // A TD named as its groups start has no label of its own.
  assert.deepEqual(mmi.years[1].tds.map(({ name, label }) => `${name} | ${label}`), ['2A MMI | '])
  assert.deepEqual(mmi.years[1].tds[0].groups.map(({ entry, label }) => `${entry.name} | ${label}`), ['2A1 MMI | 2A1', '2A2 MMI | 2A2'])
  // Without the student's group among them: no formation first, in order.
  assert.deepEqual(groupCollections(groups).map(({ label, own }) => `${label} | ${own}`), ['BUT INFO | false', 'BUT MMI | false'])
})

test('a group found by a search says its site and formation', () => {
  const [found] = searchDirectory(entries, 'group', '2a2')
  assert.equal(found.id, '3309')
  assert.equal(entryPlace(found), 'IUT Lannion · BUT MMI · 2A MMI')
  assert.deepEqual(searchDirectory(entries, 'group', 'droit contrats').map(({ id }) => id), ['7095'])
})

const collectionsOf = (formations, options) => groupCollections(
  prepareDirectory(buildPortalDirectory(folder('-100', 'Ressources', [folder('-1', 'Etudiants', [folder('1', 'IUT Lannion', formations)])]))),
  options,
)

test('a group’s name keeps what its formation and the others don’t say', () => {
  const [info, infoCom, web] = collectionsOf([
    folder('2', 'BUT Info-Com', [folder('3', 'Info-Com 3', [folder('4', 'TD A', [leaf('11', 'TP 1')]), folder('5', 'TD B', [leaf('12', 'TP 3')])])]),
    // Every group ends with « I », the formation's initial.
    folder('6', 'BUT INFO', [folder('7', 'INFO A2', [folder('8', '2A I', [leaf('13', '2A1 I'), leaf('14', '2A2 I')])])]),
    // Groups right under their formation: no year, no TD.
    folder('9', 'LP Web', [leaf('15', 'LP Web alternants'), leaf('16', 'LP Web initiaux')]),
  ])
  assert.equal(infoCom.years[0].label, '3e année')
  // « TP 1 » doesn't say its TD: the TD keeps its label.
  assert.deepEqual(infoCom.years[0].tds.map(({ label, groups }) => `${label} | ${groups.map((group) => group.label).join(', ')}`), ['TD A | TP 1', 'TD B | TP 3'])
  assert.equal(info.years[0].label, '2e année')
  assert.deepEqual(info.years[0].tds.map(({ name, label, groups }) => `${name} | ${label} | ${groups.map((group) => group.label).join(', ')}`), ['2A I |  | 2A1, 2A2'])
  assert.deepEqual(web.years.map(({ id, label }) => `${id} | ${label}`), [' | '])
  assert.deepEqual(web.years[0].tds[0].groups.map(({ entry, label }) => `${entry.name} | ${label}`), ['LP Web alternants | alternants', 'LP Web initiaux | initiaux'])
})

test('a folder under a TD doesn’t part its groups', () => {
  const [mmi] = collectionsOf([
    folder('2', 'BUT MMI', [folder('3', 'MMI A2', [folder('4', '2B MMI', [
      leaf('11', '2B1 MMI'),
      folder('5', '2B2 MMI', [leaf('12', '2B2-StratUX MMI'), leaf('13', '2B2-DWeb MMI')]),
    ])])]),
  ])
  assert.deepEqual(mmi.years[0].tds.map(({ label, groups }) => `${label} | ${groups.map((group) => group.label).join(', ')}`), [' | 2B1, 2B2-DWeb, 2B2-StratUX'])
})

test('the student’s own formation is their group’s, else the one named as theirs', () => {
  const formations = [
    folder('2', 'BUT INFO', [leaf('11', 'INFO alternants')]),
    folder('3', 'BUT Info-Com', [leaf('12', 'Info-Com alternants')]),
    folder('4', 'BUT MMI', [leaf('13', 'MMI alternants')]),
  ]
  const owns = (options) => collectionsOf(formations, options).map(({ label, own }) => `${label} | ${own}`)
  assert.deepEqual(owns({ ownId: '12', first: 'BUT MMI' }), ['BUT Info-Com | true', 'BUT INFO | false', 'BUT MMI | false'])
  // A TD or a year chosen (not among the groups): by the formation's name.
  assert.deepEqual(owns({ ownId: '999', first: 'BUT INFO' }), ['BUT INFO | true', 'BUT Info-Com | false', 'BUT MMI | false'])
  assert.deepEqual(owns({ first: 'but mmi' }), ['BUT MMI | true', 'BUT INFO | false', 'BUT Info-Com | false'])
  // A lone name is kept whole.
  assert.equal(collectionsOf(formations)[0].years[0].tds[0].groups[0].label, 'alternants')
})
