import assert from 'node:assert/strict'
import test from 'node:test'
import { getMailAddressDomain, isOwnMailDomain, resolveOwnMailDomains } from '../src/mailDomain.js'

test('a sender address gives its domain', () => {
  assert.equal(getMailAddressDomain('Thomas.Lemoine@Univ-Rennes.fr'), 'univ-rennes.fr')
  assert.equal(getMailAddressDomain(' x@etudiant.univ-rennes.fr. '), 'etudiant.univ-rennes.fr')
  // The last @ is the one that counts.
  assert.equal(getMailAddressDomain('"a@univ-rennes.fr"@evil.example'), 'evil.example')
  for (const value of ['', null, undefined, 'no-at-all', '@evil.example']) {
    assert.equal(getMailAddressDomain(value), '', String(value))
  }
})

test('own domains match themselves and their sub-domains only', () => {
  const own = ['univ-rennes.fr', 'univ-rennes2.fr']
  for (const domain of ['univ-rennes.fr', 'etudiant.univ-rennes.fr', 'listes.etudiant.univ-rennes.fr', 'univ-rennes2.fr', 'webmail.etudiant.univ-rennes2.fr']) {
    assert.ok(isOwnMailDomain(domain, own), domain)
  }
  for (const domain of ['evil.example', 'univ-rennes.fr.evil.example', 'evil-univ-rennes.fr', 'xuniv-rennes.fr', 'univ-rennes1.fr', 'univ-rennes.com', '']) {
    assert.ok(!isOwnMailDomain(domain, own), domain)
  }
  assert.ok(!isOwnMailDomain('univ-rennes.fr', []))
})

test('own domains come from the config, else from its origins', () => {
  assert.deepEqual(
    resolveOwnMailDomains({ mail: { ownDomains: ['Univ-Rennes.fr', 'univ-rennes1.fr.', 'univ-rennes.fr'] }, origins: { ent: 'https://other.example' } }),
    ['univ-rennes.fr', 'univ-rennes1.fr'],
  )
  assert.deepEqual(
    resolveOwnMailDomains({ origins: { ent: 'https://services-numeriques.univ-rennes.fr', cas: 'https://sso-cas.univ-rennes.fr', moodle: 'https://foad.univ-rennes.fr', bad: 'not a url' } }),
    ['univ-rennes.fr'],
  )
  assert.deepEqual(resolveOwnMailDomains({ origins: { ent: 'http://127.0.0.1:5173', dev: 'http://localhost' } }), [])
  assert.deepEqual(resolveOwnMailDomains({}), [])
  assert.deepEqual(resolveOwnMailDomains(null), [])
})
