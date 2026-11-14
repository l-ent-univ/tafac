// The design gallery's code scan (src/dev/DesignGallery.jsx, dev only): what
// the sources use outside the design system, so its gaps show. Pure: given
// { path: text }, it returns the findings with their file and line; the
// gallery loads the texts with import.meta.glob(…, { query: '?raw' }).

// The old colour names (tokens.css' aliases) as Tailwind classes: text-text-muted,
// bg-widget-bg, border-border-input…
const LEGACY_CLASS = /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border|ring|divide|outline|decoration|fill|stroke|placeholder|from|via|to|caret|accent)-(?:bg(?:-surface|-subtle|-muted|-input)?|widget-bg|text(?:-30|-50|-60|-70|-secondary|-muted)?|brand-subtle|border(?:-input)?|error(?:-bg)?|success-bg|success-text|backdrop|context-bg|context-hover)(?![\w-])/g
const LEGACY_VAR = /var\(--color-[\w-]+\)/g
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
const RGB = /rgba?\(\s*\d[^)]*\)/g
const FONT_SIZE_PX = /(?<![\w-])(?:[\w-]+:)*text-\[(\d+(?:\.\d+)?)px\]/g
const FONT_SIZE_NAMED = /(?<![\w-])(?:[\w-]+:)*text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)(?![\w-])/g
const CSS_FONT_SIZE = /font-size:\s*([\d.]+px)/g
const RADIUS_CLASS = /(?<![\w-])(?:[\w-]+:)*(?:rounded|corners)(?:-[trbl]{1,2})?-\[([^\]]+)\]/g
const CSS_RADIUS = /border-radius:\s*([^;]+);/g
const SHADOW_CLASS = /(?<![\w-])(?:[\w-]+:)*shadow-\[([^\]]+)\]/g
const CSS_SHADOW = /box-shadow:\s*([^;]+);/g
const DARK_ARBITRARY = /(?<![\w-])dark:[\w:-]*-\[[^\]]*(?:#|rgb)[^\]]*\]/g
const Z_ARBITRARY = /(?<![\w-])(?:[\w-]+:)*z-\[(\d+)\]/g

function isComment(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
}

// Every match of `pattern` in `text`, by line: [{ line, match, value }].
function scan(text, pattern, { group = 0, skipComments = true } = {}) {
  const found = []
  const lines = text.split('\n')
  lines.forEach((content, index) => {
    if (skipComments && isComment(content)) return
    pattern.lastIndex = 0
    for (const match of content.matchAll(pattern)) {
      found.push({ line: index + 1, match: match[0], value: match[group] ?? match[0] })
    }
  })
  return found
}

// tokens.css is where the palette's hex live: not a leak.
function isTokenFile(path) {
  return /(?:^|\/)tokens\.css$/.test(path)
}

function isSource(path) {
  return /\.(?:jsx|css)$/.test(path) || /components\/.*\.js$/.test(path) || /settingsStyles\.js$/.test(path) || /scodocPageUtils\.js$/.test(path)
}

// Groups findings by value: [{ value, count, uses: [{ path, line, match }] }],
// the most used first.
function tally(entries) {
  const byValue = new Map()
  for (const entry of entries) {
    const key = entry.value
    if (!byValue.has(key)) byValue.set(key, { value: key, count: 0, uses: [] })
    const bucket = byValue.get(key)
    bucket.count += 1
    bucket.uses.push(entry)
  }
  return [...byValue.values()].sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), 'fr', { numeric: true }))
}

// Findings by file: [{ path, count }], the most first.
function byFile(entries) {
  const counts = new Map()
  for (const entry of entries) counts.set(entry.path, (counts.get(entry.path) ?? 0) + 1)
  return [...counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count)
}

function collect(files, pattern, options = {}, filter = isSource) {
  const out = []
  for (const [path, text] of Object.entries(files)) {
    if (!filter(path)) continue
    for (const hit of scan(text, pattern, options)) out.push({ ...hit, path })
  }
  return out
}

function normalizeShadow(value) {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

export function auditSources(files) {
  const notTokens = (path) => isSource(path) && !isTokenFile(path)

  const hex = collect(files, HEX, {}, notTokens).map((entry) => ({ ...entry, value: entry.value.toLowerCase() }))
  const rgb = collect(files, RGB, {}, notTokens).map((entry) => ({ ...entry, value: entry.value.replace(/\s+/g, ' ') }))
  const legacyClasses = collect(files, LEGACY_CLASS).map((entry) => ({ ...entry, value: entry.value.replace(/^(?:[\w-]+:)+/, '') }))
  const legacyVars = collect(files, LEGACY_VAR, {}, notTokens)
  const fontPx = [
    ...collect(files, FONT_SIZE_PX, { group: 1 }).map((entry) => ({ ...entry, value: Number(entry.value) })),
    ...collect(files, CSS_FONT_SIZE, { group: 1 }).map((entry) => ({ ...entry, value: parseFloat(entry.value) })),
  ]
  const fontNamed = collect(files, FONT_SIZE_NAMED, { group: 1 })
  const radii = [
    ...collect(files, RADIUS_CLASS, { group: 1 }),
    ...collect(files, CSS_RADIUS, { group: 1 }).map((entry) => ({ ...entry, value: entry.value.trim() })),
  ]
  const shadows = [
    ...collect(files, SHADOW_CLASS, { group: 1 }).map((entry) => ({ ...entry, value: normalizeShadow(entry.value) })),
    ...collect(files, CSS_SHADOW, { group: 1 }).map((entry) => ({ ...entry, value: normalizeShadow(entry.value) })),
  ].filter((entry) => entry.value !== 'none')
  const darkArbitrary = collect(files, DARK_ARBITRARY)
  const zIndex = collect(files, Z_ARBITRARY, { group: 1 }).map((entry) => ({ ...entry, value: Number(entry.value) }))

  const scanned = Object.keys(files).filter(isSource)

  return {
    scanned: scanned.length,
    hex: { total: hex.length, values: tally(hex), files: byFile(hex) },
    rgb: { total: rgb.length, values: tally(rgb), files: byFile(rgb) },
    legacyClasses: { total: legacyClasses.length, values: tally(legacyClasses), files: byFile(legacyClasses) },
    legacyVars: { total: legacyVars.length, values: tally(legacyVars), files: byFile(legacyVars) },
    fontPx: { total: fontPx.length, values: tally(fontPx).sort((a, b) => a.value - b.value) },
    fontNamed: { total: fontNamed.length, values: tally(fontNamed) },
    radii: { total: radii.length, values: tally(radii) },
    shadows: { total: shadows.length, values: tally(shadows) },
    darkArbitrary: { total: darkArbitrary.length, values: tally(darkArbitrary), files: byFile(darkArbitrary) },
    zIndex: { total: zIndex.length, values: tally(zIndex).sort((a, b) => a.value - b.value) },
  }
}

// WCAG relative luminance and contrast, from 0–255 channels.
function channel(value) {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastOf(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function toHex([r, g, b]) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}
