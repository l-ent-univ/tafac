import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_REGISTER, getRegister, isTu, r, resolveRegister, setRegister } from '../src/register.js'

const config = {
  register: 'vous',
  establishments: {
    byId: {
      iutlan: { label: 'IUT de Lannion', register: 'tu' },
      ufrs: { label: 'Faculté des sciences' },
    },
  },
}

test('vous by default', () => {
  assert.equal(DEFAULT_REGISTER, 'vous')
  assert.equal(resolveRegister(null), 'vous')
  assert.equal(resolveRegister({}), 'vous')
  assert.equal(resolveRegister({ register: 'nope' }), 'vous')
})

test('the establishment overrides the university', () => {
  assert.equal(resolveRegister(config), 'vous')
  assert.equal(resolveRegister(config, null), 'vous')
  assert.equal(resolveRegister(config, 'iutlan'), 'tu')
  assert.equal(resolveRegister(config, 'ufrs'), 'vous')
  assert.equal(resolveRegister(config, 'unknown'), 'vous')
  assert.equal(resolveRegister({ register: 'tu' }, 'unknown'), 'tu')
  assert.equal(resolveRegister({ register: 'tu', establishments: { byId: { x: { register: 'vous' } } } }, 'x'), 'vous')
})

test('r() follows the register set', () => {
  assert.equal(getRegister(), 'vous')
  assert.equal(r('Tes notes', 'Vos notes'), 'Vos notes')
  assert.equal(isTu(), false)

  assert.equal(setRegister('tu'), 'tu')
  assert.equal(r('Tes notes', 'Vos notes'), 'Tes notes')
  assert.equal(isTu(), true)

  assert.equal(setRegister('anything else'), 'vous')
  assert.equal(r('Tes notes', 'Vos notes'), 'Vos notes')
  setRegister(null)
  assert.equal(getRegister(), 'vous')
})
