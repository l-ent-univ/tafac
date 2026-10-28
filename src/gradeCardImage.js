// A grade drawn as « Mes notes » shows it (the detail sheet's top: the
// subject, the evaluation, the grade big, its coefficient and the promo's
// spread), as a PNG for a mail (src/gradeMail.js): the light theme always
// (a mail is read anywhere), at 2× for sharp screens, drawn on a canvas
// with the app's own fonts (self-hosted: nothing fetched). Loaded on first
// use only.

import { pickInkOn, shadeHex } from './colorContrast.js'
import { describeGapToMean } from './gradeDetail.js'
import { formatUeCode } from './gradesSubjects.js'
import { describeMailGrade, formatMailDate, formatMailScore } from './gradeMail.js'

const WIDTH = 400
const SCALE = 2
const PAD = 20
const RADIUS = 22
// The light theme's tokens (index.css).
const INK = '#341200'
const INK_70 = 'rgb(52 18 0 / 0.7)'
const INK_50 = 'rgb(52 18 0 / 0.5)'
const BORDER = 'rgb(52 18 0 / 0.1)'
const SUBTLE = '#f3f1ec'
const DISPLAY = '"SN Pro", "Inter Variable", system-ui, sans-serif'
const BODY = '"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
const KIND_LABELS = { resource: 'Ressource', sae: 'SAÉ' }
const FONT_WAIT_MS = 1500

// The fonts it uses, loaded (they may not be yet: a weight the page hasn't
// shown), or as they are after a moment.
async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  const fonts = ['700 64px "SN Pro"', '700 22px "SN Pro"', '600 12px "SN Pro"', '500 13px "Inter Variable"', '600 14px "Inter Variable"']
  await Promise.race([
    Promise.all(fonts.map((font) => document.fonts.load(font).catch(() => null))),
    new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
  ])
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

// `text` cut to `max` pixels wide, an ellipsis where it's cut.
function fit(context, text, max) {
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
function wrap(context, text, max, lines) {
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

// The UEs the grade counts for, as the wash at the card's top and its tags:
// [{ code, color, weight }], ScoDoc's colours as the light theme paints them.
function readUes(report, evaluation) {
  const colors = new Map((report?.ues ?? []).map((ue) => [ue.code, ue.color]))
  return (evaluation?.weights ?? [])
    .filter((entry) => entry.weight > 0 && colors.get(entry.ue))
    .map((entry) => ({ code: entry.ue, color: colors.get(entry.ue), weight: entry.weight }))
}

// The wash of the UEs' colours across the top, fading out downwards (the
// cards' .latest-grade-wash: 70 % of the height, 16 % opaque).
function drawWash(context, ues, width, height) {
  if (!ues.length) return
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = Math.round(height * 0.7)
  const wash = layer.getContext('2d')
  const across = wash.createLinearGradient(0, 0, width, 0)
  const total = ues.reduce((sum, ue) => sum + ue.weight, 0)
  let start = 0
  for (const ue of ues) {
    across.addColorStop(Math.min(1, (start + (ue.weight / total) / 2)), ue.color)
    start += ue.weight / total
  }
  wash.fillStyle = ues.length === 1 ? ues[0].color : across
  wash.fillRect(0, 0, layer.width, layer.height)
  const fade = wash.createLinearGradient(0, 0, 0, layer.height)
  fade.addColorStop(0, 'rgb(0 0 0 / 1)')
  fade.addColorStop(1, 'rgb(0 0 0 / 0)')
  wash.globalCompositeOperation = 'destination-in'
  wash.fillStyle = fade
  wash.fillRect(0, 0, layer.width, layer.height)
  context.save()
  context.globalAlpha = 0.16
  context.drawImage(layer, 0, 0)
  context.restore()
}

// A UE as « Mes notes » shows it (UeBadge): the ring's arched segment in
// the UE's colour, its edge catching the light, its shadows down and to
// the left in a dark shade of the colour, the code set along the arc. The
// same geometry as UeBadge's SVG (its viewBox 36 0 112 52), drawn at
// `scale` with its top left at (x, y). Canvas shadows ignore the
// transform: their offsets and blur are given in device pixels.
const UE_SEGMENT = 'M91.7426 4.00025C110.328 3.95769 128.525 9.33267 144.114 19.468C144.343 19.6172 144.502 19.8543 144.552 20.1233C144.602 20.3922 144.539 20.6701 144.379 20.8919L124.923 47.8469C124.617 48.2708 124.036 48.3876 123.59 48.1145C114.031 42.2593 103.037 39.1729 91.8324 39.1985C80.6276 39.2242 69.6498 42.3611 60.1205 48.26C59.6759 48.535 59.0936 48.4216 58.7855 47.9993L39.1928 21.1331C39.0316 20.912 38.9671 20.6337 39.016 20.3645C39.0649 20.0954 39.223 19.8575 39.4515 19.7073C54.9881 9.50067 73.1578 4.04298 91.7426 4.00025Z'
const UE_SHADOWS = [[-1, 1, 2, 0.36], [-4, 6, 3.5, 0.31], [-9, 13, 5, 0.18], [-16, 24, 5.5, 0.05]]
const UE_ARC = { cx: 91.8, cy: 99.1, r: 75.1 }
export const UE_RIBBON_SIZE = { width: 112, height: 52 }

function alphaHex(hex, opacity) {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16))
  return `rgb(${r} ${g} ${b} / ${opacity})`
}

