import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAIL_PAGE_SOURCES,
  createSearchReporter,
  describeMailLoad,
  describeSend,
  getAttachmentsBucket,
  toComposeKind,
  toFolderKind,
  toMailPageSource,
  toMailVia,
  toRemoveAction,
} from '../src/mailAnalytics.js'
import { sanitizeAnalyticsEvent } from '../server/analyticsSchema.js'

test('arrival sources: the known ones, anything else is other', () => {
  for (const source of MAIL_PAGE_SOURCES) assert.equal(toMailPageSource(source), source)
  assert.equal(toMailPageSource('sidebar_card'), 'other')
  assert.equal(toMailPageSource(undefined), 'other')
  for (const source of MAIL_PAGE_SOURCES) {
    assert.ok(sanitizeAnalyticsEvent({ event: 'page_viewed', properties: { page: 'mail', source } }, { hasSession: true }))
  }
})

test('the first list: loading reports nothing, then ok, empty, error or session_expired', () => {
  assert.equal(describeMailLoad({ status: 'loading' }), null)
  assert.equal(describeMailLoad({ status: 'disabled' }), null)
  assert.deepEqual(describeMailLoad({ status: 'ok', messageCount: 12 }), { status: 'ok' })
  assert.deepEqual(describeMailLoad({ status: 'ok', messageCount: 0 }), { status: 'empty' })
  assert.deepEqual(describeMailLoad({ status: 'unauthenticated' }), { status: 'session_expired' })
  assert.deepEqual(describeMailLoad({ status: 'error', errorKind: 'timeout' }), { status: 'error', errorKind: 'timeout' })
  assert.deepEqual(describeMailLoad({ status: 'error', errorKind: 'weird' }), { status: 'error', errorKind: 'other' })
  assert.deepEqual(describeMailLoad({ status: 'error', errorKind: 'http_4xx', sessionExpired: true }), { status: 'session_expired' })
})

test('folders, composers and actions are named by enum, never by what they hold', () => {
  assert.equal(toFolderKind('sent'), 'sent')
  assert.equal(toFolderKind('folder'), 'folder')
  assert.equal(toFolderKind('Projets'), 'folder')
  assert.equal(toFolderKind(undefined), 'folder')
  assert.equal(toComposeKind('reply-all'), 'reply_all')
  assert.equal(toComposeKind('forward'), 'forward')
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

test('a send is described by its outcome, buckets and a boolean', () => {
  const snapshot = {
    state: {
      subject: 'Secret',
      attachments: [{ status: 'ready', name: 'cv.pdf' }, { status: 'ready', name: 'lettre.pdf' }, { status: 'error', name: 'x.zip' }],
      inlineImages: [{ key: 'a' }],
    },
  }
  assert.deepEqual(describeSend('sent', snapshot, { status: 'ok' }), { result: 'ok', attachments: '2-3', inline_images: true })
  assert.equal(describeSend('sent', snapshot, { status: 'ok', partial: true }).result, 'partial')
  assert.equal(describeSend('failed', snapshot, { status: 'error' }).result, 'error')
  assert.equal(describeSend('undone', snapshot).result, 'undone')
  assert.deepEqual(describeSend('sent', { state: {} }, { status: 'ok' }), { result: 'ok', attachments: '0', inline_images: false })
  const sent = sanitizeAnalyticsEvent({ event: 'mail_action', properties: { action: 'sent', ...describeSend('sent', snapshot, { status: 'ok' }) } }, { hasSession: true })
  assert.deepEqual(sent.properties, { action: 'sent', result: 'ok', attachments: '2-3', inline_images: true })
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
