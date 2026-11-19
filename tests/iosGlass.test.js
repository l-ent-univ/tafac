import test from 'node:test'
import assert from 'node:assert/strict'
import { bezierOf, contentKey, controlTop, entrance, fitText, glassMessage, pictureKeys, rectsOverlap, shownUnderVeil, transformedBox, veilStrength } from '../src/iosGlassModel.js'

test('a control held to the screen stays there, the page pulled past its ends or not', () => {
  const bar = { anchor: 'fixed', y: 744 }
  for (const scroll of [-116, 0, 300, 5000]) assert.equal(controlTop(bar, scroll), 744)
})

test('a control in the page goes with it', () => {
  const button = { anchor: 'page', y: 78 }
  assert.equal(controlTop(button, 0), 78)
  assert.equal(controlTop(button, 60), 18)
  assert.equal(controlTop(button, -40), 118)
})

test('a sticky control goes with the page down to its line, and stays there', () => {
  // The mail reader's way back: 82 points down the page, stuck at 74.
  const pill = { anchor: 'sticky', y: 82, stick: 74 }
  assert.equal(controlTop(pill, 0), 82)
  assert.equal(controlTop(pill, 8), 74)
  assert.equal(controlTop(pill, 400), 74)
})

test('a sticky control comes down with the page pulled past its top, and holds past its end', () => {
  // The planning's header: on its line from the page's top.
  const pill = { anchor: 'sticky', y: 82, stick: 82 }
  assert.equal(controlTop(pill, -116), 198)
  assert.equal(controlTop(pill, 423), 82)
  assert.equal(controlTop(pill, 575), 82)
})

test('the end of what a sticky control is in takes it up', () => {
  const pill = { anchor: 'sticky', y: 62, stick: 62, limit: 500 }
  assert.equal(controlTop(pill, 400), 62)
  assert.equal(controlTop(pill, 438), 62)
  assert.equal(controlTop(pill, 600), -100)
  // An end above where it starts isn't one.
  assert.equal(controlTop({ ...pill, limit: 10 }, 0), 62)
})

test('the status bar\'s veil comes in between two scroll positions', () => {
  const veil = { height: 80, solid: 0.75, from: 24, to: 140 }
  assert.equal(veilStrength(0, veil), 0)
  assert.equal(veilStrength(24, veil), 0)
  assert.equal(veilStrength(82, veil), 0.5)
  assert.equal(veilStrength(140, veil), 1)
  assert.equal(veilStrength(900, veil), 1)
  // Without a scroll to follow it is always there.
  assert.equal(veilStrength(0, { ...veil, from: 0, to: 0 }), 1)
})

test('what passes under the veil shows less as the veil covers it', () => {
  const veil = { height: 80, solid: 0.75, from: 24, to: 140 }
  // Not scrolled: nothing is covered.
  assert.equal(shownUnderVeil(10, 0, veil), 1)
  // Scrolled: gone under its whole part, showing again down its fade.
  assert.equal(shownUnderVeil(10, 140, veil), 0)
  assert.equal(shownUnderVeil(60, 140, veil), 0)
  assert.equal(shownUnderVeil(70, 140, veil), 0.5)
  assert.equal(shownUnderVeil(80, 140, veil), 1)
  assert.equal(shownUnderVeil(300, 140, veil), 1)
  // Half way in: half covered.
  assert.equal(shownUnderVeil(10, 82, veil), 0.5)
})

test('a CSS easing as its curve', () => {
  assert.deepEqual(bezierOf('cubic-bezier(0.2, 0.8, 0.2, 1)'), [0.2, 0.8, 0.2, 1])
  assert.deepEqual(bezierOf('ease-out'), [0, 0, 0.58, 1])
  assert.deepEqual(bezierOf('linear'), [0, 0, 1, 1])
  assert.equal(bezierOf('steps(4, end)'), null)
  assert.equal(bezierOf('linear(0, 0.5 20%, 1)'), null)
  assert.equal(bezierOf(undefined), null)
})