function drawUeRibbon(context, { x, y, scale, color, code }) {
  const segment = new Path2D(UE_SEGMENT)
  const device = scale * SCALE
  const shade = shadeHex(color, 0.55)
  context.save()
  context.translate(x - 36 * scale, y)
  context.scale(scale, scale)
  context.fillStyle = color
  for (const [dx, dy, blur, opacity] of UE_SHADOWS) {
    context.shadowColor = alphaHex(shade, opacity)
    context.shadowOffsetX = dx * device
    context.shadowOffsetY = dy * device
    context.shadowBlur = blur * 2 * device
    context.fill(segment)
  }
  context.shadowColor = 'transparent'
  context.fill(segment)
  // The 1px inner edge: the stroke clipped to the shape, lightening.
  context.save()
  context.clip(segment)
  const edge = context.createLinearGradient(91.78, 4, 91.78, 48.41)
  edge.addColorStop(0, '#515151')
  edge.addColorStop(1, '#000000')
  context.globalCompositeOperation = 'lighter'
  context.strokeStyle = edge
  context.lineWidth = 2
  context.stroke(segment)
  context.restore()
  // The code on the arc, centred over the top of the circle.
  const label = formatUeCode(code)
  context.font = `600 17px ${DISPLAY}`
  context.fillStyle = pickInkOn(color)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const spacing = 0.2
  const widths = [...label].map((char) => context.measureText(char).width + spacing)
  const total = widths.reduce((sum, width) => sum + width, 0) - spacing
  let offset = -total / 2
  ;[...label].forEach((char, index) => {
    const angle = -Math.PI / 2 + (offset + widths[index] / 2) / UE_ARC.r
    context.save()
    context.translate(UE_ARC.cx + UE_ARC.r * Math.cos(angle), UE_ARC.cy + UE_ARC.r * Math.sin(angle))
    context.rotate(angle + Math.PI / 2)
    context.fillText(char, 0, 0)
    context.restore()
    offset += widths[index]
  })
  context.restore()
}

