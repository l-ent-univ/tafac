import { contentKey, fitText } from './iosGlassModel'

// iOS app: what a control of the page's shows, for its glass
// (src/iosGlass.js). The glass is a native view over the page: it can't
// show the page's own text and icons through, so the page reads what the
// control shows (`readContent`) and paints it as a picture (`paintContent`)
// the app lays in the glass.
//
// Read: the text (one line each, cut with « … » where the page cuts it),
// the icons (inline <svg>), the photos, the plain boxes (a background, a
// hairline drawn by a ::before). Not read: the control's own surface (the
// glass is it), a gradient, a shadow, an icon styled from outside its SVG.
// An icon that turns for good (« Actualiser ») is a picture of its own the
// app turns; the app's spinner (.loading-spinner) is the system's.

// The pixels painted for a point.
const SCALE = 3
// A button's surface drawn by the page (SmoothSurface, the material's wash).
const SURFACES = '.smooth-surface, .smooth-surface-pending, .material-wash-frame'
const SPINNER = '.loading-spinner'
// A photo filling its control keeps this much of the glass around it.
const FACE_INSET = 3
const CLEAR = /^(transparent|rgba\(0, 0, 0, 0\))$/

const round = (value) => Math.round(value * 100) / 100

function alphaOf(style) {
  const value = parseFloat(style.opacity)
  return Number.isFinite(value) ? value : 1
}

// An icon as the page shows it, in its colour, for a picture.
function svgMarkup(element, color, width, height) {
  const copy = element.cloneNode(true)
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copy.setAttribute('width', Math.round(width * SCALE))
  copy.setAttribute('height', Math.round(height * SCALE))
  copy.removeAttribute('class')
  copy.setAttribute('style', `color:${color}`)
  return new XMLSerializer().serializeToString(copy)
}

// The turn an icon is in for good (an animation of its own that never
// ends and only turns it): { period, easing }, else null.
function spinOf(element) {
  for (const animation of element.getAnimations?.() ?? []) {
    const timing = animation.effect?.getComputedTiming?.()
    if (!timing || timing.iterations !== Infinity || animation.playState !== 'running') continue
    const frames = animation.effect.getKeyframes()
    const turns = frames.length === 2 && frames.every((frame) => Object.keys(frame).every((key) => ['offset', 'computedOffset', 'easing', 'composite', 'transform', 'rotate'].includes(key)))
    if (!turns) return { unknown: true }
    return { period: timing.duration, easing: frames[0].easing }
  }
  return null
}

