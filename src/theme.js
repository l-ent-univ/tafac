// Light/dark theme (Réglages › Apparence). Stored for the device rather than
// per account: index.html applies it before anyone is signed in, so the page
// never flashes the wrong theme. Keep THEME_KEY and the resolution below in
// sync with the inline script there.

import { maxChroma, oklchToHex } from './oklch.js'

export const THEME_KEY = 'l-ent:theme'
export const THEME_OPTIONS = ['auto', 'light', 'dark']

// Colour palettes, a second axis beside light/dark (tokens.css, <html
// data-palette>). A palette is a hue (OKLCH, 0–360) and a tint (how coloured
// the surfaces are, 1 = the presets'); tokens.css' recipe makes every role
// from them, in both themes. Sable, the original warm one, sets no
// attribute. The presets below are the picker's swatches, at the dial's
// middle; a preset at another intensity is `custom`. Keep the stored shape
// in sync with the inline script in index.html, which applies it before
// first paint.
export const PALETTE_KEY = 'l-ent:palette'
export const PALETTES = [
  { id: 'sand', label: 'Sable' },
  { id: 'ocean', label: 'Océan', hue: 245, tint: 1 },
  { id: 'forest', label: 'Forêt', hue: 150, tint: 1 },
  { id: 'lavender', label: 'Lavande', hue: 295, tint: 1 },
  { id: 'rose', label: 'Rose', hue: 355, tint: 1 },
  { id: 'coral', label: 'Corail', hue: 35, tint: 1 },
  { id: 'sun', label: 'Soleil', hue: 75, tint: 1 },
]
// Intensity, the picker's dial: 1 to 10, the presets' tint at 5 (the top of
// the dial), and one notch past the scale, 11. The tint of each, in order:
// under the first the surfaces are nearly grey; at 10 the lightest ones
// have reached the edge of sRGB on most hues, so 11 deepens the others and
// the dark theme. index.html takes a tint up to 2.
export const INTENSITY_TINTS = [0.3, 0.48, 0.65, 0.83, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 2]
export const INTENSITY_MIN = 1
export const INTENSITY_DEFAULT = 5
export const INTENSITY_MAX = 10
export const INTENSITY_ELEVEN = 11
export const TINT_MIN = INTENSITY_TINTS[0]
export const TINT_MAX = INTENSITY_TINTS[INTENSITY_ELEVEN - 1]

export function tintOfIntensity(intensity) {
  const step = Math.min(INTENSITY_ELEVEN, Math.max(INTENSITY_MIN, Math.round(intensity)))
  return INTENSITY_TINTS[step - 1]
}

// The dial's notch for a palette: the one whose tint is nearest (a tint
// stored before the dial falls between two). Sable has none: the middle.
export function intensityOf(palette) {
  if (!Number.isFinite(palette?.tint)) return INTENSITY_DEFAULT
  let nearest = 0
  for (let index = 1; index < INTENSITY_TINTS.length; index += 1) {
    if (Math.abs(INTENSITY_TINTS[index] - palette.tint) < Math.abs(INTENSITY_TINTS[nearest] - palette.tint)) nearest = index
  }
  return nearest + 1
}
// Sable's colours, the light and dark themes of tokens.css as they are.
const SAND = { swatch: '#341200', swatchDark: '#e4e4e4', page: { light: '#FCFBF8', dark: '#0f0f0f' } }

// Surfaces of the recipe (tokens.css) the brand must read on: the lightest
// page the tint allows and the subtle surface, where a brand text can sit.
const LIGHT_SUBTLE = [0.94, 0.03]
const LIGHT_PAGE = [0.982, 0.016]
const DARK_PAGE = [0.17, 0.024]
// The dark brand (tokens.css): lighter, with four fifths of the chroma.
const DARK_BRAND_L = 0.78
const DARK_BRAND_CHROMA = 0.8

function parseHex(hex) {
  return hex.slice(1).match(/../g).map((pair) => parseInt(pair, 16))
}

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

