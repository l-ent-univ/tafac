import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers'
import test from 'node:test'
import {
  MailAuthError,
  forgetContextRequest,
  isZimbraSessionRefusal,
  readContextAttachmentLimits,
  runWithMailContext,
  shareContextRequest,
} from '../server/mailContext.js'
import { deriveAttachmentLimits } from '../src/mailAttachments.js'

// A session's contexts as server/entAuthApp.js keeps them: one kept, a
// sign-in counted each time a new one is made.
function contextStore() {
  const store = { kept: null, signIns: 0 }
  store.get = async (replacing) => {
    if (!store.kept || store.kept === replacing) {
      store.signIns += 1
      store.kept = { n: store.signIns }
    }
    return store.kept
  }
  store.drop = (context) => {
    if (store.kept === context) store.kept = null
  }
  return store
}

test('the webmail context: signed in again only when the session was refused', async () => {
  const store = contextStore()
  assert.equal(await runWithMailContext(store, async (context) => context.n), 1)

  // A SOAP fault or a timeout: thrown, the context kept, no new sign-in.
  const fault = Object.assign(new Error('Zimbra SendMsgRequest failed (mail.SEND_ABORTED_ADDRESS_FAILURE).'), { zimbraCode: 'mail.SEND_ABORTED_ADDRESS_FAILURE' })
  await assert.rejects(runWithMailContext(store, async () => { throw fault }), (error) => error === fault)
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  await assert.rejects(runWithMailContext(store, async () => { throw timeout }), (error) => error === timeout)
  assert.deepEqual([store.kept.n, store.signIns], [1, 1])

  // The auth token expired: signed in again, the request done on the new one.
  const seen = []
  const result = await runWithMailContext(store, async (context) => {
    seen.push(context.n)
    if (context.n === 1) throw new MailAuthError('Zimbra GetInfoRequest rejected the session (service.AUTH_EXPIRED).')
    return 'ok'
  })
  assert.equal(result, 'ok')
  assert.deepEqual(seen, [1, 2])
  assert.equal(store.signIns, 2)

  // Refused again on the new one: given up, nothing kept.
  await assert.rejects(runWithMailContext(store, async () => { throw new MailAuthError('refused') }), MailAuthError)
  assert.equal(store.kept, null)
  assert.equal(store.signIns, 3)
})

test('the webmail context: a refusal doesn\'t sign in twice when another request already did', async () => {
  const store = contextStore()
  const old = await store.get(null)
  // Two requests on the old context, both refused; the first signs in again.
  const runs = [1, 2].map(() => runWithMailContext(store, async (context) => {
    if (context === old) {
      await new Promise((resolve) => setImmediate(resolve))
      throw new MailAuthError('refused')
    }
    return context.n
  }))
  assert.deepEqual(await Promise.all(runs), [2, 2])
  assert.equal(store.signIns, 2)
})

test('the SOAP answers that mean the session is gone', () => {
  assert.equal(isZimbraSessionRefusal({ code: 'service.AUTH_EXPIRED', status: 500 }), true)
  assert.equal(isZimbraSessionRefusal({ code: 'service.AUTH_REQUIRED', status: 500 }), true)
  assert.equal(isZimbraSessionRefusal({ code: 'HTTP 401', status: 401, json: false }), true)
  assert.equal(isZimbraSessionRefusal({ code: 'HTTP 302', status: 302, json: false }), true)
  // A sign-in page where the JSON should be.
  assert.equal(isZimbraSessionRefusal({ code: 'HTTP 200', status: 200, json: false }), true)
  assert.equal(isZimbraSessionRefusal({ code: 'mail.SEND_ABORTED_ADDRESS_FAILURE', status: 500 }), false)
  assert.equal(isZimbraSessionRefusal({ code: 'mail.NO_SUCH_MSG', status: 500 }), false)
  assert.equal(isZimbraSessionRefusal({ code: 'HTTP 502', status: 502, json: false }), false)
})

test('GetInfo, once per context however many ask at once; a failure asked again', async () => {
  const context = {}
  let requests = 0
  let fail = true
  const request = () => {
    requests += 1
    return new Promise((resolve, reject) => setImmediate(() => (fail ? reject(new Error('Zimbra GetInfoRequest failed (HTTP 503).')) : resolve({ attSizeLimit: 10_000_000 }))))
  }
  const failed = await Promise.allSettled([shareContextRequest(context, 'info', request), shareContextRequest(context, 'info', request)])
  assert.deepEqual(failed.map((entry) => entry.status), ['rejected', 'rejected'])
  assert.equal(requests, 1)
  fail = false
  const [one, two] = await Promise.all([shareContextRequest(context, 'info', request), shareContextRequest(context, 'info', request)])
  assert.equal(one, two)
  assert.equal(requests, 2)
  await shareContextRequest(context, 'info', request)
  assert.equal(requests, 2)
  forgetContextRequest(context, 'info')
  await shareContextRequest(context, 'info', request)
  assert.equal(requests, 3)
})

test('the attachment limits: the fallback isn\'t kept after a GetInfo that failed', async () => {
  const context = {}
  let answer = () => Promise.reject(new Error('Zimbra GetInfoRequest failed (HTTP 503).'))
  const readInfo = () => answer()
  assert.deepEqual(await readContextAttachmentLimits(context, readInfo), deriveAttachmentLimits(null))
  assert.equal(context.attachmentLimits, undefined)
  // The next request reads them again, and keeps them.
  answer = () => Promise.resolve({ attSizeLimit: 10 * 1024 * 1024 })
  const limits = await readContextAttachmentLimits(context, readInfo)
  assert.deepEqual(limits, deriveAttachmentLimits(10 * 1024 * 1024))
  assert.notDeepEqual(limits, deriveAttachmentLimits(null))
  answer = () => Promise.reject(new Error('not asked'))
  assert.equal(await readContextAttachmentLimits(context, readInfo), limits)
  // A refused session is the caller's (signed in again).
  await assert.rejects(readContextAttachmentLimits({}, () => Promise.reject(new MailAuthError('refused'))), MailAuthError)
})
