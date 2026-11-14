import assert from 'node:assert/strict'
import test from 'node:test'
import { otpCuesFor, playOtpSound, primeOtpSound } from '../src/otpSound.js'

test('a digit typed plays its box\'s note', () => {
  assert.deepEqual(otpCuesFor('', '4'), [{ cue: 'digit', index: 0 }])
  assert.deepEqual(otpCuesFor('48', '481'), [{ cue: 'digit', index: 2 }])
})

test('the last digit also plays the flourish of a whole code', () => {
  assert.deepEqual(otpCuesFor('48159', '481592'), [{ cue: 'digit', index: 5 }, { cue: 'complete' }])
})

test('a pasted code runs up the scale, then the flourish', () => {
  assert.deepEqual(otpCuesFor('', '481592'), [
    { cue: 'digit', index: 0 },
    { cue: 'digit', index: 1 },
    { cue: 'digit', index: 2 },
    { cue: 'digit', index: 3 },
    { cue: 'digit', index: 4 },
    { cue: 'digit', index: 5 },
    { cue: 'complete' },
  ])
})

test('digits taken back play one tick, the same code nothing', () => {
  assert.deepEqual(otpCuesFor('481', '48'), [{ cue: 'delete' }])
  assert.deepEqual(otpCuesFor('481592', ''), [{ cue: 'delete' }])
  assert.deepEqual(otpCuesFor('481', '481'), [])
})

test('without an audio context (here: Node), playing is silent, not an error', () => {
  assert.equal(globalThis.AudioContext, undefined)
  primeOtpSound()
  playOtpSound('digit', { index: 3 })
  playOtpSound('refused')
  playOtpSound('no-such-cue')
})
