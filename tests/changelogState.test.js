import assert from 'node:assert/strict'
import test from 'node:test'
import { CHANGELOG } from '../src/changelog.js'
import {
  CHANGELOG_SEEN_KEY,
  formatEntryDate,
  forgetSeen,
  getApplicableEntries,
  getHeldLaunchIds,
  getLaunchId,
  getPillIds,
  groupEntriesByDate,
  isEntryApplicable,
  isFeatureOn,
  markAllSeen,
  markEntrySeen,
  parseSeenValue,
  readSeenValue,
  resolveChangelogVisit,
  writeSeenValue,
} from '../src/changelogState.js'

// Two universities shaped like universityConfig: Rennes has everything,
// the example has mail off and grades greyed out.
const RENNES = { id: 'univ-rennes', features: { mail: true, moodle: true, grades: true, schoolCertificate: true, weather: { enabled: true } } }
const EXEMPLE = { id: 'univ-exemple', features: { mail: false, moodle: false, grades: 'disabled', weather: { enabled: false } } }

const GLOBAL = { id: 'global', date: '2026-10-01', title: 'Partout', body: '…' }
const RENNES_ONLY = { id: 'rennes', date: '2026-10-05', title: 'Rennes', body: '…', universities: ['univ-rennes'] }
const NEEDS_MAIL = { id: 'mail', date: '2026-10-05', title: 'Mail', body: '…', features: ['mail'] }
const NEW_GLOBAL = { id: 'new-global', date: '2026-11-02', title: 'Nouveau', body: '…' }
const ENTRIES = [GLOBAL, RENNES_ONLY, NEEDS_MAIL]

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test('features count as on only when true or an enabled object', () => {
  assert.equal(isFeatureOn(true), true)
  assert.equal(isFeatureOn({ enabled: true, defaultCity: 'Rennes' }), true)
  assert.equal(isFeatureOn({ defaultCity: 'Paris' }), true)
  assert.equal(isFeatureOn({ enabled: false }), false)
  assert.equal(isFeatureOn('disabled'), false)
  assert.equal(isFeatureOn(false), false)
  assert.equal(isFeatureOn(undefined), false)
})

test('an entry without targeting applies everywhere', () => {
  assert.equal(isEntryApplicable(GLOBAL, RENNES), true)
  assert.equal(isEntryApplicable(GLOBAL, EXEMPLE), true)
  assert.equal(isEntryApplicable(GLOBAL, {}), true)
})

test('a university-scoped entry is hidden on other universities', () => {
  assert.equal(isEntryApplicable(RENNES_ONLY, RENNES), true)
  assert.equal(isEntryApplicable(RENNES_ONLY, EXEMPLE), false)
})

test('a feature-scoped entry needs every feature on', () => {
  assert.equal(isEntryApplicable(NEEDS_MAIL, RENNES), true)
  assert.equal(isEntryApplicable(NEEDS_MAIL, EXEMPLE), false)
  assert.equal(isEntryApplicable({ ...GLOBAL, features: ['grades'] }, EXEMPLE), false, "grades: 'disabled' is off")
  assert.equal(isEntryApplicable({ ...GLOBAL, features: ['mail', 'moodle'] }, { features: { mail: true } }), false)
  assert.equal(isEntryApplicable({ ...GLOBAL, features: ['weather'] }, RENNES), true)
})

test('universities and features together must both match', () => {
  const entry = { ...GLOBAL, universities: ['univ-exemple'], features: ['mail'] }
  assert.equal(isEntryApplicable(entry, RENNES), false)
  assert.equal(isEntryApplicable(entry, EXEMPLE), false)
  assert.equal(isEntryApplicable(entry, { ...EXEMPLE, features: { mail: true } }), true)
})

test('applicable entries come newest first, same-day ones in file order', () => {
  const entries = [GLOBAL, NEEDS_MAIL, RENNES_ONLY, NEW_GLOBAL]
  assert.deepEqual(getApplicableEntries(entries, RENNES).map((entry) => entry.id), ['new-global', 'mail', 'rennes', 'global'])
  assert.deepEqual(getApplicableEntries(entries, EXEMPLE).map((entry) => entry.id), ['new-global', 'global'])
})

