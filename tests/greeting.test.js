import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGreeting, greetingWord } from '../src/greeting.js'

const at = (hours, minutes = 0) => new Date(2026, 10, 3, hours, minutes)

test('Bonjour in the day, Bonsoir from 18h until 5h', () => {
  assert.equal(greetingWord(at(5)), 'Bonjour')
  assert.equal(greetingWord(at(12)), 'Bonjour')
  assert.equal(greetingWord(at(17, 59)), 'Bonjour')
  assert.equal(greetingWord(at(18)), 'Bonsoir')
  assert.equal(greetingWord(at(23, 30)), 'Bonsoir')
  assert.equal(greetingWord(at(2)), 'Bonsoir')
  assert.equal(greetingWord(at(4, 59)), 'Bonsoir')
})

test('with or without a first name', () => {
  assert.equal(buildGreeting('Camille', at(9)), 'Bonjour Camille')
  assert.equal(buildGreeting('  Camille ', at(20)), 'Bonsoir Camille')
  assert.equal(buildGreeting('', at(9)), 'Bonjour')
  assert.equal(buildGreeting(null, at(21)), 'Bonsoir')
})
