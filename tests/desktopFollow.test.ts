import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { followOnce, followReleases } from '../server/desktopUpdate/index.ts'

const FROM = 'https://github.com/l-ent-univ/tafac/releases/latest/download/latest.json'

function manifest(version: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version,
    pub_date: '2026-11-20T09:00:00Z',
    platforms: {
      'darwin-aarch64': { url: `https://example.org/Tafac_${version}_aarch64.app.tar.gz`, signature: 'c2ln' },
    },
    ...extra,
  })
}

// A GitHub that answers `body` with `status`, or doesn't answer at all.
function github(status: number | 'down', body = ''): typeof fetch {
  return (async () => {
    if (status === 'down') throw new TypeError('fetch failed')
    return new Response(body, { status })
  }) as typeof fetch
}

function withFolder(run: (file: string, messages: string[]) => Promise<void>) {
  return async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'tafac-follow-'))
    try {
      await run(path.join(folder, 'data', 'desktop-latest.json'), [])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }
}

test('a new release\'s manifest is published, once', withFolder(async (file, messages) => {
  const report = (message: string) => messages.push(message)
  assert.equal(await followOnce({ from: FROM, file }, { fetchManifest: github(200, manifest('0.26.0')), report }), 'published')
  assert.equal(readFileSync(file, 'utf8'), manifest('0.26.0'))
  assert.deepEqual(messages, ['Desktop update manifest: 0.26.0 published'])
  assert.equal(existsSync(`${file}.next`), false)
  // The same again: nothing written, nothing said.
  assert.equal(await followOnce({ from: FROM, file }, { fetchManifest: github(200, manifest('0.26.0')), report }), 'unchanged')
  assert.equal(messages.length, 1)
}))

test('without a manifest on the release, or without GitHub, what is served stays', withFolder(async (file) => {
  await followOnce({ from: FROM, file }, { fetchManifest: github(200, manifest('0.25.0')), report: () => {} })
  // The newest release's desktop build failed or is still running: 404.
  assert.equal(await followOnce({ from: FROM, file }, { fetchManifest: github(404) }), 'none')
  assert.equal(await followOnce({ from: FROM, file }, { fetchManifest: github('down') }), 'none')
  assert.equal(readFileSync(file, 'utf8'), manifest('0.25.0'))
}))

test('a manifest that would break the apps is never published', withFolder(async (file, messages) => {
  const report = (message: string) => messages.push(message)
  await followOnce({ from: FROM, file }, { fetchManifest: github(200, manifest('0.25.0')), report })
  const lockout = manifest('0.26.0', { minimum: '0.27.0' })
  assert.equal(await followOnce({ from: FROM, file }, { fetchManifest: github(200, lockout), report }), 'refused')
  assert.equal(await followOnce({ from: FROM, file }, { fetchManifest: github(200, '<html>'), report }), 'refused')
  assert.equal(readFileSync(file, 'utf8'), manifest('0.25.0'))
  assert.match(messages[1], /not published: "minimum" is above "version"/)
}))

test('an older release\'s manifest comes back when the newest is deleted', withFolder(async (file) => {
  await followOnce({ from: FROM, file }, { fetchManifest: github(200, manifest('0.26.0')), report: () => {} })
  assert.equal(await followOnce({ from: FROM, file }, { fetchManifest: github(200, manifest('0.25.0')), report: () => {} }), 'published')
  assert.equal(readFileSync(file, 'utf8'), manifest('0.25.0'))
}))

test('following needs DESKTOP_LATEST_FILE, and stops when pinned', async () => {
  let asked = 0
  const counting = (async () => {
    asked += 1
    return new Response('', { status: 404 })
  }) as typeof fetch
  const messages: string[] = []
  const report = (message: string) => messages.push(message)

  followReleases({}, { fetchManifest: counting, report, firstAfter: 0 })()
  const stopPinned = followReleases({ DESKTOP_LATEST_FILE: '/tmp/x.json', DESKTOP_LATEST_PIN: '1' }, { fetchManifest: counting, report, firstAfter: 0 })
  await new Promise((resolve) => setTimeout(resolve, 20))
  stopPinned()
  assert.equal(asked, 0)
  assert.deepEqual(messages, ['Desktop update manifest pinned (DESKTOP_LATEST_PIN): not following the releases'])

  // Set: GitHub is asked, at the default address unless another is given.
  const urls: string[] = []
  const recording = (async (url: string) => {
    urls.push(url)
    return new Response('', { status: 404 })
  }) as typeof fetch
  const stop = followReleases({ DESKTOP_LATEST_FILE: '/tmp/x.json' }, { fetchManifest: recording, firstAfter: 0, every: 5 })
  await new Promise((resolve) => setTimeout(resolve, 40))
  stop()
  assert.ok(urls.length >= 2)
  assert.equal(urls[0], FROM)
})
