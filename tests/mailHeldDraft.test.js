import assert from 'node:assert/strict'
import test from 'node:test'
import { dropKeptMail, hasKeptMail, keepMail, keepMailFor, registerOpenComposer, snapshotOpenComposer, takeKeptMail } from '../src/mailHeldDraft.js'

test('a mail kept through an expired session goes back to its student only', () => {
  assert.equal(keepMail('alice', [null]), false)
  assert.equal(keepMail(null, [{ id: 1 }]), false)

  assert.equal(keepMail('alice', [{ id: 1 }, null, { id: 2 }]), true)
  keepMailFor('alice')
  assert.equal(hasKeptMail('alice'), true)
  assert.equal(hasKeptMail('bob'), false)
  assert.deepEqual(takeKeptMail(), [{ id: 1 }, { id: 2 }])
  assert.deepEqual(takeKeptMail(), [])

  // Someone else signs in: dropped.
  keepMail('alice', [{ id: 1 }])
  keepMailFor('bob')
  assert.equal(hasKeptMail('alice'), false)
  assert.deepEqual(takeKeptMail(), [])

  // Signed out on purpose: dropped.
  keepMail('alice', [{ id: 1 }])
  dropKeptMail()
  assert.equal(hasKeptMail('alice'), false)
})

test('the open composer is read while the mail page is there', () => {
  assert.equal(snapshotOpenComposer(), null)
  const unregister = registerOpenComposer(() => ({ id: 'draft' }))
  assert.deepEqual(snapshotOpenComposer(), { id: 'draft' })
  unregister()
  assert.equal(snapshotOpenComposer(), null)
  // A composer that can't be read keeps nothing, and signs out all the same.
  const broken = registerOpenComposer(() => {
    throw new Error('gone')
  })
  assert.equal(snapshotOpenComposer(), null)
  broken()
})