test('first visit: no pill, and every current entry is stored as seen', () => {
  const entries = getApplicableEntries(ENTRIES, RENNES)
  const visit = resolveChangelogVisit({ entries, rawSeen: null })
  assert.equal(visit.firstVisit, true)
  assert.deepEqual(visit.unseenIds, [])
  assert.deepEqual([...parseSeenValue(visit.nextSeen)].sort(), ['global', 'mail', 'rennes'])

  // Next launch, nothing new: still no pill, nothing to write.
  const again = resolveChangelogVisit({ entries, rawSeen: visit.nextSeen })
  assert.deepEqual(again.unseenIds, [])
  assert.equal(again.nextSeen, null)
})

test('a returning device sees only the entries added since', () => {
  const rawSeen = JSON.stringify({ ids: ['global', 'rennes', 'mail'] })
  const entries = getApplicableEntries([NEW_GLOBAL, ...ENTRIES], RENNES)
  const visit = resolveChangelogVisit({ entries, rawSeen })
  assert.equal(visit.firstVisit, false)
  assert.deepEqual(visit.unseenIds, ['new-global'])
})

test('an entry added later on an already seen day still counts as unseen', () => {
  const sameDay = { id: 'same-day', date: '2026-10-05', title: '…', body: '…' }
  const rawSeen = JSON.stringify({ ids: ['global', 'rennes', 'mail'] })
  const visit = resolveChangelogVisit({ entries: getApplicableEntries([sameDay, ...ENTRIES], RENNES), rawSeen })
  assert.deepEqual(visit.unseenIds, ['same-day'])
})

test('the pill ignores entries that don’t apply here', () => {
  // A device at univ-exemple that has seen the global entry: new
  // Rennes-only and mail-only entries must not light its pill up.
  const rawSeen = JSON.stringify({ ids: ['global'] })
  const freshRennes = { ...RENNES_ONLY, id: 'rennes-2', date: '2026-11-01' }
  const freshMail = { ...NEEDS_MAIL, id: 'mail-2', date: '2026-11-01' }
  const all = [freshRennes, freshMail, ...ENTRIES]

  const exemple = resolveChangelogVisit({ entries: getApplicableEntries(all, EXEMPLE), allEntries: all, rawSeen })
  assert.deepEqual(exemple.unseenIds, [])

  const rennes = resolveChangelogVisit({ entries: getApplicableEntries(all, RENNES), allEntries: all, rawSeen })
  assert.deepEqual(rennes.unseenIds, ['rennes-2', 'mail-2', 'rennes', 'mail'])
})

test('opening the list marks everything seen and keeps earlier ids', () => {
  const all = [NEW_GLOBAL, ...ENTRIES]
  const rawSeen = JSON.stringify({ ids: ['global', 'rennes'] })
  const next = markAllSeen({ entries: getApplicableEntries(all, EXEMPLE), allEntries: all, rawSeen })
  assert.deepEqual([...parseSeenValue(next)].sort(), ['global', 'new-global', 'rennes'])
  assert.deepEqual(resolveChangelogVisit({ entries: getApplicableEntries(all, EXEMPLE), rawSeen: next }).unseenIds, [])
})

test('ids of removed entries are dropped from storage', () => {
  const rawSeen = JSON.stringify({ ids: ['gone', 'global'] })
  assert.deepEqual([...parseSeenValue(markAllSeen({ entries: [GLOBAL], rawSeen }))], ['global'])
})

test('unreadable stored values count as a first visit', () => {
  for (const raw of [null, '', 'oops', '{"ids":"nope"}', '[]', '"2026-10-12"']) {
    assert.equal(parseSeenValue(raw), null, raw)
    assert.equal(resolveChangelogVisit({ entries: ENTRIES, rawSeen: raw }).firstVisit, true)
  }
})

