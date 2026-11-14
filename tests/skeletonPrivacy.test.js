import assert from 'node:assert/strict'
import test from 'node:test'
import { SKELETON_SHAPES_KEY, installSkeletonPrivacy, scrubShapeMarkup, scrubStoredShapes } from '../src/skeletonPrivacy.js'

// A card as skullet keeps it: its text already replaced, its attributes not.
const CARD = '<a class="grade" href="/notes?eval=412" aria-label="Dernière note : 15,5 sur 20, Revue de presse, R5.11" title="Revue de presse" data-new="true" style="width:120px"><span class="title">Xxxxx xx xxxxxx</span><span>00.0</span></a>'

test('a remembered shape keeps its layout and none of its words', () => {
  const scrubbed = scrubShapeMarkup(CARD)
  assert.equal(scrubbed, '<a class="grade" data-new="true" style="width:120px"><span class="title">Xxxxx xx xxxxxx</span><span>00.0</span></a>')
  for (const word of ['15,5', 'Revue', 'R5.11', 'eval=412']) assert.equal(scrubbed.includes(word), false, word)
  assert.equal(scrubShapeMarkup(null), null)
})

test('what skullet stores is cleaned, shape by shape', () => {
  const stored = JSON.stringify({ v: 2, shapes: { 'recent-grades': CARD, 'recent-mail': '<li aria-label="Thomas Lemoine, Rendu du dossier">Xxxxxx</li>' } })
  const scrubbed = JSON.parse(scrubStoredShapes(stored))
  assert.equal(scrubbed.v, 2)
  assert.deepEqual(Object.keys(scrubbed.shapes), ['recent-grades', 'recent-mail'])
  assert.equal(scrubbed.shapes['recent-mail'], '<li>Xxxxxx</li>')
  assert.equal(JSON.stringify(scrubbed).includes('Lemoine'), false)

  // Not that shape of value: left as written.
  assert.equal(scrubStoredShapes('not json'), 'not json')
  assert.equal(scrubStoredShapes('{"v":2}'), '{"v":2}')
})

test('only that key is touched on its way into storage', () => {
  const written = new Map()
  const prototype = { setItem(key, value) { written.set(key, value) } }
  installSkeletonPrivacy(prototype)
  installSkeletonPrivacy(prototype)

  const storage = Object.create(prototype)
  storage.setItem(SKELETON_SHAPES_KEY, JSON.stringify({ v: 2, shapes: { card: CARD } }))
  storage.setItem('l-ent:weather-city', 'title="Brest"')

  assert.equal(written.get(SKELETON_SHAPES_KEY).includes('Revue'), false)
  assert.equal(written.get('l-ent:weather-city'), 'title="Brest"')
})
