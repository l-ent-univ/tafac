// What the mail's card images share (a grade's, src/gradeCardImage.js; a
// class's, src/courseCardImage.js): the light theme's tokens (a mail is
// read anywhere), 2× for sharp screens, the app's own fonts (self-hosted:
// nothing fetched), text fitting and the white card they're drawn on.

export const CARD_WIDTH = 400
export const SCALE = 2
export const PAD = 20
export const RADIUS = 22
// The light theme's tokens (index.css).
export const INK = '#341200'
export const INK_70 = 'rgb(52 18 0 / 0.7)'
export const INK_50 = 'rgb(52 18 0 / 0.5)'
export const BORDER = 'rgb(52 18 0 / 0.1)'
export const SUBTLE = '#f3f1ec'
export const DISPLAY = '"SN Pro", "Inter Variable", system-ui, sans-serif'
export const BODY = '"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
const FONT_WAIT_MS = 1500

// The fonts a card uses (`fonts`: CSS font shorthands), loaded (they may
// not be yet: a weight the page hasn't shown), or as they are after a
// moment.
export async function loadCardFonts(fonts) {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  await Promise.race([
    Promise.all(fonts.map((font) => document.fonts.load(font).catch(() => null))),
    new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
  ])
}

export function roundedRect(context, x, y, width, height, radius) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

// `text` cut to `max` pixels wide, an ellipsis where it's cut.
export function fit(context, text, max) {
  if (context.measureText(text).width <= max) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (context.measureText(`${text.slice(0, middle).trimEnd()}…`).width <= max) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, low).trimEnd()}…`
}

// Words on lines `max` pixels wide, `lines` of them at most (the last one
// cut with an ellipsis).
export function wrap(context, text, max, lines) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const out = []
  let line = ''
  for (let index = 0; index < words.length; index += 1) {
    const next = line ? `${line} ${words[index]}` : words[index]
    if (!line || context.measureText(next).width <= max) {
      line = next
      continue
    }
    if (out.length === lines - 1) {
      out.push(fit(context, [line, ...words.slice(index)].join(' '), max))
      return out
    }
    out.push(line)
    line = words[index]
  }
  if (line) out.push(fit(context, line, max))
  return out
}

export function drawPill(context, { x, y, text, font, fill, ink, stroke = null, padX = 9, height = 22 }) {
  context.font = font
  const width = Math.ceil(context.measureText(text).width) + padX * 2
  roundedRect(context, x, y, width, height, height / 2)
  context.fillStyle = fill
  context.fill()
  if (stroke) {
    context.strokeStyle = stroke
    context.lineWidth = 1
    context.stroke()
  }
  context.fillStyle = ink
  context.textBaseline = 'middle'
  context.fillText(text, x + padX, y + height / 2 + 0.5)
  context.textBaseline = 'alphabetic'
  return width
}

// The card as a PNG: `layout(context, draw)` lays its parts out top to
// bottom (only measured with `draw` false) and gives its height; `wash(
// context, width, height)` paints behind them, in device pixels, clipped
// to the card. White, its corners round and clear, a thin border.
// → { blob (image/png, 2×), width, height (its size in CSS pixels, as the
// mail shows it) }.
export async function renderCardPng({ layout, wash = null }) {
  const measure = document.createElement('canvas').getContext('2d')
  const height = Math.ceil(layout(measure, false))
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH * SCALE
  canvas.height = height * SCALE
  const context = canvas.getContext('2d')
  context.scale(SCALE, SCALE)
  roundedRect(context, 0.5, 0.5, CARD_WIDTH - 1, height - 1, RADIUS)
  context.fillStyle = '#ffffff'
  context.fill()
  if (wash) {
    context.save()
    context.clip()
    context.setTransform(1, 0, 0, 1, 0, 0)
    wash(context, canvas.width, canvas.height)
    context.restore()
  }
  roundedRect(context, 0.5, 0.5, CARD_WIDTH - 1, height - 1, RADIUS)
  context.strokeStyle = BORDER
  context.lineWidth = 1
  context.stroke()
  layout(context, true)
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG not made.'))), 'image/png'))
  return { blob, width: CARD_WIDTH, height }
}

// A colour across the top fading out downwards (the cards'
// .latest-grade-wash: 70 % of the height, `opacity` opaque): `paint(layer,
// width)` gives its fill, a colour or a gradient of the layer's context.
export function drawTopWash(context, width, height, paint, opacity = 0.16) {
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = Math.round(height * 0.7)
  const wash = layer.getContext('2d')
  wash.fillStyle = paint(wash, layer.width)
  wash.fillRect(0, 0, layer.width, layer.height)
  const fade = wash.createLinearGradient(0, 0, 0, layer.height)
  fade.addColorStop(0, 'rgb(0 0 0 / 1)')
  fade.addColorStop(1, 'rgb(0 0 0 / 0)')
  wash.globalCompositeOperation = 'destination-in'
  wash.fillStyle = fade
  wash.fillRect(0, 0, layer.width, layer.height)
  context.save()
  context.globalAlpha = opacity
  context.drawImage(layer, 0, 0)
  context.restore()
}
