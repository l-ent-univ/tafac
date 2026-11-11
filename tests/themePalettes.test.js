import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { contrastRatio } from '../src/colorContrast.js'
import { oklchToHex } from '../src/oklch.js'
import {
  INTENSITY_DEFAULT, INTENSITY_ELEVEN, INTENSITY_MAX, INTENSITY_MIN, INTENSITY_TINTS, PALETTES, PALETTE_KEY, TINT_MAX, TINT_MIN,
  brandFor, getStoredPalette, hueName, intensityOf, paletteAt, paletteColors, persistPalette, tintOfIntensity,
} from '../src/theme.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const tokens = read('../src/tokens.css')
const presets = PALETTES.filter((palette) => palette.id !== 'sand')

// The recipe's surfaces (tokens.css), as [lightness, chroma per unit of
// tint] at the middle contrast and above: what the contrast checks below
// stand on. Under the middle, each but the light page and card draws
// toward the page (--p-depth). The first test pins each to the
// stylesheet, so a change there is a change here.
const LIGHT = {
  '--surface-page': [0.982, 0.016],
  '--surface-sunken': [0.948, 0.028],
  '--surface-subtle': [0.94, 0.03],
  '--surface-strong': [0.905, 0.04],
  '--surface-field': [0.962, 0.02],
  '--surface-card': [0.997, 0.005],
}
const DARK = {
  '--surface-page': [0.17, 0.024],
  '--surface-sunken': [0.205, 0.028],
  '--surface-subtle': [0.225, 0.03],
  '--surface-strong': [0.29, 0.034],
  '--surface-field': [0.205, 0.028],
  '--surface-card': [0.22, 0.03],
  '--surface-thumb': [0.34, 0.04],
}
const LIGHT_INK = [0.27, 0.06]
const DARK_INK = [0.93, 0.02]
const LIGHT_MUTED = 0.7
const DARK_MUTED = 0.64
// Contrast (--p-contrast, 0 to 1, fixed at the middle: nothing sets it for
// now): the ink's lightness moves by INK_SWING per unit away from the
// middle, and under the middle muted ink takes MUTED_SOFTEN more of it per
// unit.
const LIGHT_INK_SWING = -0.24
const DARK_INK_SWING = 0.12
const MUTED_SOFTEN = 0.24
const LIGHT_FIXED = ['--surface-page', '--surface-card']
const contrasts = [0, 0.25, 0.5, 0.75, 1]
const fmt = (value) => String(Number(value.toFixed(3)))
const DARK_BRAND_L = 0.78
const DARK_ON_BRAND = [0.2, 0.04]

const surface = ([l, chroma], tint, hue) => oklchToHex(l, chroma * tint, hue)
const depthOf = (contrast) => Math.min(1, 0.5 + contrast)
const softenOf = (contrast) => Math.max(0, 0.5 - contrast)
// A surface at a contrast: its step from the page, scaled by the depth.
function surfaceAt(name, [l, chroma], base, contrast, tint, hue, fixed = []) {
  const lightness = fixed.includes(name) ? l : base + (l - base) * depthOf(contrast)
  return oklchToHex(lightness, chroma * tint, hue)
}

// color-mix(in srgb, ink pct, transparent) over a surface.
function mix(ink, over, share) {
  const a = ink.slice(1).match(/../g).map((pair) => parseInt(pair, 16))
  const b = over.slice(1).match(/../g).map((pair) => parseInt(pair, 16))
  return `#${a.map((channel, i) => Math.round(channel * share + b[i] * (1 - share)).toString(16).padStart(2, '0')).join('')}`
}

const hues = Array.from({ length: 360 }, (_, hue) => hue)
// Every tint the dial reaches, 11 included.
const tints = INTENSITY_TINTS

