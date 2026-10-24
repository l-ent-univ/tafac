import assert from 'node:assert/strict'
import test from 'node:test'
import { getPapillonUrl, readPapillonDebugOverride } from '../src/papillon.js'
import { branding as rennesBranding } from '../universities/univ-rennes/shared.js'
import { branding as exempleBranding } from '../universities/univ-exemple/shared.js'
import { branding as minimalBranding } from '../universities/example-minimal/shared.js'

test('getPapillonUrl returns the link of branding.papillon', () => {
  assert.equal(getPapillonUrl({ papillon: { url: 'https://papillon.bzh' } }), 'https://papillon.bzh')
})

test('getPapillonUrl is null without the block, so every mention hides', () => {
  assert.equal(getPapillonUrl({}), null)
  assert.equal(getPapillonUrl(undefined), null)
  assert.equal(getPapillonUrl({ papillon: null }), null)
  assert.equal(getPapillonUrl({ papillon: false }), null)
  assert.equal(getPapillonUrl({ papillon: {} }), null)
})

test('getPapillonUrl ignores a link that is not https', () => {
  assert.equal(getPapillonUrl({ papillon: { url: 'javascript:alert(1)' } }), null)
  assert.equal(getPapillonUrl({ papillon: { url: 'http://papillon.bzh' } }), null)
})

test('Papillon is on for the Tafac instances, off for the fork template', () => {
  assert.equal(getPapillonUrl(rennesBranding), 'https://papillon.bzh')
  assert.equal(getPapillonUrl(exempleBranding), 'https://papillon.bzh')
  assert.equal(getPapillonUrl(minimalBranding), null)
})

test('the debug override forces the switch either way', () => {
  const on = { papillon: { url: 'https://papillon.bzh' } }
  assert.equal(getPapillonUrl(on, 'off'), null)
  assert.equal(getPapillonUrl(on, 'on'), 'https://papillon.bzh')
  assert.equal(getPapillonUrl({}, 'on'), 'https://papillon.bzh')
  assert.equal(getPapillonUrl({}, null), null)
})

test('the debug override is ignored outside the dev server', () => {
  assert.equal(readPapillonDebugOverride(), null)
})
