import assert from 'node:assert/strict'
import test from 'node:test'
import { coverSourceRect, parseBackgroundPosition, pickCreditInk, pickWallpaperTint } from '../src/wallpaperInk.js'

test('background positions as fractions, the band’s "center 40%" by default', () => {
  assert.deepEqual(parseBackgroundPosition(null), { x: 0.5, y: 0.4 })
  assert.deepEqual(parseBackgroundPosition('center 40%'), { x: 0.5, y: 0.4 })
  assert.deepEqual(parseBackgroundPosition('30% 60%'), { x: 0.3, y: 0.6 })
  assert.deepEqual(parseBackgroundPosition('left top'), { x: 0, y: 0 })
  assert.deepEqual(parseBackgroundPosition('right'), { x: 1, y: 0.5 })
})

test('the corner of a wide band, on a 4:3 photo drawn with cover', () => {
  // 1000×750 photo in a 1000×200 band: scale 1, 550px cropped, 40% of it above.
  const rect = coverSourceRect({
    imageWidth: 1000,
    imageHeight: 750,
    boxWidth: 1000,
    boxHeight: 200,
    position: 'center 40%',
    area: { left: 800, top: 170, width: 200, height: 30 },
  })
  assert.deepEqual(rect, { x: 800, y: 390, width: 200, height: 30 })
})

test('white on a dark photo, black on a light one, the band’s tint counted', () => {
  assert.equal(pickCreditInk([40, 60, 30]), 'light')
  assert.equal(pickCreditInk([220, 220, 210]), 'dark')
  // A dark photo faded to 30% over a light tint reads as light: black ink.
  assert.equal(pickCreditInk([40, 60, 30], 0.3, [243, 240, 235]), 'dark')
})

const pixels = (...colors) => new Uint8ClampedArray(colors.flatMap(([color, n]) => Array.from({ length: n }, () => [...color, 255]).flat()))

test('the band’s tint: the photo’s vivid colour over its greys', () => {
  // Mostly grey, a third blue sky: the blue.
  assert.equal(pickWallpaperTint(pixels([[128, 128, 128], 60], [[40, 110, 200], 30])), '#286ec8')
  // Two colours: the more vivid one counts more than its share.
  assert.equal(pickWallpaperTint(pixels([[150, 140, 120], 50], [[220, 60, 40], 30])), '#dc3c28')
  // A grey photo: its average grey.
  assert.equal(pickWallpaperTint(pixels([[100, 100, 100], 1], [[200, 200, 200], 1])), '#969696')
  assert.equal(pickWallpaperTint(new Uint8ClampedArray(0)), null)
})