// What a control shows, read from the page: { width, height, radius, parts,
// spins, busy, key }, or null when it can't be painted (a text on several
// lines, an animation inside it the app can't play). The control's own
// opacity (a disabled one's) is its content's.
export function readContent(element, win) {
  const doc = element.ownerDocument
  const box = element.getBoundingClientRect()
  const own = win.getComputedStyle(element)
  const parts = []
  const spins = []
  const busy = []
  let readable = true
  const place = (rect) => ({ x: round(rect.left - box.left), y: round(rect.top - box.top), width: round(rect.width), height: round(rect.height) })

  // A plain box the page draws: a background, a hairline.
  const boxPart = (rect, style, alpha) => {
    if (CLEAR.test(style.backgroundColor) || rect.width <= 0 || rect.height <= 0) return
    parts.push({ kind: 'box', ...place(rect), radius: round(parseFloat(style.borderTopLeftRadius) || 0), color: style.backgroundColor, alpha })
  }
  // A ::before or ::after laid out by its own edges (the hairline between
  // two joined buttons).
  const pseudoPart = (node, rect, name, alpha) => {
    const style = win.getComputedStyle(node, name)
    if (!style.content || style.content === 'none' || style.position !== 'absolute' || style.display === 'none') return
    const [top, bottom, left, right, width, height] = ['top', 'bottom', 'left', 'right', 'width', 'height'].map((side) => parseFloat(style[side]))
    const wide = Number.isFinite(width) ? width : rect.width - left - right
    const tall = Number.isFinite(height) ? height : rect.height - top - bottom
    const x = Number.isFinite(left) ? rect.left + left : rect.right - right - wide
    const y = Number.isFinite(top) ? rect.top + top : rect.bottom - bottom - tall
    if (![wide, tall, x, y].every(Number.isFinite)) return
    boxPart({ left: x, top: y, width: wide, height: tall }, style, alpha * alphaOf(style))
  }

  const walk = (node, alpha) => {
    const style = win.getComputedStyle(node)
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = child.data.replace(/\s+/g, ' ').trim()
        if (!text) continue
        const range = doc.createRange()
        range.selectNodeContents(child)
        const lines = [...range.getClientRects()].filter((rect) => rect.width >= 1 && rect.height >= 1)
        if (lines.length === 0) continue
        if (lines.length > 1) {
          readable = false
          continue
        }
        const shown = style.textTransform === 'uppercase' ? text.toUpperCase() : style.textTransform === 'lowercase' ? text.toLowerCase() : text
        const clip = node.getBoundingClientRect()
        parts.push({
          kind: 'text',
          text: shown,
          ...place(lines[0]),
          clip: place(clip),
          // Cut by the page where it doesn't fit: to its box's width.
          ...(style.textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth ? { room: round(clip.width) } : null),
          font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
          color: style.color,
          spacing: style.letterSpacing === 'normal' ? '' : style.letterSpacing,
          alpha,
        })
        continue
      }
      if (child.nodeType !== 1 || child.matches(SURFACES)) continue
      const childStyle = win.getComputedStyle(child)
      if (childStyle.display === 'none' || childStyle.visibility === 'hidden') continue
      const rect = child.getBoundingClientRect()
      // Nothing to see: off, or kept for a screen reader only.
      if (rect.width <= 1 || rect.height <= 1) continue
      const childAlpha = alpha * alphaOf(childStyle)
      if (childAlpha <= 0) continue
      const tag = child.tagName.toLowerCase()
      if (child.matches(SPINNER)) {
        busy.push({ ...place(rect), color: childStyle.color })
      } else if (tag === 'svg') {
        const spin = spinOf(child)
        if (spin?.unknown) {
          readable = false
        } else if (spin) {
          spins.push({ ...place(rect), period: spin.period, easing: spin.easing, markup: svgMarkup(child, childStyle.color, rect.width, rect.height), alpha: childAlpha })
        } else {
          parts.push({ kind: 'svg', markup: svgMarkup(child, childStyle.color, rect.width, rect.height), transform: childStyle.transform, ...place(rect), alpha: childAlpha })
        }
      } else if (tag === 'img') {
        // Not there yet: painted once it is (its `load` reads this again).
        if (!child.complete || !child.naturalWidth) continue
        const covers = rect.width >= box.width - 1 && rect.height >= box.height - 1
        const at = place(rect)
        const photo = {
          kind: 'img',
          src: child.currentSrc || child.src,
          x: at.x + (covers ? FACE_INSET : 0),
          y: at.y + (covers ? FACE_INSET : 0),
          width: at.width - (covers ? FACE_INSET * 2 : 0),
          height: at.height - (covers ? FACE_INSET * 2 : 0),
          radius: covers ? box.height : parseFloat(childStyle.borderTopLeftRadius) || 0,
          alpha: childAlpha,
        }
        // The picture itself, already there: painted from it (not part of
        // what names the content).
        Object.defineProperty(photo, 'element', { value: child, enumerable: false })
        parts.push(photo)
      } else {
        boxPart(rect, childStyle, childAlpha)
        pseudoPart(child, rect, '::before', childAlpha)
        walk(child, childAlpha)
        pseudoPart(child, rect, '::after', childAlpha)
      }
    }
  }
  // Unseen itself: nothing to show.
  const alpha = alphaOf(own)
  if (alpha <= 0) return null
  walk(element, alpha)
  if (!readable) return null

  const radius = Math.min(parseFloat(own.borderTopLeftRadius) || 0, box.height / 2, box.width / 2)
  const drawn = { width: round(box.width), height: round(box.height), radius: round(radius), parts }
  return {
    ...drawn,
    spins: spins.map((spin) => ({ ...spin, key: contentKey(JSON.stringify(spin)) })),
    busy,
    key: contentKey(JSON.stringify(drawn)),
  }
}

// An icon's markup → its picture, once it is read (a promise until then).
const icons = new Map()
const KEPT_ICONS = 200

function iconOf(markup) {
  if (!icons.has(markup)) {
    if (icons.size >= KEPT_ICONS) icons.delete(icons.keys().next().value)
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
    icons.set(markup, image.decode().then(() => {
      icons.set(markup, image)
      return image
    }))
  }
  return icons.get(markup)
}

function roundedPath(context, x, y, width, height, radius) {
  const corner = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + corner, y)
  context.arcTo(x + width, y, x + width, y + height, corner)
  context.arcTo(x + width, y + height, x, y + height, corner)
  context.arcTo(x, y + height, x, y, corner)
  context.arcTo(x, y, x + width, y, corner)
  context.closePath()
}