// The brand colour of a hue, in light theme: as light as keeps 4.5:1 under
// white text and as text on the subtle surface, with as much chroma as the
// tint asks for and sRGB allows (vivid at the top of the dial, muted at its
// start). tokens.css derives the dark brand from it.
export function brandFor(hue, tint) {
  const cap = Math.min(0.19, 0.07 + 0.1 * tint)
  const subtle = oklchToHex(LIGHT_SUBTLE[0], LIGHT_SUBTLE[1] * tint, hue)
  for (let l = 0.56; l >= 0.4; l -= 0.005) {
    const c = Math.min(cap, maxChroma(l, hue))
    const hex = oklchToHex(l, c, hue)
    if (contrast(hex, '#ffffff') >= 4.5 && contrast(hex, subtle) >= 4.5) {
      return { l: Number(l.toFixed(3)), c: Number(c.toFixed(3)), hex }
    }
  }
  return { l: 0.4, c: 0, hex: oklchToHex(0.4, 0, hue) }
}

// What the picker and the browser chrome need of a palette: the swatch's
// colour in each theme (the brand, as tokens.css derives it) and the page
// colour of each theme.
export function paletteColors(palette) {
  if (palette.id === 'sand') return SAND
  const brand = brandFor(palette.hue, palette.tint)
  return {
    swatch: brand.hex,
    swatchDark: oklchToHex(DARK_BRAND_L, brand.c * DARK_BRAND_CHROMA, palette.hue),
    page: {
      light: oklchToHex(LIGHT_PAGE[0], LIGHT_PAGE[1] * palette.tint, palette.hue),
      dark: oklchToHex(DARK_PAGE[0], DARK_PAGE[1] * palette.tint, palette.hue),
    },
  }
}

const clampTint = (tint) => Math.min(TINT_MAX, Math.max(TINT_MIN, tint))
const wrapHue = (hue) => ((hue % 360) + 360) % 360

// The name of a hue no preset has (a pick stored before the swatches), from
// its OKLCH hue: the colour's family, where each sector starts. It reads
// "Turquoise" rather than "Personnalisée".
const HUE_NAMES = [
  [0, 'Rose'], [8, 'Rouge'], [28, 'Corail'], [50, 'Orange'], [68, 'Ambre'], [92, 'Jaune'], [112, 'Citron'],
  [132, 'Vert'], [162, 'Émeraude'], [182, 'Turquoise'], [208, 'Cyan'], [228, 'Bleu'], [268, 'Indigo'],
  [284, 'Violet'], [310, 'Pourpre'], [336, 'Rose'],
]

export function hueName(hue) {
  const h = wrapHue(hue)
  let name = HUE_NAMES[0][1]
  for (const [start, label] of HUE_NAMES) if (h >= start) name = label
  return name
}

// A palette from a hue and a tint: the preset there when there is one,
// otherwise `custom`. A preset's hue keeps its name at any intensity; any
// other hue is named for its family.
export function paletteAt(hue, tint) {
  const h = Math.round(wrapHue(hue))
  const t = Number(clampTint(tint).toFixed(2))
  const preset = PALETTES.find((entry) => entry.hue === h)
  if (preset?.tint === t) return preset
  return { id: 'custom', label: preset?.label ?? hueName(h), hue: h, tint: t }
}

function isValidNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function getSystemDarkQuery() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null
}

export function getStoredTheme() {
  try {
    const stored = JSON.parse(localStorage.getItem(THEME_KEY) || 'null')
    return THEME_OPTIONS.includes(stored?.value) ? stored.value : 'auto'
  } catch {
    return 'auto'
  }
}

export function persistTheme(theme) {
  try {
    if (theme === 'auto') {
      localStorage.removeItem(THEME_KEY)
    } else {
      localStorage.setItem(THEME_KEY, JSON.stringify({ value: theme }))
    }
  } catch {
    // Storage unavailable
  }
}

