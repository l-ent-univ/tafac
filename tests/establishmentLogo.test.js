import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLogo } from '../src/establishmentLogo.js'

const config = {
  university: { name: 'Université de Rennes' },
  branding: { logo: 'rennes.svg', logoAlt: 'Université de Rennes' },
  establishments: {
    byId: {
      iutlan: { label: 'IUT de Lannion', logo: 'iutlan.svg', logoDark: 'iutlan-dark.svg', logoShape: 'square' },
      ufrs: { label: 'Faculté des sciences' },
    },
  },
}

test('an establishment with its own logo shows it', () => {
  assert.deepEqual(resolveLogo(config, 'iutlan'), {
    src: 'iutlan.svg',
    srcDark: 'iutlan-dark.svg',
    alt: 'IUT de Lannion',
    shape: 'square',
    establishment: 'iutlan',
  })
})

test('without a logo of its own, or no establishment, the university’s', () => {
  const university = { src: 'rennes.svg', srcDark: null, alt: 'Université de Rennes', shape: 'wide', establishment: null }
  assert.deepEqual(resolveLogo(config, 'ufrs'), university)
  assert.deepEqual(resolveLogo(config, 'other'), university)
  assert.deepEqual(resolveLogo(config, null), university)
})

test('no logo anywhere: nothing', () => {
  assert.equal(resolveLogo({ branding: {} }, 'iutlan'), null)
})