test('the recipe in tokens.css is the one the checks stand on', () => {
  const [light, dark] = tokens.split(':root[data-palette][data-theme="dark"]')
  const tinted = (chroma) => `calc\\(${chroma} \\* var\\(--p-tint\\)\\) var\\(--p-hue\\)`
  const page = LIGHT['--surface-page'][0]
  for (const [name, [l, chroma]] of Object.entries(LIGHT)) {
    const lightness = LIGHT_FIXED.includes(name) ? fmt(l) : `calc\\(${page} - ${fmt(page - l)} \\* var\\(--p-depth\\)\\)`
    assert.match(light, new RegExp(`${name}: oklch\\(${lightness} ${tinted(chroma)}`), name)
  }
  const darkPage = DARK['--surface-page'][0]
  for (const [name, [l, chroma]] of Object.entries(DARK)) {
    const lightness = name === '--surface-page' ? fmt(l) : `calc\\(${darkPage} \\+ ${fmt(l - darkPage)} \\* var\\(--p-depth\\)\\)`
    assert.match(dark, new RegExp(`${name}: oklch\\(${lightness} ${tinted(chroma)}`), name)
  }
  assert.match(light, /--p-depth: min\(1, calc\(0\.5 \+ var\(--p-contrast\)\)\);/)
  assert.match(light, /--p-soften: max\(0, calc\(0\.5 - var\(--p-contrast\)\)\);/)
  assert.match(light, new RegExp(`--ink: oklch\\(calc\\(${LIGHT_INK[0]} - ${-LIGHT_INK_SWING} \\* \\(var\\(--p-contrast\\) - 0.5\\)\\) ${LIGHT_INK[1]} var\\(--p-hue\\)\\)`))
  assert.match(light, new RegExp(`--ink-muted: color-mix\\(in srgb, var\\(--ink\\) calc\\(${LIGHT_MUTED * 100}% \\+ ${MUTED_SOFTEN * 100}% \\* var\\(--p-soften\\)\\), transparent\\)`))
  assert.match(dark, new RegExp(`--ink: oklch\\(min\\(0.99, calc\\(${DARK_INK[0]} \\+ ${DARK_INK_SWING} \\* \\(var\\(--p-contrast\\) - 0.5\\)\\)\\) ${DARK_INK[1]} var\\(--p-hue\\)\\)`))
  assert.match(dark, new RegExp(`--ink-muted: color-mix\\(in srgb, var\\(--ink\\) calc\\(${DARK_MUTED * 100}% \\+ ${MUTED_SOFTEN * 100}% \\* var\\(--p-soften\\)\\), transparent\\)`))
  assert.match(light, /--brand: oklch\(var\(--p-brand-l\) var\(--p-brand-c\) var\(--p-hue\)\)/)
  assert.match(dark, new RegExp(`--brand: oklch\\(${DARK_BRAND_L} calc\\(var\\(--p-brand-c\\) \\* 0.8\\) var\\(--p-hue\\)\\)`))
  assert.match(dark, new RegExp(`--on-brand: oklch\\(${DARK_ON_BRAND[0]} ${DARK_ON_BRAND[1]} var\\(--p-hue\\)\\)`))
  // One recipe for every palette: no per-id selector left.
  assert.doesNotMatch(tokens, /data-palette="/)
})

// Sable is the light and dark themes as they are: no palette attribute,
// and its colours untouched.
test('Sable sets no attribute and keeps its colours', () => {
  assert.deepEqual(paletteColors(PALETTES[0]), { swatch: '#341200', swatchDark: '#e4e4e4', page: { light: '#FCFBF8', dark: '#0f0f0f' } })
  assert.match(tokens, /--sand-1: #fcfbf8;/)
  assert.match(tokens, /--night-0: #0f0f0f;/)
  assert.match(tokens, /--cocoa-900: #341200;/)
  assert.match(tokens, /--ink-muted: color-mix\(in srgb, var\(--ink\) 50%, transparent\);/)
})

test('index.html applies the stored numbers before first paint', () => {
  const html = read('../index.html')
  assert.ok(html.includes(`localStorage.getItem('${PALETTE_KEY}')`))
  for (const name of ['--p-hue', '--p-tint', '--p-brand-l', '--p-brand-c']) {
    assert.ok(html.includes(`root.style.setProperty('${name}'`), name)
  }
  assert.ok(html.includes("root.setAttribute('data-palette', palette.value)"))
})

// Whatever the swatch and the notch: the brand reads under white and as
// text on the page and the subtle surface, in both themes.
test('the brand keeps 4.5:1 for any hue and tint', () => {
  for (const hue of hues) {
    for (const tint of tints) {
      const { hex, l, c } = brandFor(hue, tint)
      assert.ok(contrastRatio(hex, '#ffffff') >= 4.5, `${hue}° ${tint}: under white`)
      assert.ok(contrastRatio(hex, surface(LIGHT['--surface-page'], tint, hue)) >= 4.5, `${hue}° ${tint}: on page`)
      assert.ok(contrastRatio(hex, surface(LIGHT['--surface-subtle'], tint, hue)) >= 4.5, `${hue}° ${tint}: on subtle`)
      assert.ok(l >= 0.4 && l <= 0.6 && c >= 0 && c <= 0.2, `${hue}° ${tint}: within index.html's ranges`)
      const dark = oklchToHex(DARK_BRAND_L, c * 0.8, hue)
      assert.ok(contrastRatio(dark, oklchToHex(...DARK_ON_BRAND, hue)) >= 4.5, `${hue}° ${tint}: dark, under its text`)
      assert.ok(contrastRatio(dark, surface(DARK['--surface-page'], tint, hue)) >= 4.5, `${hue}° ${tint}: dark, on page`)
    }
  }
})

// At every contrast the recipe allows, should one be set again; the brand
// is checked above against the middle's surfaces (the deepest: higher
// contrast keeps them).
test('the ink and the muted ink keep 4.5:1 on every surface, for any hue, tint and contrast', () => {
  for (const contrast of contrasts) {
    const light = Math.max(0, Math.min(1, LIGHT_MUTED + MUTED_SOFTEN * softenOf(contrast)))
    const darkShare = Math.max(0, Math.min(1, DARK_MUTED + MUTED_SOFTEN * softenOf(contrast)))
    for (let hue = 0; hue < 360; hue += 2) {
      for (const tint of tints) {
        const ink = oklchToHex(LIGHT_INK[0] + LIGHT_INK_SWING * (contrast - 0.5), LIGHT_INK[1], hue)
        for (const [name, spec] of Object.entries(LIGHT)) {
          const over = surfaceAt(name, spec, LIGHT['--surface-page'][0], contrast, tint, hue, LIGHT_FIXED)
          assert.ok(contrastRatio(mix(ink, over, light), over) >= 4.5, `${hue}° ${tint} ${contrast}: muted on ${name}`)
        }
        const darkInk = oklchToHex(Math.min(0.99, DARK_INK[0] + DARK_INK_SWING * (contrast - 0.5)), DARK_INK[1], hue)
        for (const [name, spec] of Object.entries(DARK)) {
          const over = surfaceAt(name, spec, DARK['--surface-page'][0], contrast, tint, hue, ['--surface-page'])
          assert.ok(contrastRatio(mix(darkInk, over, darkShare), over) >= 4.5, `${hue}° ${tint} ${contrast}: dark muted on ${name}`)
        }
      }
    }
  }
})

test('the presets are palettes of their own, and their swatches read on the page', () => {
  for (const preset of presets) {
    assert.equal(paletteAt(preset.hue, preset.tint), preset)
    const { swatch, swatchDark, page } = paletteColors(preset)
    assert.ok(contrastRatio(swatch, page.light) >= 4.5, `${preset.id} on page`)
    assert.ok(contrastRatio(swatch, '#ffffff') >= 4.5, `${preset.id} under white`)
    assert.ok(contrastRatio(swatchDark, page.dark) >= 4.5, `${preset.id} on the dark page`)
  }
  assert.equal(paletteAt(245, 0.9).id, 'custom')
  assert.equal(paletteAt(-10, 5).hue, 350)
  assert.equal(paletteAt(-10, 5).tint, TINT_MAX)
})

// A preset keeps its name at any intensity; a hue none of them has is named
// for its family, and the presets' hues fall in the family they are named
// for.
test('a pick off the presets carries the name of its hue', () => {
  for (const hue of hues) assert.ok(hueName(hue).length > 0, `${hue}°`)
  assert.equal(hueName(360), hueName(0))
  assert.equal(hueName(-5), 'Rose')
  assert.deepEqual([245, 150, 295, 355, 35].map(hueName), ['Bleu', 'Vert', 'Violet', 'Rose', 'Corail'])
  assert.equal(paletteAt(245, 0.9).label, 'Océan')
  assert.equal(paletteAt(200, 0.9).label, 'Turquoise')
})

// The dial: ten notches and 11, each a tint of its own that survives the
// rounding of paletteAt (so of storage); the presets sit on the middle one,
// and 11's tint is one index.html accepts.
test('the dial\'s notches are tints, the presets at the middle', () => {
  assert.equal(INTENSITY_TINTS.length, INTENSITY_ELEVEN)
  assert.deepEqual([TINT_MIN, TINT_MAX], [tintOfIntensity(INTENSITY_MIN), tintOfIntensity(INTENSITY_ELEVEN)])
  assert.ok(tintOfIntensity(INTENSITY_ELEVEN) > tintOfIntensity(INTENSITY_MAX))
  assert.ok(TINT_MAX <= 2, 'within index.html\'s range')
  for (let step = INTENSITY_MIN; step <= INTENSITY_ELEVEN; step += 1) {
    const tint = tintOfIntensity(step)
    if (step > INTENSITY_MIN) assert.ok(tint > tintOfIntensity(step - 1), `${step} deepens`)
    const palette = paletteAt(245, tint)
    assert.equal(palette.tint, tint, `${step} survives rounding`)
    assert.equal(intensityOf(palette), step)
    assert.equal(palette.id, step === INTENSITY_DEFAULT ? 'ocean' : 'custom')
  }
  for (const preset of presets) assert.equal(intensityOf(preset), INTENSITY_DEFAULT, preset.id)
  assert.equal(intensityOf(PALETTES[0]), INTENSITY_DEFAULT)
  // Out of range, the nearest end; between two notches, the nearest.
  assert.equal(tintOfIntensity(0), TINT_MIN)
  assert.equal(tintOfIntensity(40), TINT_MAX)
  assert.equal(intensityOf(paletteAt(200, 0.55)), 2)
})

// The glide between two picks: the numbers are registered so they ease,
// eased on <html> with a palette, and not while the contrast is dragged nor
// under reduced motion.
test('tokens.css eases the palette numbers between picks', () => {
  for (const name of ['--p-hue', '--p-tint', '--p-brand-l', '--p-brand-c']) {
    assert.match(tokens, new RegExp(`@property ${name} \\{\\s*syntax: '<number>';\\s*inherits: true;`), name)
    assert.match(tokens, new RegExp(`:root\\[data-palette\\] \\{[^}]*transition:[^}]*${name} 320ms`), `${name} eased`)
  }
  assert.match(tokens, /:root\[data-palette-live\] \{\s*transition: none;/)
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\) \{\s*:root\[data-palette\] \{\s*transition: none;/)
})

// What is stored carries the numbers index.html paints with; a preset's
// id comes back as the preset, a custom pick as itself, nonsense as Sable.
test('a palette round-trips through storage', () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  }
  try {
    persistPalette(PALETTES[0])
    assert.equal(store.has(PALETTE_KEY), false)

    persistPalette(paletteAt(245, 1))
    const stored = JSON.parse(store.get(PALETTE_KEY))
    assert.equal(stored.value, 'ocean')
    assert.deepEqual([stored.hue, stored.tint], [245, 1])
    assert.deepEqual([stored.brandL, stored.brandC], [brandFor(245, 1).l, brandFor(245, 1).c])
    assert.equal(getStoredPalette().id, 'ocean')

    persistPalette(paletteAt(200, 0.55))
    assert.deepEqual(getStoredPalette(), { id: 'custom', label: 'Turquoise', hue: 200, tint: 0.55 })

    store.set(PALETTE_KEY, JSON.stringify({ value: 'custom', hue: 720, tint: 1 }))
    assert.equal(getStoredPalette().id, 'sand')
    // A contrast kept from when the settings had a slider for it is dropped.
    store.set(PALETTE_KEY, JSON.stringify({ value: 'ocean', hue: 245, tint: 1, contrast: 1 }))
    assert.deepEqual(getStoredPalette(), PALETTES[1])
    store.set(PALETTE_KEY, JSON.stringify({ value: 'sand', contrast: 0.2 }))
    assert.deepEqual(getStoredPalette(), PALETTES[0])
    store.set(PALETTE_KEY, 'not json')
    assert.equal(getStoredPalette().id, 'sand')
  } finally {
    delete globalThis.localStorage
  }
})