function canvasOf(width, height, doc) {
  const canvas = Object.assign(doc.createElement('canvas'), { width: Math.max(1, Math.round(width * SCALE)), height: Math.max(1, Math.round(height * SCALE)) })
  const context = canvas.getContext('2d')
  context.scale(SCALE, SCALE)
  return { canvas, context }
}

const png = (canvas) => canvas.toDataURL('image/png').split(',')[1] || null

// A control's content (see `readContent`) as a picture on nothing, the
// control's size, cut to its corners: PNG in base64, three pixels to the
// point. At once when its icons were read before (a control is then there
// with the page's frame that has it), else a promise of it.
export function paintContent(content, doc) {
  const pictures = content.parts.map((part) => (part.kind === 'svg' ? iconOf(part.markup) : part.kind === 'img' ? part.element : null))
  return pictures.some((picture) => picture instanceof Promise)
    ? Promise.all(pictures).then((ready) => drawContent(content, ready, doc))
    : drawContent(content, pictures, doc)
}

function drawContent({ width, height, radius, parts }, pictures, doc) {
  const { canvas, context } = canvasOf(width, height, doc)
  roundedPath(context, 0, 0, width, height, radius)
  context.clip()
  parts.forEach((part, index) => {
    context.save()
    context.globalAlpha = part.alpha
    if (part.kind === 'box') {
      roundedPath(context, part.x, part.y, part.width, part.height, part.radius)
      context.fillStyle = part.color
      context.fill()
    } else if (part.kind === 'text') {
      context.beginPath()
      context.rect(part.clip.x, part.clip.y, part.clip.width, part.clip.height)
      context.clip()
      context.font = part.font
      context.fillStyle = part.color
      if (part.spacing && 'letterSpacing' in context) context.letterSpacing = part.spacing
      context.textBaseline = 'alphabetic'
      const text = part.room ? fitText(part.text, part.room, (candidate) => context.measureText(candidate).width) : part.text
      const metrics = context.measureText(text)
      const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
      const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
      context.fillText(text, part.x, part.y + part.height / 2 + (ascent - descent) / 2)
    } else if (part.kind === 'svg') {
      if (part.transform && part.transform !== 'none') {
        // Its box is the turned one's: turned about its middle.
        const matrix = new DOMMatrix(part.transform)
        context.translate(part.x + part.width / 2, part.y + part.height / 2)
        context.transform(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0)
        context.translate(-part.x - part.width / 2, -part.y - part.height / 2)
      }
      context.drawImage(pictures[index], part.x, part.y, part.width, part.height)
    } else {
      // A photo: cut to its own corners, filling its box from its middle.
      const image = pictures[index]
      roundedPath(context, part.x, part.y, part.width, part.height, part.radius)
      context.clip()
      const zoom = Math.max(part.width / image.naturalWidth, part.height / image.naturalHeight)
      const drawnWidth = image.naturalWidth * zoom
      const drawnHeight = image.naturalHeight * zoom
      context.drawImage(image, part.x + (part.width - drawnWidth) / 2, part.y + (part.height - drawnHeight) / 2, drawnWidth, drawnHeight)
    }
    context.restore()
  })
  return png(canvas)
}

// An icon that turns (a `spins` entry), as a picture its own size: at once
// or promised, as `paintContent`.
export function paintSpin({ markup, width, height, alpha }, doc) {
  const draw = (picture) => {
    const { canvas, context } = canvasOf(width, height, doc)
    context.globalAlpha = alpha
    context.drawImage(picture, 0, 0, width, height)
    return png(canvas)
  }
  const picture = iconOf(markup)
  return picture instanceof Promise ? picture.then(draw) : draw(picture)
}

// A colour of the page's as "#rrggbb", whatever CSS wrote it in: a canvas
// paints it and says what it painted. null for none.
const hexes = new Map()
export function hexColor(color, doc) {
  if (!color || CLEAR.test(color)) return null
  if (!hexes.has(color)) {
    try {
      const context = Object.assign(doc.createElement('canvas'), { width: 1, height: 1 }).getContext('2d')
      // Not a colour the canvas reads: it keeps the one it had.
      context.fillStyle = '#010203'
      context.fillStyle = color
      if (context.fillStyle === '#010203') throw new Error('not a colour')
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
      hexes.set(color, `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`)
    } catch {
      hexes.set(color, null)
    }
  }
  return hexes.get(color)
}
