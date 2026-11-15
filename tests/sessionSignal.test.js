import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionSignal, logoutHeaders } from '../src/sessionSignal.js'

const answer = (headers = {}) => (name) => headers[name.toLowerCase()] ?? null
const EXPIRED = answer({ 'x-tafac-session': 'expired' })

function setup() {
  const signal = createSessionSignal()
  let signOuts = 0
  signal.subscribe(() => {
    signOuts += 1
  })
  return { signal, signOuts: () => signOuts }
}

test('only the server\'s header signs out', () => {
  const { signal, signOuts } = setup()
  signal.mark(true)
  const sentUnder = signal.current
  // Whatever else a request failed with: a 401 without it, a 5xx, a
  // timeout (no answer at all never reaches here).
  for (const other of [answer(), answer({ 'x-tafac-session': 'valid' }), answer({ 'content-type': 'text/html' })]) {
    assert.equal(signal.note(sentUnder, other), false)
  }
  assert.equal(signOuts(), 0)
  assert.equal(signal.note(sentUnder, EXPIRED), true)
  assert.equal(signOuts(), 1)
})

test('requests failing together sign out once', () => {
  const { signal, signOuts } = setup()
  signal.mark(true)
  const sentUnder = signal.current
  assert.equal(signal.note(sentUnder, EXPIRED), true)
  assert.equal(signal.note(sentUnder, EXPIRED), false)
  assert.equal(signal.note(sentUnder, EXPIRED), false)
  assert.equal(signOuts(), 1)
})

test('an answer to a request sent signed out, or under another sign-in, is not heard', () => {
  const { signal, signOuts } = setup()
  // Sent before signing in (the login page's own requests).
  const before = signal.current
  signal.mark(true)
  assert.equal(signal.note(before, EXPIRED), false)

  // Sent under a sign-in that ended: signed out, then in again.
  const old = signal.current
  signal.mark(false)
  signal.restart(true)
  assert.equal(signal.note(old, EXPIRED), false)
  assert.equal(signOuts(), 0)

  // A session confirmed again keeps its sign-in: its requests still count.
  const current = signal.current
  signal.mark(true)
  assert.equal(signal.current, current)
  assert.equal(signal.note(current, EXPIRED), true)
})

test('the desktop app\'s word signs out once, only signed in', () => {
  const { signal, signOuts } = setup()
  assert.equal(signal.expire(), false)
  signal.mark(true)
  assert.equal(signal.expire(), true)
  assert.equal(signal.expire(), false)
  assert.equal(signOuts(), 1)
})

test('the desktop app hears which sign-out was the student\'s own', () => {
  // The session's expiry: the app keeps the login it signs in again with.
  assert.deepEqual(logoutHeaders({ expired: true, desktop: true }), { 'X-Tafac-Logout': 'expired' })
  // The student's own: nothing said, the app forgets it.
  assert.deepEqual(logoutHeaders({ desktop: true }), {})
  // The site sends nothing of the app's.
  assert.deepEqual(logoutHeaders({ expired: true }), {})
  assert.deepEqual(logoutHeaders(), {})
})