// The stored palette: a preset by its id, or `custom` from its numbers.
export function getStoredPalette() {
  try {
    const stored = JSON.parse(localStorage.getItem(PALETTE_KEY) || 'null')
    const preset = PALETTES.find((entry) => entry.id === stored?.value)
    if (preset) return preset
    if (stored?.value === 'custom' && isValidNumber(stored.hue, 0, 360) && isValidNumber(stored.tint, TINT_MIN, TINT_MAX)) {
      return paletteAt(stored.hue, stored.tint)
    }
    return PALETTES[0]
  } catch {
    return PALETTES[0]
  }
}

// Stored with the numbers index.html paints before the app loads: the hue,
// the tint and the brand's lightness and chroma (brandFor needs the gamut
// search; the inline script only reads). Sable stores nothing.
export function persistPalette(palette) {
  try {
    if (palette.id === 'sand') {
      localStorage.removeItem(PALETTE_KEY)
    } else {
      const brand = brandFor(palette.hue, palette.tint)
      localStorage.setItem(PALETTE_KEY, JSON.stringify({
        value: palette.id, hue: palette.hue, tint: palette.tint, brandL: brand.l, brandC: brand.c,
      }))
    }
  } catch {
    // Storage unavailable
  }
}

// The hue as the same angle nearest the one on <html> (245 after 355 is
// written 365): tokens.css eases the numbers between two picks, and the
// short way round keeps the page from sweeping through every other hue.
function nearestTurn(hue, current) {
  if (!Number.isFinite(current)) return hue
  const turns = Math.round((current - hue) / 360)
  return hue + turns * 360
}

const PALETTE_NUMBERS = ['--p-hue', '--p-tint', '--p-brand-l', '--p-brand-c']
let settleFrame = 0

// Paints `palette` on <html>: the attribute tokens.css' recipe hooks on and
// the numbers it reads. Sable clears both. tokens.css eases the numbers
// from one pick to the next, a notch of the dial included. Leaving Sable,
// the first numbers are set without easing (data-palette-live): the recipe
// has nothing to ease from.
export function applyPalette(palette) {
  const root = document.documentElement
  cancelAnimationFrame(settleFrame)
  if (palette.id === 'sand') {
    delete root.dataset.palette
    root.removeAttribute('data-palette-live')
    for (const name of PALETTE_NUMBERS) root.style.removeProperty(name)
    return
  }
  const brand = brandFor(palette.hue, palette.tint)
  const fromSand = !('palette' in root.dataset)
  const hue = nearestTurn(palette.hue, parseFloat(root.style.getPropertyValue('--p-hue')))
  root.dataset.palette = palette.id
  root.toggleAttribute('data-palette-live', fromSand)
  root.style.setProperty('--p-hue', String(hue))
  root.style.setProperty('--p-tint', String(palette.tint))
  root.style.setProperty('--p-brand-l', String(brand.l))
  root.style.setProperty('--p-brand-c', String(brand.c))
  if (fromSand) {
    // Two frames on: the first paints the numbers, the second eases again.
    settleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => root.removeAttribute('data-palette-live'))
    })
  }
}

function applyTheme(theme, palette) {
  const resolved = theme === 'auto'
    ? (getSystemDarkQuery()?.matches ? 'dark' : 'light')
    : theme
  document.documentElement.dataset.theme = resolved
  applyPalette(palette)
  const colors = paletteColors(palette).page

  // index.html ships one theme-color per system scheme; a forced theme
  // paints both with its own colour.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = theme === 'auto'
      ? (meta.media.includes('dark') ? 'dark' : 'light')
      : resolved
    meta.content = colors[scheme]
  }
}

// Applies `theme` and `palette` now and, for "auto", again whenever the
// system switches. Returns the cleanup.
export function watchTheme(theme, palette = PALETTES[0]) {
  applyTheme(theme, palette)

  const query = getSystemDarkQuery()
  if (theme !== 'auto' || !query) {
    return () => {}
  }

  const handleChange = () => applyTheme('auto', palette)
  query.addEventListener('change', handleChange)
  return () => query.removeEventListener('change', handleChange)
}
