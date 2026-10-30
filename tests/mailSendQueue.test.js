import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers'
import test from 'node:test'
import { UNDO_SEND_MS, createMailSendQueue, sentNoticeText } from '../src/mailSendQueue.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))

// A queue with its timers by hand, its sends answered as `answers` say
// (one per request, in order), and a page's handlers that log what it's told.
function setup(answers = [{ status: 'ok', partial: false, invalid: [] }]) {
  const timers = new Map()
  let nextTimer = 1
  const requests = []
  const queue = createMailSendQueue({
    sendMail: async (payload) => {
      requests.push(payload)
      return answers.shift() ?? { status: 'ok', partial: false, invalid: [] }
    },
    createSendUid: () => `uid-${requests.length + 1}`,
    setTimer: (fn, ms) => {
      timers.set(nextTimer, { fn, ms })
      return nextTimer++
    },
    clearTimer: (id) => timers.delete(id),
    wait: async () => {},
  })
  const log = []
  const page = {
    notify: (text, options = {}) => log.push(['notify', text, Boolean(options.onUndo)]),
    reopen: (snapshot, error) => log.push(['reopen', snapshot.id, error?.code ?? null]),
    onSent: (snapshot) => log.push(['sent', snapshot.id]),
  }
  const saver = { saves: 0, closed: false, save: async () => { saver.saves += 1 }, whenIdle: async () => {}, buildSendPayload: (state, uid) => ({ ...state, sendUid: uid }), close: () => { saver.closed = true } }
  const snapshot = { id: 'mail-1', saver, state: { subject: 'a' } }
  const fire = async () => {
    const timer = [...timers.values()][0]
    timers.clear()
    timer.fn()
    await tick()
    await tick()
  }
  return { queue, timers, requests, log, page, saver, snapshot, fire }
}

test('the send queue: « Annuler » for a while, then the mail goes, once', async () => {
  const { queue, timers, requests, log, page, saver, snapshot, fire } = setup()
  queue.attach(page)
  assert.equal(queue.send(snapshot), true)
  assert.equal(queue.send(snapshot), false)
  assert.equal(saver.saves, 1)
  assert.equal([...timers.values()][0].ms, UNDO_SEND_MS)
  assert.equal(queue.busy, true)
  await fire()
  assert.equal(requests.length, 1)
  assert.equal(saver.closed, true)
  assert.deepEqual(log, [['notify', 'Envoi…', true], ['notify', 'Envoi…', false], ['notify', 'Message envoyé', false], ['sent', 'mail-1']])
  assert.equal(queue.busy, false)

  // Taken back: nothing goes, the composer reopens as it was.
  log.length = 0
  queue.send(snapshot)
  queue.undo()
  assert.equal(timers.size, 0)
  assert.deepEqual(log.slice(1), [['notify', null, false], ['reopen', 'mail-1', null]])
  assert.equal(requests.length, 1)
})

test('the send queue: the network lost, tried again with the same uid', async () => {
  const { queue, requests, page, snapshot, fire } = setup([{ status: 'error', code: 'network' }, { status: 'ok', partial: false }])
  queue.attach(page)
  queue.send(snapshot)
  await fire()
  assert.equal(requests.length, 2)
  assert.equal(requests[0].sendUid, requests[1].sendUid)
})

test('the send queue: the page left while a mail waits, its failure kept for its return', async () => {
  const { queue, requests, log, page, snapshot } = setup([{ status: 'error', code: 'failed' }])
  const detach = queue.attach(page)
  queue.send(snapshot)
  // The page goes: the mail goes now (no « Annuler » left), unseen.
  detach()
  await tick()
  await tick()
  assert.equal(requests.length, 1)
  assert.deepEqual(log, [['notify', 'Envoi…', true]])
  // Back on the page: the composer reopens with why.
  queue.attach(page)
  assert.deepEqual(log.at(-1), ['reopen', 'mail-1', 'failed'])
  // Shown once.
  queue.attach(page)
  assert.equal(log.filter((entry) => entry[0] === 'reopen').length, 1)
})

test('the send queue: logging out delivers the mail first, or stops for its failure', async () => {
  // Delivered: the logout goes on (null).
  const sent = setup()
  sent.queue.attach(sent.page)
  sent.queue.send(sent.snapshot)
  assert.equal(await sent.queue.flush(), null)
  assert.equal(sent.requests.length, 1)
  assert.equal(sent.timers.size, 0)
  assert.equal(await sent.queue.flush(), null)

  // Failed while on another page: the failure, held for the mail page.
  const failed = setup([{ status: 'error', code: 'expired' }])
  failed.queue.attach(failed.page)()
  failed.queue.send(failed.snapshot)
  await tick()
  await tick()
  assert.equal((await failed.queue.flush()).code, 'expired')
  failed.queue.attach(failed.page)
  assert.deepEqual(failed.log.at(-1), ['reopen', 'mail-1', 'expired'])
  assert.equal(await failed.queue.flush(), null)
})

test('the send queue: cleared on logout, nothing of it reported to the next student', async () => {
  let finish = null
  const { queue, log, page, snapshot } = setup()
  const slow = createMailSendQueue({
    sendMail: () => new Promise((resolve) => { finish = resolve }),
    createSendUid: () => 'uid-1',
    setTimer: () => 1,
    clearTimer: () => {},
    wait: async () => {},
  })
  slow.attach(page)
  slow.send(snapshot)
  const delivery = slow.flush()
  await tick()
  slow.clear()
  assert.equal(slow.busy, false)
  finish({ status: 'error', code: 'failed' })
  await delivery
  assert.equal(log.some((entry) => entry[0] === 'reopen'), false)
  slow.attach(page)
  assert.equal(log.some((entry) => entry[0] === 'reopen'), false)
  // A waiting one is dropped, its timer stopped.
  queue.send(snapshot)
  queue.clear()
  assert.equal(queue.busy, false)
  assert.equal(await queue.flush(), null)
})

test('the notice once sent names the addresses refused', () => {
  assert.equal(sentNoticeText({ partial: false }), 'Message envoyé')
  assert.equal(sentNoticeText({ partial: true, invalid: [] }), 'Envoyé, sauf à une adresse refusée')
  assert.equal(sentNoticeText({ partial: true, invalid: ['leo@univ.fr'] }), 'Envoyé, sauf à leo@univ.fr (adresse refusée)')
  assert.equal(sentNoticeText({ partial: true, invalid: ['a@u.fr', 'b@u.fr'] }), 'Envoyé, sauf à a@u.fr, b@u.fr (adresses refusées)')
  assert.equal(sentNoticeText({ partial: true, invalid: ['a@u.fr', 'b@u.fr', 'c@u.fr', 'd@u.fr', 'e@u.fr'] }), 'Envoyé, sauf à a@u.fr, b@u.fr, c@u.fr et 2 autres (adresses refusées)')
})
