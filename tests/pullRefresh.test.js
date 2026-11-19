import assert from 'node:assert/strict'
import test from 'node:test'
import { addRefresher, runRefreshers, watchRefreshers } from '../src/pullRefresh.js'

const soon = { minMs: 1, maxMs: 50 }

test('a pull runs every source on screen, and those only', async () => {
  const ran = []
  const seen = []
  const stopWatching = watchRefreshers((hasAny) => seen.push(hasAny))
  const removeMail = addRefresher(() => { ran.push('mail') })
  const removeGrades = addRefresher(async () => { ran.push('grades') })
  await runRefreshers(soon)
  assert.deepEqual(ran.sort(), ['grades', 'mail'])

  removeMail()
  ran.length = 0
  await runRefreshers(soon)
  assert.deepEqual(ran, ['grades'])
  removeGrades()
  stopWatching()
  // Nothing at first, then something, and nothing again once the last left.
  assert.equal(seen[0], false)
  assert.equal(seen.includes(true), true)
  assert.equal(seen.at(-1), false)
})

test('a source that fails or hangs does not hold the others', async () => {
  const removeFailing = addRefresher(() => Promise.reject(new Error('down')))
  const removeHanging = addRefresher(() => new Promise(() => {}))
  let done = false
  const removeFine = addRefresher(async () => { done = true })
  await runRefreshers(soon)
  assert.equal(done, true)
  removeFailing()
  removeHanging()
  removeFine()
})
