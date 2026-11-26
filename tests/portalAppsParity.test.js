// The gateway answers GET /__ent_auth/apps through tonAPI for the portals
// this server reads itself too (Drupal: Rennes 2; iSorbonne: Sorbonne
// Nouvelle), once those universities are switched on there. Until then, and
// after, the list must be the same one: the pages of the gateway's made-up
// campuses (back/crates/tafac-gateway/src/testing/pages/) are read here by
// this server's own parsers, and compared with the list the gateway's tests
// compare tonAPI's with (tests/other_portals.rs there).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildPortalApps,
  isPortalSignedInPage,
  parseDrupalProfileName,
  parseDrupalToolCatalogue,
  parseIsorbonneCatalogue,
  parseIsorbonneName,
} from '../server/portalSession.js'

const ORIGIN = 'http://127.0.0.1:8080'
const page = (name) => readFileSync(new URL(`../back/crates/tafac-gateway/src/testing/pages/${name}`, import.meta.url), 'utf8')
const expectedApps = (name) => JSON.parse(page(name).replaceAll('{origin}', ORIGIN))
const STUDENT = { name: 'Jeanne Doe', given_name: 'Jeanne', family_name: 'Doe' }

test('the Drupal campus page gives this server the list the gateway gives', () => {
  const html = page('drupal-tools.html')
  assert.equal(isPortalSignedInPage('drupal', 200, html), true)
  assert.deepEqual(buildPortalApps(parseDrupalToolCatalogue(html, ORIGIN)), expectedApps('drupal-apps.json'))
})

test('the Drupal campus profile page names the student as the gateway does', () => {
  const html = page('drupal-user.html')
  assert.equal(isPortalSignedInPage('drupal', 200, html), true)
  assert.deepEqual(parseDrupalProfileName(html), STUDENT)
})

test('the iSorbonne campus page gives this server the list and the name the gateway gives', () => {
  const html = page('isorbonne-home.html')
  assert.equal(isPortalSignedInPage('isorbonne', 200, html), true)
  assert.deepEqual(buildPortalApps(parseIsorbonneCatalogue(html, ORIGIN)), expectedApps('isorbonne-apps.json'))
  assert.deepEqual(parseIsorbonneName(html), STUDENT)
})
