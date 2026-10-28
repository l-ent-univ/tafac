import assert from 'node:assert/strict'
import test from 'node:test'
import { bindHistorySession, readHistoryNav, writeHistoryNav } from '../src/appHistory.js'

test('an entry without app state is the dashboard', () => {
  assert.deepEqual(readHistoryNav(null), { page: 'dashboard', ue: null, mail: null })
  assert.deepEqual(readHistoryNav({ other: 1 }), { page: 'dashboard', ue: null, mail: null })
  assert.deepEqual(readHistoryNav({ tafac: { page: 'nope', ue: 'UE5.1' } }), { page: 'dashboard', ue: null, mail: null })
  assert.deepEqual(readHistoryNav({ tafac: { page: 'mail' } }), { page: 'mail', ue: null, mail: null })
})

test('a UE only counts on the grades page', () => {
  assert.deepEqual(readHistoryNav({ tafac: { page: 'grades', ue: 'UE5.1' } }), { page: 'grades', ue: 'UE5.1', mail: null })
  assert.deepEqual(readHistoryNav({ tafac: { page: 'dashboard', ue: 'UE5.1' } }), { page: 'dashboard', ue: null, mail: null })
})

test('a mail only counts on the mail page', () => {
  assert.deepEqual(readHistoryNav({ tafac: { page: 'mail', mail: '257' } }), { page: 'mail', ue: null, mail: '257' })
  assert.deepEqual(readHistoryNav({ tafac: { page: 'grades', mail: '257' } }), { page: 'grades', ue: null, mail: null })
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
    ['push', { other: 1, tafac: { page: 'grades', ue: 'UE5.2', mail: null } }],
    ['replace', { other: 1, tafac: { page: 'dashboard', ue: null, mail: null } }],
  ])
})

// Last: it binds a sign-in, which the tests above run without.
test('a mail entry only opens its mail for the sign-in that wrote it', () => {
  const entries = []
  const history = { state: null, pushState: (state) => entries.push(state), replaceState: () => {} }
  assert.equal(bindHistorySession('alice'), true)
  assert.equal(bindHistorySession('alice'), false)
  writeHistoryNav({ page: 'mail', mail: '257' }, { history })
  writeHistoryNav({ page: 'mail' }, { history })
  const [aliceMail, mailPage] = entries
  assert.match(aliceMail.tafac.session, /^[0-9a-f]{24}$/)
  assert.equal('session' in mailPage.tafac, false)
  assert.deepEqual(readHistoryNav(aliceMail), { page: 'mail', ue: null, mail: '257' })
  // An entry from before any marker, or forged without one
  assert.equal(readHistoryNav({ tafac: { page: 'mail', mail: '257' } }).mail, null)

  // Signed out, then someone else: the page stays, the mail doesn't.
  assert.equal(bindHistorySession(null), true)
  assert.equal(bindHistorySession('bob'), true)
  assert.deepEqual(readHistoryNav(aliceMail), { page: 'mail', ue: null, mail: null })

  // The same student signing in again is a new sign-in too.
  bindHistorySession(null)
  bindHistorySession('alice')
  assert.equal(readHistoryNav(aliceMail).mail, null)
  bindHistorySession(null)
})