test('storage helpers survive a storage that throws', () => {
  const broken = {
    getItem() { throw new Error('denied') },
    setItem() { throw new Error('denied') },
  }
  assert.equal(readSeenValue(broken), null)
  assert.doesNotThrow(() => writeSeenValue('{}', broken))

  const storage = memoryStorage()
  writeSeenValue('{"ids":["global"]}', storage)
  assert.equal(storage.getItem(CHANGELOG_SEEN_KEY), '{"ids":["global"]}')
  assert.equal(readSeenValue(storage), '{"ids":["global"]}')
})

test('dates read like the rest of the app', () => {
  const now = new Date(2026, 9, 12)
  assert.equal(formatEntryDate('2026-10-12', now), '12 octobre')
  assert.equal(formatEntryDate('2026-08-01', now), '1er août')
  assert.equal(formatEntryDate('2025-12-24', now), '24 décembre 2025')
})

test('entries are grouped by consecutive day', () => {
  const groups = groupEntriesByDate(getApplicableEntries([NEW_GLOBAL, ...ENTRIES], RENNES))
  assert.deepEqual(groups.map((group) => [group.date, group.entries.length]), [
    ['2026-11-02', 1],
    ['2026-10-05', 2],
    ['2026-10-01', 1],
  ])
})

test('the shipped changelog is well formed', () => {
  const ids = new Set()
  for (const entry of CHANGELOG) {
    assert.match(entry.id, /^[a-z0-9-]+$/, entry.id)
    assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`)
    ids.add(entry.id)
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, entry.id)
    assert.ok(entry.title && entry.body, entry.id)
    assert.ok(!/'/.test(entry.title + entry.body), `${entry.id}: use ’ instead of '`)
    assert.ok(!/ [:!?»]/.test(entry.title + entry.body), `${entry.id}: narrow no-break space before : ! ? »`)
    if (entry.universities) assert.ok(Array.isArray(entry.universities), entry.id)
    if (entry.features) assert.ok(Array.isArray(entry.features), entry.id)
  }
})

test('the seed entries follow each university’s features', () => {
  const ids = (university) => getApplicableEntries(CHANGELOG, university).map((entry) => entry.id)
  const rennes = { id: 'univ-rennes', features: { ade: true, planning: true, moodle: true, grades: true, mail: true, moodleDeadlines: true, schoolCertificate: true } }
  const exemple = { id: 'univ-exemple', features: { ade: true, planning: true, moodle: false, grades: 'disabled', mail: false, moodleDeadlines: false } }

  const needAudience = CHANGELOG.filter((entry) => entry.audience).map((entry) => entry.id)
  assert.deepEqual(needAudience, ['messagerie', 'planning', 'simulateur-fluide', 'mes-notes'])
  assert.equal(ids(rennes).length, CHANGELOG.length - needAudience.length, 'all but the ones for « Mes notes » and the Planning, which need their audience')
  assert.ok(!ids(rennes).includes('mes-notes'))
  assert.ok(!ids(rennes).includes('planning'))
  assert.equal(getApplicableEntries(CHANGELOG, rennes, ['grades-page', 'planning-page', 'mail-page']).length, CHANGELOG.length)
  assert.ok(!ids(exemple).includes('mes-notes'))
  assert.ok(!ids(exemple).includes('certificat-de-scolarite'))
  assert.ok(!ids(exemple).includes('raccourcis-messagerie-moodle'))
  assert.ok(!ids(exemple).includes('accueil-compact-telephone'))
  assert.ok(ids(exemple).includes('applications'))
})

test('an entry with an audience only reaches students who have all of it', () => {
  const GRADES = { ...GLOBAL, id: 'notes', universities: ['univ-rennes'], audience: ['grades-page'] }
  assert.equal(isEntryApplicable(GRADES, RENNES), false, 'audience unknown yet: hidden')
  assert.equal(isEntryApplicable(GRADES, RENNES, ['grades-page']), true)
  assert.equal(isEntryApplicable(GRADES, EXEMPLE, ['grades-page']), false, 'still per university')
  assert.deepEqual(getApplicableEntries([GLOBAL, GRADES], RENNES).map((entry) => entry.id), [GLOBAL.id])
})

