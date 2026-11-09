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
// attribute. The presets below are points on the picker's pad; anything
// else is `custom`. Keep the stored shape in sync with the inline script in
// index.html, which applies it before first paint.
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
// The pad's reach: its inner edge to its rim. Under TINT_MIN the surfaces
// are nearly grey, over TINT_MAX they leave the sRGB gamut on most hues.
export const TINT_MIN = 0.3
export const TINT_MAX = 1.5
// Contrast (the picker's slider): 0 soft to 1 firm, the recipe as drawn at
// the middle. It rides on whichever palette is picked; Sable ignores it.
export const CONTRAST_DEFAULT = 0.5

export function contrastOf(palette) {
  return isValidNumber(palette?.contrast, 0, 1) ? palette.contrast : CONTRAST_DEFAULT
}

// `palette` with `contrast`, the default left off so a preset stays itself.
export function withContrast(palette, contrast) {
  const { contrast: _previous, ...rest } = palette
  return contrast === CONTRAST_DEFAULT ? rest : { ...rest, contrast }
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
// tint asks for and sRGB allows (a vivid dot at the pad's rim, a muted one
// near its centre). tokens.css derives the dark brand from it.
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

// What the picker and the browser chrome need of a palette: the dot's
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

// The name of a custom pick, from its OKLCH hue: the colour's family, where
// each sector starts. A pick reads "Turquoise" rather than "Personnalisée".
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

// A palette from a hue and a tint: the preset there when there is one
// (the picker's dots snap to them), otherwise `custom`, named for its hue.
export function paletteAt(hue, tint) {
  const h = Math.round(wrapHue(hue))
  const t = Number(clampTint(tint).toFixed(2))
  const preset = PALETTES.find((entry) => entry.hue === h && entry.tint === t)
  return preset ?? { id: 'custom', label: hueName(h), hue: h, tint: t }
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
    const contrast = contrastOf(stored)
    const preset = PALETTES.find((entry) => entry.id === stored?.value)
    if (preset) return withContrast(preset, contrast)
    if (stored?.value === 'custom' && isValidNumber(stored.hue, 0, 360) && isValidNumber(stored.tint, TINT_MIN, TINT_MAX)) {
      return withContrast(paletteAt(stored.hue, stored.tint), contrast)
    }
    return PALETTES[0]
  } catch {
    return PALETTES[0]
  }
}

// Stored with the numbers index.html paints before the app loads: the hue,
// the tint and the brand's lightness and chroma (brandFor needs the gamut
// search; the inline script only reads), and the contrast. Sable keeps its
// contrast for the next palette, nothing else.
export function persistPalette(palette) {
  try {
    const contrast = contrastOf(palette)
    if (palette.id === 'sand' && contrast === CONTRAST_DEFAULT) {
      localStorage.removeItem(PALETTE_KEY)
    } else if (palette.id === 'sand') {
      localStorage.setItem(PALETTE_KEY, JSON.stringify({ value: 'sand', contrast }))
    } else {
      const brand = brandFor(palette.hue, palette.tint)
      localStorage.setItem(PALETTE_KEY, JSON.stringify({
        value: palette.id, hue: palette.hue, tint: palette.tint, brandL: brand.l, brandC: brand.c, contrast,
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

const PALETTE_NUMBERS = ['--p-hue', '--p-tint', '--p-brand-l', '--p-brand-c', '--p-contrast']
let settleFrame = 0

// Paints `palette` on <html>: the attribute tokens.css' recipe hooks on and
// the numbers it reads. Sable clears both. tokens.css eases the numbers
// from one pick to the next; `live` (the picker's drag, which paints every
// frame without going through React) turns that off so the page sits on
// the dot. Leaving Sable, the first numbers are set without easing too: the
// recipe has nothing to ease from.
export function applyPalette(palette, { live = false } = {}) {
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
  root.toggleAttribute('data-palette-live', live || fromSand)
  root.style.setProperty('--p-hue', String(hue))
  root.style.setProperty('--p-tint', String(palette.tint))
  root.style.setProperty('--p-brand-l', String(brand.l))
  root.style.setProperty('--p-brand-c', String(brand.c))
  root.style.setProperty('--p-contrast', String(contrastOf(palette)))
  if (fromSand && !live) {
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
