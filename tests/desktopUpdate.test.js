import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeChecked,
  describeDownload,
  describeSize,
  describeUpdateNote,
  downloadProgress,
  parseUpdateState,
} from '../src/desktopUpdate.js'

const MEGABYTE = 1024 * 1024

test('the app\'s state is read in the shapes the page counts on', () => {
  assert.deepEqual(
    parseUpdateState({ current: '0.25.0', phase: 'downloading', version: '0.26.0', required: true, downloaded: 10, total: 100, failed: false, download: 'https://example.org/Tafac.dmg', enabled: true, checking: true, checked: 1_800_000_000_000 }),
    { current: '0.25.0', phase: 'downloading', version: '0.26.0', required: true, downloaded: 10, total: 100, failed: false, download: 'https://example.org/Tafac.dmg', enabled: true, checking: true, checked: 1_800_000_000_000 },
  )
  // Nothing announced: no version, no size, nothing required.
  assert.deepEqual(
    parseUpdateState({ current: '0.25.0', phase: 'idle', version: null, required: false, downloaded: 0, total: null, failed: false, download: null, enabled: false, checking: false, checked: null }),
    { current: '0.25.0', phase: 'idle', version: null, required: false, downloaded: 0, total: null, failed: false, download: null, enabled: false, checking: false, checked: null },
  )
  // An app from before `enabled`, `checking` and `checked`: it looks for
  // updates, nothing under way, no check known.
  const older = parseUpdateState({ current: '0.25.0', phase: 'idle' })
  assert.equal(older.enabled, true)
  assert.equal(older.checking, false)
  assert.equal(older.checked, null)
})

test('the last check reads as a short while ago', () => {
  const now = Date.UTC(2026, 10, 14, 18, 0)
  assert.equal(describeChecked(null, now), null)
  assert.equal(describeChecked(now - 20 * 1000, now), 'à l’instant')
  assert.equal(describeChecked(now - 5 * 60 * 1000, now), 'il y a 5\u00a0min')
  assert.equal(describeChecked(now - 3 * 60 * 60 * 1000, now), 'il y a 3\u00a0h')
  assert.equal(describeChecked(Date.UTC(2026, 10, 12, 12, 0), now), 'le 12 novembre')
  // A clock set back: never « il y a -2 min ».
  assert.equal(describeChecked(now + 2 * 60 * 1000, now), 'à l’instant')
})

test('what isn\'t a state is no state, and only a clear yes blocks', () => {
  assert.equal(parseUpdateState(null), null)
  assert.equal(parseUpdateState('ready'), null)
  assert.equal(parseUpdateState({ phase: 'ready' }), null)
  assert.equal(parseUpdateState({ current: '0.25.0', phase: 'exploding' }), null)
  const loose = parseUpdateState({ current: '0.25.0', phase: 'ready', required: 'yes', failed: 1, downloaded: -4, total: 'big', download: 'http://example.org/Tafac.dmg' })
  assert.equal(loose.required, false)
  assert.equal(loose.failed, false)
  assert.equal(loose.downloaded, 0)
  assert.equal(loose.total, null)
  // Only an https address is offered to the student.
  assert.equal(loose.download, null)
})

test('sizes are whole megabytes', () => {
  assert.equal(describeSize(81 * MEGABYTE), '81 Mo')
  assert.equal(describeSize(81.4 * MEGABYTE), '81 Mo')
  assert.equal(describeDownload({ downloaded: 34 * MEGABYTE, total: 81 * MEGABYTE }), '34 Mo sur 81 Mo')
  // The size isn't known yet, or the count ran past it.
  assert.equal(describeDownload({ downloaded: 34 * MEGABYTE, total: null }), '34 Mo')
  assert.equal(describeDownload({ downloaded: 90 * MEGABYTE, total: 81 * MEGABYTE }), '81 Mo sur 81 Mo')
})

test('the bar follows the download', () => {
  assert.equal(downloadProgress({ downloaded: 0, total: 100 }), 0)
  assert.equal(downloadProgress({ downloaded: 25, total: 100 }), 0.25)
  assert.equal(downloadProgress({ downloaded: 150, total: 100 }), 1)
  assert.equal(downloadProgress({ downloaded: 50, total: null }), 0)
})

test('the menu\'s answer is one short line', () => {
  assert.equal(describeUpdateNote({ kind: 'current', version: '0.25.0' }), 'Tafac est à jour · 0.25.0')
  assert.equal(describeUpdateNote({ kind: 'downloading', version: '0.26.0' }), 'Téléchargement de Tafac 0.26.0')
  assert.equal(describeUpdateNote({ kind: 'ready', version: '0.26.0' }), 'Mise à jour prête · 0.26.0')
  assert.equal(describeUpdateNote({ kind: 'unreachable' }), 'Impossible de rechercher les mises à jour')
  assert.equal(describeUpdateNote({ kind: 'other' }), null)
  assert.equal(describeUpdateNote(undefined), null)
})
