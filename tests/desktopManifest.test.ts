import assert from 'node:assert/strict'
import test from 'node:test'
import { compareVersions, parseDesktopManifest } from '../scripts/desktopManifest.ts'

const MANIFEST = {
  version: '0.26.0',
  minimum: '0.24.0',
  pub_date: '2026-11-20T09:00:00Z',
  notes: '',
  platforms: {
    'darwin-aarch64': {
      url: 'https://example.org/Tafac_0.26.0_aarch64.app.tar.gz',
      signature: 'c2lnbmF0dXJl',
      installer: 'https://example.org/Tafac_0.26.0_aarch64.dmg',
    },
    'darwin-x86_64': {
      url: 'https://example.org/Tafac_0.26.0_x64.app.tar.gz',
      signature: 'c2lnbmF0dXJl',
    },
  },
}

function reason(manifest: unknown): string | null {
  const parsed = parseDesktopManifest(JSON.stringify(manifest))
  return 'error' in parsed ? parsed.error : null
}

test('versions compare by their numbers', () => {
  assert.equal(compareVersions('0.26.0', '0.26.0'), 0)
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1)
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1)
})

test('a manifest the apps can read is served as published', () => {
  const text = JSON.stringify(MANIFEST, null, 2)
  const parsed = parseDesktopManifest(text)
  assert.ok(!('error' in parsed))
  assert.equal(parsed.text, text)
  assert.equal(parsed.version, '0.26.0')
  assert.deepEqual([...parsed.installers], [['darwin-aarch64', 'https://example.org/Tafac_0.26.0_aarch64.dmg']])
  // `minimum`, the date, the notes and the installers are optional.
  assert.equal(reason({ version: '0.26.0', platforms: { 'darwin-aarch64': { url: 'https://example.org/a', signature: 's' } } }), null)
})

test('a manifest that would break the apps is not served', () => {
  assert.equal('error' in parseDesktopManifest('{'), true)
  assert.equal('error' in parseDesktopManifest('[]'), true)
  assert.match(reason({ ...MANIFEST, version: 'v0.26.0' }) ?? '', /version/)
  assert.match(reason({ ...MANIFEST, minimum: '0.24' }) ?? '', /minimum/)
  // Nothing on offer would get an install past it.
  assert.match(reason({ ...MANIFEST, minimum: '0.27.0' }) ?? '', /above/)
  assert.match(reason({ ...MANIFEST, pub_date: '20 novembre 2026' }) ?? '', /pub_date/)
  assert.match(reason({ ...MANIFEST, platforms: {} }) ?? '', /platforms/)
  assert.match(reason({ ...MANIFEST, platforms: { 'darwin-aarch64': { url: 'http://example.org/a', signature: 's' } } }) ?? '', /https/)
  assert.match(reason({ ...MANIFEST, platforms: { 'darwin-aarch64': { url: 'https://example.org/a' } } }) ?? '', /signature/)
  assert.match(reason({ ...MANIFEST, platforms: { 'darwin-aarch64': { url: 'https://example.org/a', signature: 's', installer: 'javascript:alert(1)' } } }) ?? '', /installer/)
})

