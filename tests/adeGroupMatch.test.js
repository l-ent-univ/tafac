import assert from 'node:assert/strict'
import test from 'node:test'
import { findTpUnderYear, pickAdeGroupForAlias } from '../src/adeGroupMatch.js'

const STUDENTS = 'Ressources.Etudiants.IUT Lannion'
const results = [
  { id: '1', name: '3B3 MMI', path: `${STUDENTS}.BUT MMI.MMI A3.3B MMI.3B3 MMI` },
  { id: '2', name: '3B3 INFO', path: `${STUDENTS}.BUT INFO.INFO A3.3B INFO.3B3 INFO` },
  { id: '3', name: '3B3', path: 'Ressources.Salles.IUT Lannion.3B3' },
  { id: '4', name: '1A2 J', path: `${STUDENTS}.BUT INFO-COM.A1 J.1A2 J` },
  { id: '5', name: '2B2-Dev MMI', path: `${STUDENTS}.BUT MMI.MMI A2.2B MMI.2B2-Dev MMI` },
  { id: '6', name: '2B2-StratUX MMI', path: `${STUDENTS}.BUT MMI.MMI A2.2B MMI.2B2-StratUX MMI` },
]

test('finds the student group named after the ScoDoc group', () => {
  assert.equal(pickAdeGroupForAlias(results.slice(0, 1), '3B3')?.id, '1')
  assert.equal(pickAdeGroupForAlias(results, '1A2 J')?.id, '4')
  assert.equal(pickAdeGroupForAlias(results, '1A2')?.id, '4')
})

test('leaves out rooms and teachers', () => {
  assert.equal(pickAdeGroupForAlias([results[2]], '3B3'), null)
})

test('narrows several programmes down to the student’s', () => {
  assert.equal(pickAdeGroupForAlias(results, '3B3'), null)
  assert.equal(pickAdeGroupForAlias(results, '3B3', ['BUT MMI', 'MMI'])?.id, '1')
})

test('gives up when it stays ambiguous', () => {
  assert.equal(pickAdeGroupForAlias(results, '2B2', ['BUT MMI']), null)
  assert.equal(pickAdeGroupForAlias(results, ''), null)
  assert.equal(pickAdeGroupForAlias(null, '3B3'), null)
})

// A year of the planning's tree as the group picker reads it: Lannion's BUT
// MMI, 2nd year, where ADE files the TP 2B1 under the TD « 2B MMI » and
// splits 2B2 by parcours.
const node = (id, name, children = []) => ({ id, name, children })
const mmiA2 = node('8294', 'MMI A2', [
  node('8399', '2A MMI', [node('3309', '2A2  MMI'), node('11667', '2A1 MMI')]),
  node('12619', '2B MMI', [
    node('14921', '2B2 MMI', [node('14961', '2B2-StratUX MMI'), node('17428', '2B2-DWeb MMI')]),
    node('12777', '2B1 MMI'),
  ]),
])
const found = (result) => (result ? [result.td.name, result.tp.name] : null)

test('ScoDoc\'s TP is found under the year, whatever its TD says', () => {
  // ScoDoc: TD « 2A », TP « 2B1 » (the aliases detectScodocGroupSelection makes).
  assert.deepEqual(found(findTpUnderYear(mmiA2, ['2B1', 'B1', 'TP 1'], { current: '14961' })), ['2B MMI', '2B1 MMI'])
  assert.deepEqual(found(findTpUnderYear(mmiA2, ['2A2'])), ['2A MMI', '2A2  MMI'])
})

test('a TP split by parcours: the student\'s own, by their parcours or ADE\'s default', () => {
  // ADE's default is one of them: ScoDoc agrees.
  assert.deepEqual(found(findTpUnderYear(mmiA2, ['2B2'], { current: '17428' })), ['2B2 MMI', '2B2-DWeb MMI'])
  // Otherwise ScoDoc's parcours decides.
  assert.deepEqual(found(findTpUnderYear(mmiA2, ['2B2'], { hints: ['Strat-UX', '2B', '2B2', 'FI'] })), ['2B2 MMI', '2B2-StratUX MMI'])
  // Nothing to tell them apart: none.
  assert.equal(findTpUnderYear(mmiA2, ['2B2'], { hints: ['FI'] }), null)
})

test('a name nowhere under the year, or a folder\'s, finds nothing', () => {
  assert.equal(findTpUnderYear(mmiA2, ['3B1', 'TP 9']), null)
  // « 2B MMI » is the TD's folder, never a TP.
  assert.equal(findTpUnderYear(mmiA2, ['2B']), null)
  assert.equal(findTpUnderYear(null, ['2B1']), null)
  assert.equal(findTpUnderYear(mmiA2, []), null)
})
