import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DEVICE_FEATURES, SHOWCASE_TABS, listDeviceFeatures, listShowcaseTabs, showcaseTabId } from '../src/landingShowcase.js'

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
  assert.deepEqual(home.items, [0, 1, 4])
  const planning = exemple.find((tab) => tab.id === 'planning')
  assert.deepEqual(planning.items, [0, 2, 3])
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

test('the device section claims only what the university has', () => {
  assert.deepEqual(listDeviceFeatures(NEUTRAL), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(listDeviceFeatures(RENNES), [0, 1, 2, 3, 4, 5])
  // Grades greyed out, no mail, no Moodle.
  assert.deepEqual(listDeviceFeatures(EXEMPLE), [0, 1, 5])
  // No Messagerie page: no « Réponds aux mails de la fac ».
  assert.deepEqual(listDeviceFeatures(WEBMAIL_ONLY), [0, 1, 5])
  assert.equal(COPY.features.items.length, DEVICE_FEATURES.length)
})

test('tabs and panels have ids of their own', () => {
  const tabIds = SHOWCASE_TABS.map((tab) => showcaseTabId(tab.id))
  assert.equal(new Set([...tabIds, ...ids(SHOWCASE_TABS)]).size, SHOWCASE_TABS.length * 2)
})
