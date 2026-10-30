import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPagePattern } from '../scripts/verify-deployment.mjs'

const template = '<!doctype html><html><head><title>%LENT_SEO_TITLE%</title>'
  + '<meta name="description" content="%LENT_SEO_DESCRIPTION%"><link rel="canonical" href="__PUBLIC_ORIGIN__/">'
  + '<script type="application/ld+json">{"alternateName":%LENT_ALTERNATE_NAMES_JSON%}</script>'
  + '<script type="module" crossorigin src="/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>'

const fill = (values) => template
  .replace('%LENT_SEO_TITLE%', values.title ?? 'Tafac')
  .replace('%LENT_SEO_DESCRIPTION%', values.description ?? 'Cours, notes et services')
  .replace('%LENT_ALTERNATE_NAMES_JSON%', values.names ?? '["l\'ent"]')
  .replaceAll('__PUBLIC_ORIGIN__', values.origin ?? 'https://tafac.fr')

test('the page as the server fills it matches', () => {
  assert.ok(buildPagePattern(template).test(fill({})))
  assert.ok(buildPagePattern(template).test(fill({ origin: '' })))
})

test('markup smuggled through a placeholder does not', () => {
  const pattern = buildPagePattern(template)
  assert.ok(!pattern.test(fill({ title: '</title><script>alert(1)</script><title>' })))
  assert.ok(!pattern.test(fill({ description: '"><script src="https://evil.example/x.js"></script><meta content="' })))
  assert.ok(!pattern.test(fill({ names: '[]}</script><script>alert(1)</script><script type="application/ld+json">{' })))
  assert.ok(!pattern.test(fill({ origin: 'https://evil.example/"><script>alert(1)</script><a href="' })))
})

test('a script added or swapped does not', () => {
  const pattern = buildPagePattern(template)
  assert.ok(!pattern.test(fill({}).replace('</head>', '<script src="/x.js"></script></head>')))
  assert.ok(!pattern.test(fill({}).replace('index-abc.js', 'index-evil.js')))
  assert.ok(!pattern.test(fill({}).replace('<div id="root"></div>', '<div id="root"><img src=x onerror=alert(1)></div>')))
})