test('forgetSeen makes one entry unseen again, the others stay seen', () => {
  const entries = [{ id: 'a', date: '2026-10-01' }, { id: 'b', date: '2026-10-02' }]
  assert.equal(forgetSeen({ id: 'a', allEntries: entries, rawSeen: null }), null)
  assert.deepEqual(JSON.parse(forgetSeen({ id: 'a', allEntries: entries, rawSeen: '{"ids":["a","b"]}' })), { ids: ['b'] })
})

test('markEntrySeen adds one entry to what was seen, the others stay unseen', () => {
  const entries = [{ id: 'a', date: '2026-10-01' }, { id: 'b', date: '2026-10-02' }, { id: 'c', date: '2026-10-03' }]
  assert.equal(markEntrySeen({ id: 'a', allEntries: entries, rawSeen: null }), null, 'nothing usable stored: no write')
  assert.deepEqual(JSON.parse(markEntrySeen({ id: 'b', allEntries: entries, rawSeen: '{"ids":["a"]}' })), { ids: ['a', 'b'] })
  assert.deepEqual(JSON.parse(markEntrySeen({ id: 'a', allEntries: entries, rawSeen: '{"ids":["a"]}' })), { ids: ['a'] }, 'already seen: unchanged')
  const seenOnce = markEntrySeen({ id: 'c', allEntries: entries, rawSeen: '{"ids":["a"]}' })
  assert.deepEqual(resolveChangelogVisit({ entries, rawSeen: seenOnce }).unseenIds, ['b'])
})

test('the pill leaves spotlight entries to their own card', () => {
  const LAUNCH = { id: 'launch', date: '2026-10-16', title: 'Lancement', body: '…', spotlight: true }
  const entries = [LAUNCH, NEW_GLOBAL, GLOBAL]
  assert.deepEqual(getPillIds(entries, ['launch', 'new-global']), ['new-global'])
  assert.deepEqual(getPillIds(entries, ['launch']), [], 'only the spotlight one unseen: no pill')
  assert.deepEqual(getPillIds(entries, []), [])
  assert.deepEqual(getPillIds([GLOBAL], ['global']), ['global'])
})

test('the Messagerie, the Planning and « Mes notes » are the changelog’s spotlight entries', () => {
  assert.deepEqual(CHANGELOG.filter((entry) => entry.spotlight).map((entry) => entry.id), ['messagerie', 'planning', 'mes-notes'])
})

// The shipped entries, at a school with both pages (Rennes's features).
const RENNES_FULL = { id: 'univ-rennes', features: { ade: true, planning: true, moodle: true, grades: true, mail: true, moodleDeadlines: true, schoolCertificate: true } }
const BOTH_PAGES = ['grades-page', 'planning-page', 'mail-page']

test('the Planning’s launch only reaches students with the page', () => {
  const planning = CHANGELOG.find((entry) => entry.id === 'planning')
  assert.equal(isEntryApplicable(planning, RENNES_FULL), false, 'audience unknown yet (not signed in): hidden')
  assert.equal(isEntryApplicable(planning, RENNES_FULL, ['planning-page']), true, 'no « Mes notes » needed')
  assert.equal(isEntryApplicable(planning, { id: 'univ-exemple', features: { planning: true, grades: 'disabled' } }, ['planning-page']), true)
  assert.equal(isEntryApplicable(planning, { id: 'example-minimal', features: { planning: false } }, ['planning-page']), false, 'no planning feature: never')
})

test('the Messagerie’s launch only reaches students with the mail page', () => {
  const mail = CHANGELOG.find((entry) => entry.id === 'messagerie')
  assert.equal(isEntryApplicable(mail, RENNES_FULL), false, 'audience unknown yet (not signed in): hidden')
  assert.equal(isEntryApplicable(mail, RENNES_FULL, ['mail-page']), true)
  assert.equal(isEntryApplicable(mail, { id: 'example-minimal', features: { mail: false } }, ['mail-page']), false, 'no mail feature: never')
  assert.equal(isEntryApplicable(mail, RENNES_FULL, ['planning-page']), false, 'another page’s audience is not enough')
})

