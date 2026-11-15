import assert from 'node:assert/strict'
import test from 'node:test'
import { getMoodleOrigin, isMoodlePortalApp, opensMoodlePageInApp } from '../src/moodlePortalApp.js'

const options = {
  moodleOrigin: getMoodleOrigin('https://foad.univ-rennes.fr'),
  launchPath: '/__ent_auth/launch',
  casOrigin: 'https://sso-cas.univ-rennes.fr',
  base: 'tafac://localhost/',
}

test('Moodle’s app is told by its link, wrapped or not', () => {
  assert.equal(isMoodlePortalApp({ href: 'https://foad.univ-rennes.fr' }, options), true)
  assert.equal(isMoodlePortalApp({ href: 'https://foad.univ-rennes.fr/my/' }, options), true)
  assert.equal(isMoodlePortalApp({ href: '/__ent_auth/launch?url=https%3A%2F%2Ffoad.univ-rennes.fr%2Fmy%2F' }, options), true)
  assert.equal(isMoodlePortalApp({ href: 'https://sso-cas.univ-rennes.fr/login?service=https%3A%2F%2Ffoad.univ-rennes.fr%2F' }, options), true)
  // Its resolved launch link, the portal's own being the ENT's.
  assert.equal(isMoodlePortalApp({ href: '/__ent_proxy/app/42' }, { ...options, resolvedHref: 'https://foad.univ-rennes.fr/' }), true)
})

test('other apps aren’t Moodle, whatever their title', () => {
  assert.equal(isMoodlePortalApp({ title: 'Moodle', href: 'https://moodle.org/' }, options), false)
  assert.equal(isMoodlePortalApp({ href: 'https://foad.univ-rennes.fr.evil.example/' }, options), false)
  assert.equal(isMoodlePortalApp(null, options), false)
  // A university without Moodle.
  assert.equal(isMoodlePortalApp({ href: 'https://foad.univ-rennes.fr' }, { ...options, moodleOrigin: getMoodleOrigin(null) }), false)
})

test('opensMoodlePageInApp only where Moodle is a page of the app', () => {
  const app = { href: 'https://foad.univ-rennes.fr' }
  assert.equal(opensMoodlePageInApp(app, { ...options, hasMoodlePage: true }), true)
  assert.equal(opensMoodlePageInApp(app, { ...options, hasMoodlePage: false }), false)
  assert.equal(opensMoodlePageInApp(app, options), false)
})
