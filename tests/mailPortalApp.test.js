import assert from 'node:assert/strict'
import test from 'node:test'
import { getMailOrigins, isMailPortalApp, opensMailPageInApp } from '../src/mailPortalApp.js'

const options = {
  mailOrigins: getMailOrigins(['https://webmail.univ-rennes2.fr/', 'https://webmail.etudiant.univ-rennes2.fr', 'https://webmail.univ-rennes2.fr/x', 'pas une url']),
  appKeys: ['demo-messagerie'],
  launchPath: '/__ent_auth/launch',
  casOrigin: 'https://cas.example.fr',
  base: 'https://tafac.fr/',
}

test('getMailOrigins keeps each origin once and drops what isn’t a URL', () => {
  assert.deepEqual(options.mailOrigins, ['https://webmail.univ-rennes2.fr', 'https://webmail.etudiant.univ-rennes2.fr'])
  assert.deepEqual(getMailOrigins(null), [])
})

test('the webmail’s app is told by its link, wrapped or not', () => {
  assert.equal(isMailPortalApp({ href: 'https://webmail.univ-rennes2.fr/' }, options), true)
  assert.equal(isMailPortalApp({ href: 'https://webmail.etudiant.univ-rennes2.fr/zimbra/' }, options), true)
  assert.equal(isMailPortalApp({ href: '/__ent_auth/launch?url=https%3A%2F%2Fwebmail.univ-rennes2.fr%2F' }, options), true)
  assert.equal(isMailPortalApp({ href: 'https://cas.example.fr/login?service=https%3A%2F%2Fwebmail.univ-rennes2.fr%2F' }, options), true)
  // Its resolved launch link, the portal's own being the ENT's.
  assert.equal(isMailPortalApp({ href: '/__ent_proxy/app/42' }, { ...options, resolvedHref: 'https://webmail.univ-rennes2.fr/' }), true)
  assert.equal(isMailPortalApp({ fname: 'demo-messagerie', href: 'https://outlook.office.com/mail/' }, options), true)
})

test('other apps aren’t the webmail, whatever their title', () => {
  assert.equal(isMailPortalApp({ title: 'Messagerie', href: 'https://outlook.office.com/mail/' }, options), false)
  assert.equal(isMailPortalApp({ href: 'https://moodle.univ-rennes2.fr/' }, options), false)
  assert.equal(isMailPortalApp(null, options), false)
})

test('opensMailPageInApp only with the mail page', () => {
  const app = { href: 'https://webmail.univ-rennes2.fr/' }
  assert.equal(opensMailPageInApp(app, { ...options, hasMailPage: true }), true)
  assert.equal(opensMailPageInApp(app, { ...options, hasMailPage: false }), false)
})
