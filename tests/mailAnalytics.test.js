import assert from 'node:assert/strict'
import test from 'node:test'
import { MAIL_PAGE_SOURCES, createSearchReporter, describeMailLoad, getAttachmentsBucket, toComposeKind, toFolderKind, toMailVia, toRemoveAction } from '../src/mailAnalytics.js'

test('the first list: loading reports nothing, then ok, empty, error or session_expired', () => {
  assert.equal(describeMailLoad({ status: 'loading' }), null)
  assert.equal(describeMailLoad({ status: 'disabled' }), null)
  assert.deepEqual(describeMailLoad({ status: 'ok', messageCount: 12 }), { status: 'ok' })
  assert.deepEqual(describeMailLoad({ status: 'ok', messageCount: 0 }), { status: 'empty' })
  assert.deepEqual(describeMailLoad({ status: 'unauthenticated' }), { status: 'session_expired' })
  assert.deepEqual(describeMailLoad({ status: 'error', errorKind: 'timeout' }), { status: 'error', errorKind: 'timeout' })
  assert.deepEqual(describeMailLoad({ status: 'error', errorKind: 'weird' }), { status: 'error', errorKind: 'other' })
})

test('folders, composers and actions are named by enum, never by what they hold', () => {
  assert.equal(toFolderKind('sent'), 'sent')
  assert.equal(toFolderKind('folder'), 'folder')
  assert.equal(toFolderKind('Projets'), 'folder')
  assert.equal(toFolderKind(undefined), 'folder')
  assert.equal(toComposeKind('reply-all'), 'reply_all')
  assert.equal(toComposeKind('forward'), 'forward')
  assert.equal(toComposeKind('grade'), 'grade')
  assert.equal(toComposeKind('course'), 'course')
  assert.equal(toComposeKind('absence'), 'absence')
  assert.equal(toComposeKind('???'), 'new')
  assert.equal(toMailVia('swipe'), 'swipe')
  assert.equal(toMailVia('hand'), null)
  assert.equal(toRemoveAction('inbox'), 'restore')
  assert.equal(toRemoveAction('delete'), 'delete_forever')
  assert.equal(toRemoveAction('nope'), null)
})

test('files are counted in buckets', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9, undefined].map(getAttachmentsBucket), ['0', '1', '2-3', '2-3', '4+', '4+', '0'])
})

test('a search is reported once per burst of typing, with its last scope', () => {
  const timers = new Map()
  let nextId = 1
  const sent = []
  const reporter = createSearchReporter((scope) => sent.push(scope), {
    delayMs: 1000,
    setTimer: (callback) => { timers.set(nextId, callback); return nextId++ },
    clearTimer: (id) => timers.delete(id),
  })
  const fire = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } }
  reporter.report('local')
  reporter.report('local')
  reporter.report('server')
  assert.deepEqual(sent, [])
  fire()
  assert.deepEqual(sent, ['server'])
  // Emptied field: nothing.
  reporter.report('local')
  reporter.report(null)
  fire()
  assert.deepEqual(sent, ['server'])
  // Left the page: nothing.
  reporter.report('local')
  reporter.cancel()
  fire()
  assert.deepEqual(sent, ['server'])
})