test('a fresh device records the launches as seen: no card, no tab mark', () => {
  const entries = getApplicableEntries(CHANGELOG, RENNES_FULL, BOTH_PAGES)
  const visit = resolveChangelogVisit({ entries, allEntries: CHANGELOG, rawSeen: null })
  assert.deepEqual(visit.unseenIds, [])
  assert.ok(parseSeenValue(visit.nextSeen).has('planning'))
  assert.equal(getLaunchId(entries, visit.unseenIds), null)
})

test('a device that saw everything before gets the Planning’s card, not the pill', () => {
  const entries = getApplicableEntries(CHANGELOG, RENNES_FULL, BOTH_PAGES)
  const rawSeen = JSON.stringify({ ids: CHANGELOG.map((entry) => entry.id).filter((id) => id !== 'planning') })
  const visit = resolveChangelogVisit({ entries, allEntries: CHANGELOG, rawSeen })
  assert.deepEqual(visit.unseenIds, ['planning'])
  assert.deepEqual(getPillIds(entries, visit.unseenIds), [])
  assert.equal(getLaunchId(entries, visit.unseenIds), 'planning')
  // Card closed or page visited: seen, nothing left to announce.
  const seen = markEntrySeen({ id: 'planning', allEntries: CHANGELOG, rawSeen })
  assert.deepEqual(resolveChangelogVisit({ entries, allEntries: CHANGELOG, rawSeen: seen }).unseenIds, [])
})

test('two unseen launches: one card at a time, the newest first, the next one on the next visit', () => {
  const entries = getApplicableEntries(CHANGELOG, RENNES_FULL, BOTH_PAGES)
  const rawSeen = JSON.stringify({ ids: CHANGELOG.map((entry) => entry.id).filter((id) => id !== 'planning' && id !== 'mes-notes') })
  const visit = resolveChangelogVisit({ entries, allEntries: CHANGELOG, rawSeen })
  assert.deepEqual(visit.unseenIds, ['planning', 'mes-notes'])
  assert.equal(getLaunchId(entries, visit.unseenIds), 'planning')

  // The Planning's card closed: « Mes notes » keeps its tab mark (still
  // unseen) but its card waits for the next visit.
  const held = getHeldLaunchIds(entries, visit.unseenIds, 'planning')
  assert.deepEqual(held, ['mes-notes'])
  const stillUnseen = visit.unseenIds.filter((id) => id !== 'planning')
  assert.equal(getLaunchId(entries, stillUnseen, held), null)

  const next = resolveChangelogVisit({ entries, allEntries: CHANGELOG, rawSeen: markEntrySeen({ id: 'planning', allEntries: CHANGELOG, rawSeen }) })
  assert.deepEqual(next.unseenIds, ['mes-notes'])
  assert.equal(getLaunchId(entries, next.unseenIds), 'mes-notes')
})

test('only spotlight entries get a card, and only unseen ones', () => {
  const LAUNCH = { id: 'launch', date: '2026-10-16', title: 'Lancement', body: '…', spotlight: true }
  const LATER = { id: 'later', date: '2026-10-20', title: 'Plus tard', body: '…', spotlight: true }
  const entries = getApplicableEntries([LAUNCH, NEW_GLOBAL, GLOBAL, LATER], RENNES)
  assert.equal(getLaunchId(entries, ['new-global', 'global']), null, 'no unseen launch: no card')
  assert.equal(getLaunchId(entries, ['launch', 'new-global']), 'launch')
  assert.equal(getLaunchId(entries, ['launch', 'later']), 'later', 'newest first')
  assert.equal(getLaunchId(entries, ['launch', 'later'], ['later']), 'launch', 'a held launch is skipped')
  assert.deepEqual(getHeldLaunchIds(entries, ['launch', 'later', 'new-global'], 'later'), ['launch'], 'the pill’s entries are never held')
  assert.deepEqual(getHeldLaunchIds(entries, ['later'], 'later'), [])
})
