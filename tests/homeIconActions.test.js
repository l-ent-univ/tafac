import assert from 'node:assert/strict'
import test from 'node:test'
import { homeIconActions } from '../src/homeIconActions.js'

const noop = () => {}

test('each icon leads where it stands for, in the row’s order', () => {
  const pressed = []
  const open = Object.fromEntries(['allApps', 'planning', 'grades', 'moodle', 'mail'].map((name) => [name, () => pressed.push(name)]))
  const actions = homeIconActions(open)
  assert.deepEqual(actions.map(({ id, label }) => [id, label]), [
    ['apps', 'Toutes les applications'],
    ['calendar', 'Planning'],
    ['grades', 'Mes notes'],
    ['homework', 'Moodle'],
    ['mail', 'Messagerie'],
  ])
  actions.forEach((action) => action.onPress())
  assert.deepEqual(pressed, ['allApps', 'planning', 'grades', 'moodle', 'mail'])
})

test('an icon whose page isn’t there isn’t shown', () => {
  assert.deepEqual(homeIconActions({ allApps: noop, planning: noop, grades: null, moodle: undefined, mail: noop }).map(({ id }) => id), ['apps', 'calendar', 'mail'])
  assert.deepEqual(homeIconActions({}), [])
  assert.deepEqual(homeIconActions(), [])
})

test('the menu’s icon has nowhere to lead', () => {
  assert.equal(homeIconActions({ allApps: noop, planning: noop, grades: noop, moodle: noop, mail: noop, menu: noop }).some(({ id }) => id === 'menu'), false)
})
