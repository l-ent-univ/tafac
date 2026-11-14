import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import { compareVersions, createDesktopUpdateRouter, createManifestSource, parseDesktopManifest } from '../server/desktopUpdate/index.ts'

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

test('the manifest comes from the file, read again when it changes, else from the environment', () => {
  const reports: string[] = []
  const report = (message: string) => reports.push(message)

  assert.equal(createManifestSource({}, report)(), null)
  assert.equal(createManifestSource({ DESKTOP_LATEST_JSON: JSON.stringify(MANIFEST) }, report)()?.version, '0.26.0')
  assert.equal(createManifestSource({ DESKTOP_LATEST_JSON: '{"version":"nope"}' }, report)(), null)
  assert.equal(reports.length, 1)

  const folder = mkdtempSync(path.join(tmpdir(), 'tafac-desktop-'))
  const file = path.join(folder, 'latest.json')
  try {
    const current = createManifestSource({ DESKTOP_LATEST_FILE: file, DESKTOP_LATEST_JSON: '{}' }, report)
    assert.equal(current(), null)

    writeFileSync(file, JSON.stringify(MANIFEST))
    utimesSync(file, new Date(1_000_000), new Date(1_000_000))
    assert.equal(current()?.version, '0.26.0')

    writeFileSync(file, JSON.stringify({ ...MANIFEST, version: '0.27.0' }))
    utimesSync(file, new Date(2_000_000), new Date(2_000_000))
    assert.equal(current()?.version, '0.27.0')

    // A broken publish is taken back, not served.
    writeFileSync(file, '{ "version": ')
    utimesSync(file, new Date(3_000_000), new Date(3_000_000))
    assert.equal(current(), null)

    rmSync(file)
    assert.equal(current(), null)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('tafac.fr serves the manifest and sends to the installers', async () => {
  const text = JSON.stringify(MANIFEST)
  const app = express()
  app.use(createDesktopUpdateRouter({ DESKTOP_LATEST_JSON: text }, () => {}))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const manifest = await fetch(`${origin}/desktop/latest.json`)
    assert.equal(manifest.status, 200)
    assert.match(manifest.headers.get('content-type') ?? '', /^application\/json/)
    assert.equal(manifest.headers.get('cache-control'), 'no-cache')
    assert.equal(await manifest.text(), text)

    const installer = await fetch(`${origin}/desktop/download/darwin-aarch64`, { redirect: 'manual' })
    assert.equal(installer.status, 302)
    assert.equal(installer.headers.get('location'), 'https://example.org/Tafac_0.26.0_aarch64.dmg')

    assert.equal((await fetch(`${origin}/desktop/download/darwin-x86_64`, { redirect: 'manual' })).status, 404)
    assert.equal((await fetch(`${origin}/desktop/download/windows-x86_64`, { redirect: 'manual' })).status, 404)
  } finally {
    server.close()
  }
})

test('without a manifest, the apps get no answer', async () => {
  const app = express()
  app.use(createDesktopUpdateRouter({}, () => {}))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    assert.equal((await fetch(`${origin}/desktop/latest.json`)).status, 404)
    assert.equal((await fetch(`${origin}/desktop/download/darwin-aarch64`, { redirect: 'manual' })).status, 404)
  } finally {
    server.close()
  }
})
