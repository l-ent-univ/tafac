import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { CHANGELOG } from '../src/changelog.js'
import {
  ANNOUNCEMENT_MAX_AGE_DAYS,
  SHOWCASE_TABS,
  listShowcaseTabs,
  pickShowcaseAnnouncement,
  showcaseTabId,
} from '../src/landingShowcase.js'

const COPY = JSON.parse(readFileSync(new URL('../src/landingCopy.json', import.meta.url), 'utf8'))

const NEUTRAL = { id: null, neutral: true, features: { demo: true } }
const RENNES = { id: 'univ-rennes', features: { ade: true, planning: true, grades: true, mail: true, moodleDeadlines: true }, mail: {} }
// Shaped like univ-exemple: grades greyed out, no mail, no Moodle.
const EXEMPLE = { id: 'univ-exemple', features: { ade: true, planning: true, grades: 'disabled', mail: false, moodleDeadlines: false } }
// Mail as the webmail's link only (mail.page: false): no Messagerie page.
const WEBMAIL_ONLY = { id: 'univ-x', features: { ade: true, planning: true, mail: true }, mail: { page: false } }

const ids = (tabs) => tabs.map((tab) => tab.id)

test('the neutral page shows every page of the app, every item', () => {
  const tabs = listShowcaseTabs(NEUTRAL)
  assert.deepEqual(ids(tabs), ['accueil', 'mes-notes', 'planning', 'messagerie'])
  for (const tab of tabs) assert.deepEqual(tab.items, tab.itemFeatures.map((_, index) => index))
})

test('a university page shows only what it has', () => {
  assert.deepEqual(ids(listShowcaseTabs(RENNES)), ['accueil', 'mes-notes', 'planning', 'messagerie'])
  const exemple = listShowcaseTabs(EXEMPLE)
  assert.deepEqual(ids(exemple), ['accueil', 'planning'])
  // Neither the mails' nor the deadlines' card on its home, nor a mail
  // about a class.
  const home = exemple.find((tab) => tab.id === 'accueil')
  assert.deepEqual(home.items.map((index) => COPY.showcase.tabs.home.items[index].title), ['Résumé du jour', 'Prochain cours', 'Toutes les applications'])
  const planning = exemple.find((tab) => tab.id === 'planning')
  assert.ok(!planning.items.some((index) => /Écrire/.test(COPY.showcase.tabs.planning.items[index].title)))
})

test('the webmail link alone is no Messagerie page', () => {
  assert.deepEqual(ids(listShowcaseTabs(WEBMAIL_ONLY)), ['accueil', 'planning'])
})

test('every tab has its copy: as many items as icons and features', () => {
  for (const tab of SHOWCASE_TABS) {
    const text = COPY.showcase.tabs[tab.key]
    assert.ok(text, tab.key)
    for (const field of ['label', 'shortLabel', 'title', 'intro', 'previewLabel']) assert.ok(text[field], `${tab.key}.${field}`)
    assert.equal(text.items.length, tab.itemIcons.length, tab.key)
    assert.equal(text.items.length, tab.itemFeatures.length, tab.key)
  }
})

test('the copy says things plainly: no trailing full stop on a line', () => {
  for (const tab of Object.values(COPY.showcase.tabs)) {
    for (const item of tab.items) assert.doesNotMatch(item.body, /\.$/, item.body)
    assert.doesNotMatch(tab.intro, /\.$/)
  }
})

test('the announcement: the latest launch with a tab here, while recent', () => {
  const tabs = listShowcaseTabs(NEUTRAL)
  const now = new Date(2026, 9, 29)
  assert.deepEqual(pickShowcaseAnnouncement({ config: NEUTRAL, tabs, now }), {
    id: 'messagerie',
    tabId: 'messagerie',
    title: CHANGELOG.find((entry) => entry.id === 'messagerie').title,
  })
  // Without the Messagerie, the launch before it.
  const exemple = listShowcaseTabs(EXEMPLE)
  assert.equal(pickShowcaseAnnouncement({ config: EXEMPLE, tabs: exemple, now })?.tabId, 'planning')
  // Too old: nothing.
  const later = new Date(2026, 9, 28 + ANNOUNCEMENT_MAX_AGE_DAYS + 1)
  assert.equal(pickShowcaseAnnouncement({ config: NEUTRAL, tabs, now: later }), null)
})

test('the announcement keeps to its university and never comes early', () => {
  const entries = [
    { id: 'mes-notes', date: '2026-10-20', title: 'Notes', spotlight: true, universities: ['univ-rennes'] },
    { id: 'planning', date: '2026-10-10', title: 'Planning', spotlight: true },
    { id: 'messagerie', date: '2026-11-02', title: 'Plus tard', spotlight: true },
    { id: 'autre', date: '2026-10-25', title: 'Pas une page', spotlight: true },
  ]
  const now = new Date(2026, 9, 29)
  const other = { id: 'univ-x', features: { ade: true, planning: true, grades: true }, mail: {} }
  assert.equal(pickShowcaseAnnouncement({ config: other, tabs: listShowcaseTabs(other), now, entries })?.id, 'planning')
  assert.equal(pickShowcaseAnnouncement({ config: RENNES, tabs: listShowcaseTabs(RENNES), now, entries })?.id, 'mes-notes')
  assert.equal(pickShowcaseAnnouncement({ config: NEUTRAL, tabs: [], now, entries }), null)
})

test('tabs and panels have ids of their own', () => {
  const tabIds = SHOWCASE_TABS.map((tab) => showcaseTabId(tab.id))
  assert.equal(new Set([...tabIds, ...ids(SHOWCASE_TABS)]).size, SHOWCASE_TABS.length * 2)
})
