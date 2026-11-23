// iOS app: what the page's glass (src/iosGlass.js) works out without a
// page, and the rules the plugin follows on its side
// (src-tauri/plugins/glass): keep the two in step.

// Where a control's top is on the screen, the page scrolled to `scroll`
// (below 0 or past its end while it bounces), as WebKit places the page's
// own element (seen in the simulator, pulled past both ends):
// - `fixed`: where it is, bounce or not;
// - `sticky`: with the page down to its line (`stick`), there from then on,
//   until the end of what it is in (`limit`, its lowest place in the page)
//   takes it up. Pulled past the page's top it comes down with the page;
// - `page`: with the page.
// `y`: its top in the page (on the screen for `fixed`).
export function controlTop({ anchor, y, stick = 0, limit = Infinity }, scroll) {
  if (anchor === 'fixed') return y
  if (anchor === 'sticky') return Math.min(Math.max(y - scroll, stick), Math.max(limit, y) - scroll)
  return y - scroll
}

// How strong the status bar's veil is at a scroll position, 0 to 1
// (.ios-status-veil comes in between two scroll positions).
export function veilStrength(scroll, { from, to }) {
  if (!(to > from)) return scroll >= from ? 1 : 0
  return Math.min(1, Math.max(0, (scroll - from) / (to - from)))
}

// How much of a control shows at a height of the screen under that veil,
// 0 to 1: the veil is whole down to `solid` of its `height`, then fades to
// nothing at its foot.
export function shownUnderVeil(top, scroll, veil) {
  const whole = veil.height * veil.solid
  const cover = top <= whole ? 1 : top >= veil.height ? 0 : (veil.height - top) / (veil.height - whole)
  return 1 - veilStrength(scroll, veil) * cover
}

const EASINGS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

// A CSS easing as the four numbers of its curve; null for one that isn't a
// curve (steps(), linear() with stops): the app can't play it.
export function bezierOf(easing) {
  const text = String(easing ?? '').trim()
  if (text in EASINGS) return EASINGS[text]
  const curve = /^cubic-bezier\(([^)]+)\)$/.exec(text)
  if (!curve) return null
  const numbers = curve[1].split(',').map((part) => Number(part.trim()))
  return numbers.length === 4 && numbers.every(Number.isFinite) ? numbers : null
}

// A box as a transform about `origin` shows it, for one that only scales
// and moves: { a, d, e, f }, a matrix's own (no turn, no skew).
export function transformedBox(box, origin, { a, d, e, f }) {
  return {
    left: origin.x + a * (box.left - origin.x) + e,
    top: origin.y + d * (box.top - origin.y) + f,
    width: a * box.width,
    height: d * box.height,
  }
}

// How a control comes in with what animates around it, from its box and its
// opacity at the animation's start and at its end: { dx, dy, sx, sy } takes
// the box it ends in back to the one it starts in (its middle moved, its
// sides scaled), `alpha` its opacity at the start over the one at the end.
// null when nothing changes, or when it ends unseen.
export function entrance(from, to) {
  if (!(to.width > 0 && to.height > 0) || !(to.alpha > 0)) return null
  const move = {
    dx: from.left + from.width / 2 - (to.left + to.width / 2),
    dy: from.top + from.height / 2 - (to.top + to.height / 2),
    sx: from.width / to.width,
    sy: from.height / to.height,
  }
  const alpha = Math.min(1, Math.max(0, from.alpha / to.alpha))
  const moves = Math.abs(move.dx) > 0.05 || Math.abs(move.dy) > 0.05 || Math.abs(move.sx - 1) > 0.0005 || Math.abs(move.sy - 1) > 0.0005
  if (!moves && alpha > 0.995) return null
  return { ...(moves ? { move } : null), ...(alpha <= 0.995 ? { alpha } : null) }
}

export function rectsOverlap(left, right) {
  return left.left < right.right && right.left < left.right && left.top < right.bottom && right.top < left.bottom
}

// A text cut to the room it has, as the page cuts it (text-overflow:
// ellipsis): as much of it as fits before « … ». `measure(text)`: its width.
export function fitText(text, room, measure) {
  if (measure(text) <= room) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measure(`${text.slice(0, middle).trimEnd()}…`) <= room) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, low).trimEnd()}…`
}

// A short name for what a control shows (its description, as text): the
// app keeps a picture by it. Two 32-bit sums of the text (cyrb53).
export function contentKey(text) {
  let high = 0xdeadbeef
  let low = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    high = Math.imul(high ^ code, 2654435761)
    low = Math.imul(low ^ code, 1597334677)
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909)
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909)
  return (4294967296 * (2097151 & low) + (high >>> 0)).toString(36)
}

// What the app is sent: the controls, and of their pictures only the ones
// it doesn't hold. It holds those of the controls it was last sent
// (`held`, their keys). `pictures`: key → PNG in base64.
export function glassMessage(state, pictures, held) {
  const images = {}
  for (const control of state.controls) {
    for (const key of [control.image, ...(control.spins ?? []).map((spin) => spin.image)]) {
      if (key && !held.has(key) && pictures.has(key)) images[key] = pictures.get(key)
    }
  }
  return { ...state, ...(Object.keys(images).length > 0 ? { images } : null) }
}

// The keys of the pictures a state shows.
export function pictureKeys(state) {
  return new Set(state.controls.flatMap((control) => [control.image, ...(control.spins ?? []).map((spin) => spin.image)]).filter(Boolean))
}