function drawPill(context, { x, y, text, font, fill, ink, stroke = null, padX = 9, height = 22 }) {
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

// The card's parts, laid out top to bottom on `context` (or only measured,
// `draw` false). → the card's height.
function layout(context, { report, module, evaluation }, draw) {
  const inner = WIDTH - PAD * 2
  const ues = readUes(report, evaluation)
  let y = PAD

  // The subject and its code, its UEs' ribbons at the right (UeBadge's,
  // a bit over half size).
  const ribbonScale = 0.55
  const ribbonWidth = UE_RIBBON_SIZE.width * ribbonScale
  const tags = ues.slice(0, 3)
  const tagsWidth = tags.length * ribbonWidth + Math.max(0, tags.length - 1) * 4
  if (draw) {
    let x = WIDTH - PAD - tagsWidth
    for (const tag of tags) {
      drawUeRibbon(context, { x, y: y - 2, scale: ribbonScale, color: tag.color, code: tag.code })
      x += ribbonWidth + 4
    }
    const textMax = inner - tagsWidth - (tags.length ? 12 : 0)
    context.fillStyle = INK
    context.font = `600 14px ${BODY}`
    context.fillText(fit(context, module.title, textMax), PAD, y + 13)
    const kind = /^SA[EÉ]/i.test(module.code) ? null : KIND_LABELS[module.kind]
    context.fillStyle = INK_50
    context.font = `500 12.5px ${BODY}`
    context.fillText(fit(context, [module.code, kind].filter(Boolean).join(' · '), textMax), PAD, y + 31)
  }
  y += 36 + 20

  // The evaluation's name, two lines at most.
  context.font = `700 22px ${DISPLAY}`
  const titleLines = wrap(context, evaluation.description, inner, 2)
  if (draw) {
    context.fillStyle = INK
    titleLines.forEach((line, index) => context.fillText(line, PAD, y + 20 + index * 27))
  }
  y += titleLines.length * 27 + 6

  // Its date and kind (Rattrapage, Session 2).
  const date = formatMailDate(evaluation.date)
  if (date || evaluation.typeLabel) {
    if (draw) {
      let x = PAD
      if (date) {
        context.font = `500 13px ${BODY}`
        context.fillStyle = INK_50
        const label = date.charAt(0).toUpperCase() + date.slice(1)
        context.fillText(label, x, y + 15)
        x += Math.ceil(context.measureText(label).width) + 10
      }
      if (evaluation.typeLabel) drawPill(context, { x, y: y + 1, text: evaluation.typeLabel, font: `600 11.5px ${BODY}`, fill: 'rgb(52 18 0 / 0.08)', ink: INK_70, padX: 8, height: 20 })
    }
    y += 22
  }
  y += 22

  // The grade, big; or what stands in its place. Its gap to the promo's
  // mean as a quiet chip at the right.
  const grade = evaluation.grade
  const showPromo = Boolean(report?.showPromoStats)
  if (grade.kind === 'number') {
    if (draw) {
      context.fillStyle = INK
      context.font = `700 64px ${DISPLAY}`
      const value = formatMailScore(grade.value)
      context.fillText(value, PAD - 2, y + 50)
      const valueWidth = context.measureText(value).width
      context.fillStyle = INK_50
      context.font = `500 24px ${BODY}`
      context.fillText('/20', PAD + valueWidth + 3, y + 50)
      const gap = showPromo ? describeGapToMean(evaluation) : null
      if (gap) {
        const text = gap.text.replace(/(\d)\.(\d)/g, '$1,$2')
        context.font = `600 13px ${BODY}`
        const width = Math.ceil(context.measureText(text).width) + 22
        drawPill(context, { x: WIDTH - PAD - width, y: y + 22, text, font: `600 13px ${BODY}`, fill: 'rgb(255 255 255 / 0.7)', ink: INK_70, stroke: BORDER, padX: 11, height: 28 })
      }
    }
    y += 52
  } else {
    if (draw) {
      context.fillStyle = INK
      context.font = `700 34px ${DISPLAY}`
      context.fillText(describeMailGrade(grade), PAD, y + 34)
    }
    y += 40
  }
  y += 22

  // Its coefficient and the promo's spread, as the sheet's tiles.
  const stats = [
    evaluation.coef != null ? { label: 'Coef.', value: formatMailScore(evaluation.coef) } : null,
    showPromo && evaluation.promo?.min != null ? { label: 'Min.', value: formatMailScore(evaluation.promo.min) } : null,
    showPromo && evaluation.promo?.moy != null ? { label: 'Moyenne', value: formatMailScore(evaluation.promo.moy) } : null,
    showPromo && evaluation.promo?.max != null ? { label: 'Max.', value: formatMailScore(evaluation.promo.max) } : null,
  ].filter(Boolean)
  if (stats.length) {
    if (draw) {
      const gap = 8
      const width = (inner - gap * (stats.length - 1)) / stats.length
      stats.forEach((stat, index) => {
        const x = PAD + index * (width + gap)
        roundedRect(context, x, y, width, 58, 14)
        context.fillStyle = SUBTLE
        context.fill()
        context.textAlign = 'center'
        context.fillStyle = INK_50
        context.font = `500 12px ${BODY}`
        context.fillText(stat.label, x + width / 2, y + 22)
        context.fillStyle = INK
        context.font = `700 19px ${DISPLAY}`
        context.fillText(stat.value, x + width / 2, y + 45)
        context.textAlign = 'left'
      })
    }
    y += 58
  } else {
    y -= 22
  }
  return y + PAD
}

// → { blob (image/png, 2×), width, height (its size in CSS pixels, as the
// mail shows it) }.
export async function renderGradeCardImage({ report, module, evaluation }) {
  await loadFonts()
  const measure = document.createElement('canvas').getContext('2d')
  const height = Math.ceil(layout(measure, { report, module, evaluation }, false))
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * SCALE
  canvas.height = height * SCALE
  const context = canvas.getContext('2d')
  context.scale(SCALE, SCALE)
  // The card: white, its rounded corners clear, a thin border.
  roundedRect(context, 0.5, 0.5, WIDTH - 1, height - 1, RADIUS)
  context.fillStyle = '#ffffff'
  context.fill()
  context.save()
  context.clip()
  context.setTransform(1, 0, 0, 1, 0, 0)
  drawWash(context, readUes(report, evaluation), canvas.width, canvas.height)
  context.restore()
  roundedRect(context, 0.5, 0.5, WIDTH - 1, height - 1, RADIUS)
  context.strokeStyle = BORDER
  context.lineWidth = 1
  context.stroke()
  layout(context, { report, module, evaluation }, true)
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG not made.'))), 'image/png'))
  return { blob, width: WIDTH, height }
}
