// The wallpaper's photo credit on the « Accueil » band (HomeDraftPage): white
// or black, whichever reads better on the part of the photo under it. Pure
// (the pixels are read by the page), tested in tests/wallpaperInk.test.js.

import { contrastRatio } from './colorContrast.js'

// A CSS background-position ("center 40%", "30% 60%", "left top") as
// fractions of the room left over by `cover`; the band's default is
// "center 40%".
export function parseBackgroundPosition(position) {
  const words = String(position ?? '').trim().split(/\s+/).filter(Boolean)
  const toFraction = (word, fallback) => {
    if (!word) return fallback
    if (word === 'left' || word === 'top') return 0
    if (word === 'right' || word === 'bottom') return 1
    if (word === 'center') return 0.5
    const percent = /^(-?\d+(?:\.\d+)?)%$/.exec(word)
    return percent ? Number(percent[1]) / 100 : fallback
  }
  return { x: toFraction(words[0], 0.5), y: toFraction(words[1] ?? (words.length ? 'center' : undefined), words.length ? 0.5 : 0.4) }
}

// The part of the image (in its own pixels) a box of the band shows, the
// image drawn with background-size: cover at `position`. `box`: the band's
// size; `area`: the part of it to read ({ left, top, width, height }, in the
// band's pixels).
export function coverSourceRect({ imageWidth, imageHeight, boxWidth, boxHeight, position, area }) {
  const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight)
  const { x, y } = parseBackgroundPosition(position)
  const offsetX = (boxWidth - imageWidth * scale) * x
  const offsetY = (boxHeight - imageHeight * scale) * y
  const clamp = (value, max) => Math.min(Math.max(value, 0), max)
  const left = clamp((area.left - offsetX) / scale, imageWidth)
  const top = clamp((area.top - offsetY) / scale, imageHeight)
  const right = clamp((area.left + area.width - offsetX) / scale, imageWidth)
  const bottom = clamp((area.top + area.height - offsetY) / scale, imageHeight)
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

const toHex = (channels) => `#${channels.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`

// 'light' (white) or 'dark' (black): the ink that reads best on `rgb` (the
// photo's average under the credit) drawn at `opacity` over `backdrop` (the
// band's tint, [r, g, b]).
export function pickCreditInk(rgb, opacity = 1, backdrop = [255, 255, 255]) {
  const seen = rgb.map((value, index) => value * opacity + backdrop[index] * (1 - opacity))
  const background = toHex(seen)
  return contrastRatio('#ffffff', background) >= contrastRatio('#000000', background) ? 'light' : 'dark'
}

// The wallpaper's main colour, for the « Accueil » band's tint: the photo's
// pixels (an ImageData's `data`, RGBA) grouped by colour, each counted by
// how vivid it is, so a coloured sky or field wins over the greys around
// it; the most counted group's average, as "#rrggbb". A grey photo gives
// its average grey; null without a pixel.
export function pickWallpaperTint(data) {
  const groups = new Map()
  let total = [0, 0, 0]
  let count = 0
  for (let index = 0; index + 3 < data.length; index += 4) {
    if (data[index + 3] < 128) continue
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]
    total = [total[0] + r, total[1] + g, total[2] + b]
    count += 1
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (chroma < 24) continue
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)
    const group = groups.get(key) ?? { weight: 0, sum: [0, 0, 0], n: 0 }
    group.weight += chroma
    group.sum = [group.sum[0] + r, group.sum[1] + g, group.sum[2] + b]
    group.n += 1
    groups.set(key, group)
  }
  if (!count) return null
  let best = null
  for (const group of groups.values()) {
    if (!best || group.weight > best.weight) best = group
  }
  return best ? toHex(best.sum.map((channel) => channel / best.n)) : toHex(total.map((channel) => channel / count))
}