test('a box under a transform about a point', () => {
  const box = { left: 350, top: 82, width: 40, height: 40 }
  // Scaled about the middle of the screen: nearer it, and smaller.
  assert.deepEqual(transformedBox(box, { x: 200, y: 450 }, { a: 0.5, d: 0.5, e: 0, f: 0 }), { left: 275, top: 266, width: 20, height: 20 })
  // Moved: the same size, further.
  assert.deepEqual(transformedBox(box, { x: 200, y: 450 }, { a: 1, d: 1, e: 32, f: -4 }), { left: 382, top: 78, width: 40, height: 40 })
})

test('a control comes in from where its page\'s animation starts it', () => {
  // The page comes up from 0.965 of its size around (201, 455).
  const to = { left: 350, top: 82, width: 40, height: 40, alpha: 1 }
  const scaled = (value, origin) => origin + 0.965 * (value - origin)
  const from = { ...transformedBox(to, { x: 201, y: 455 }, { a: 0.965, d: 0.965, e: 0, f: 0 }), alpha: 1 }
  const { move, alpha } = entrance(from, to)
  assert.equal(alpha, undefined)
  assert.ok(Math.abs(move.sx - 0.965) < 1e-9 && Math.abs(move.sy - 0.965) < 1e-9)
  assert.ok(Math.abs(move.dx - (scaled(370, 201) - 370)) < 1e-9)
  assert.ok(Math.abs(move.dy - (scaled(102, 455) - 102)) < 1e-9)
})

test('a control comes in from the opacity its page starts at', () => {
  const box = { left: 12, top: 82, width: 127, height: 44 }
  // A mail slides in from 32 points to the right, from nothing.
  assert.deepEqual(entrance({ ...box, left: 44, alpha: 0 }, { ...box, alpha: 1 }), { move: { dx: 32, dy: 0, sx: 1, sy: 1 }, alpha: 0 })
  // Nothing moves, nothing fades: no entrance.
  assert.equal(entrance({ ...box, alpha: 1 }, { ...box, alpha: 1 }), null)
  // It ends unseen: none either.
  assert.equal(entrance({ ...box, alpha: 1 }, { ...box, alpha: 0 }), null)
})

test('two boxes overlap when they share more than an edge', () => {
  const box = { left: 0, top: 0, right: 10, bottom: 10 }
  assert.equal(rectsOverlap(box, { left: 5, top: 5, right: 15, bottom: 15 }), true)
  assert.equal(rectsOverlap(box, { left: 10, top: 0, right: 20, bottom: 10 }), false)
  assert.equal(rectsOverlap(box, { left: 0, top: 12, right: 10, bottom: 20 }), false)
})

test('a text is cut to its room as the page cuts it', () => {
  const measure = (text) => text.length * 10
  assert.equal(fitText('Mardi 17 novembre', 200, measure), 'Mardi 17 novembre')
  assert.equal(fitText('Mardi 17 novembre', 100, measure), 'Mardi 17…')
  assert.equal(fitText('Mardi 17 novembre', 70, measure), 'Mardi…')
  assert.equal(fitText('Mardi', 5, measure), '…')
})

test('what a control shows has a short name of its own', () => {
  const key = contentKey('{"width":40,"height":40}')
  assert.match(key, /^[0-9a-z]+$/)
  assert.equal(contentKey('{"width":40,"height":40}'), key)
  assert.notEqual(contentKey('{"width":40,"height":41}'), key)
})

test('the app is sent only the pictures it doesn\'t hold', () => {
  const state = {
    dark: false,
    controls: [
      { id: 'glass-1', image: 'a' },
      { id: 'glass-2', image: 'b', spins: [{ image: 'c' }] },
      { id: 'glass-3' },
    ],
  }
  const pictures = new Map([['a', 'AAAA'], ['b', 'BBBB'], ['c', 'CCCC'], ['old', 'OOOO']])
  assert.deepEqual(pictureKeys(state), new Set(['a', 'b', 'c']))
  assert.deepEqual(glassMessage(state, pictures, new Set()).images, { a: 'AAAA', b: 'BBBB', c: 'CCCC' })
  assert.deepEqual(glassMessage(state, pictures, new Set(['a', 'c'])).images, { b: 'BBBB' })
  // Nothing new: no pictures at all.
  assert.equal('images' in glassMessage(state, pictures, new Set(['a', 'b', 'c'])), false)
  assert.deepEqual(glassMessage(state, pictures, new Set(['a', 'b', 'c'])).controls, state.controls)
})
