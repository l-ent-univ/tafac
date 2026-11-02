import assert from 'node:assert/strict'
import test from 'node:test'
import { HOME_CARD_ORDER, layoutHomeCards } from '../src/homeCardsLayout.js'

// Every subset of the five cards.
const SUBSETS = Array.from({ length: 2 ** HOME_CARD_ORDER.length }, (_, mask) => (
  HOME_CARD_ORDER.filter((_, index) => mask & (1 << index))
))

// The grid's rows as auto-placement fills them: 'tall' takes the left
// column of two rows, 'full' a row of its own.
function fillRows(ids) {
  const placement = layoutHomeCards(ids)
  const cells = []
  let tallRows = 0
  let row = []
  for (const id of HOME_CARD_ORDER.filter((card) => ids.includes(card))) {
    const place = placement[id]
    if (place === 'tall') {
      tallRows = 2
      continue
    }
    if (place === 'full') {
      assert.equal(row.length, 0, `${id} starts a row`)
      cells.push([id])
      continue
    }
    row.push(id)
    const columns = tallRows > 0 ? 1 : 2
    if (row.length === columns) {
      cells.push(row)
      row = []
      if (tallRows > 0) tallRows -= 1
    }
  }
  return { cells, open: row, tallRows }
}

test('every card drawn gets a place', () => {
  for (const ids of SUBSETS) {
    assert.deepEqual(Object.keys(layoutHomeCards(ids)).sort(), [...ids].sort())
  }
})

test('no combination leaves a column empty', () => {
  for (const ids of SUBSETS) {
    const { open, tallRows } = fillRows(ids)
    assert.deepEqual(open, [], `${ids.join('+')}: a row half filled`)
    assert.equal(tallRows, 0, `${ids.join('+')}: « Prochains cours » beside an empty row`)
  }
})

test('a card alone spans the row', () => {
  for (const id of HOME_CARD_ORDER) assert.deepEqual(layoutHomeCards([id]), { [id]: 'full' })
})

test('« Prochains cours » runs down the left beside two cards', () => {
  assert.deepEqual(layoutHomeCards(HOME_CARD_ORDER), {
    nextClass: 'tall', average: 'half', mail: 'half', latestGrade: 'half', deadlines: 'half',
  })
  assert.deepEqual(layoutHomeCards(['deadlines', 'nextClass', 'latestGrade']), {
    nextClass: 'tall', latestGrade: 'half', deadlines: 'half',
  })
  assert.deepEqual(layoutHomeCards(['nextClass', 'average', 'mail', 'deadlines']), {
    nextClass: 'tall', average: 'half', mail: 'half', deadlines: 'full',
  })
})

test('two cards share a row, but not the classes and the grades', () => {
  assert.deepEqual(layoutHomeCards(['nextClass', 'deadlines']), { nextClass: 'half', deadlines: 'half' })
  assert.deepEqual(layoutHomeCards(['average', 'latestGrade']), { average: 'half', latestGrade: 'half' })
  assert.deepEqual(layoutHomeCards(['nextClass', 'latestGrade']), { nextClass: 'full', latestGrade: 'full' })
})
