import assert from 'node:assert/strict'
import test from 'node:test'
import { readHistoryNav, writeHistoryNav } from '../src/appHistory.js'

test('an entry without app state is the dashboard', () => {
  assert.deepEqual(readHistoryNav(null), { page: 'dashboard', ue: null })
  assert.deepEqual(readHistoryNav({ other: 1 }), { page: 'dashboard', ue: null })
  assert.deepEqual(readHistoryNav({ tafac: { page: 'nope', ue: 'UE5.1' } }), { page: 'dashboard', ue: null })
  assert.deepEqual(readHistoryNav({ tafac: { page: 'mail' } }), { page: 'mail', ue: null })
})

test('a UE only counts on the grades page', () => {
  assert.deepEqual(readHistoryNav({ tafac: { page: 'grades', ue: 'UE5.1' } }), { page: 'grades', ue: 'UE5.1' })
  assert.deepEqual(readHistoryNav({ tafac: { page: 'dashboard', ue: 'UE5.1' } }), { page: 'dashboard', ue: null })
})

test('writing keeps the entry’s other state and pushes or replaces', () => {
  const calls = []
  const history = {
    state: { other: 1 },
    pushState: (state) => calls.push(['push', state]),
    replaceState: (state) => calls.push(['replace', state]),
  }
  writeHistoryNav({ page: 'grades', ue: 'UE5.2' }, { history })
  writeHistoryNav({ page: 'dashboard' }, { history, replace: true })
  assert.deepEqual(calls, [
    ['push', { other: 1, tafac: { page: 'grades', ue: 'UE5.2' } }],
    ['replace', { other: 1, tafac: { page: 'dashboard', ue: null } }],
  ])
})
