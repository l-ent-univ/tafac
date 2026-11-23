import { isIosApp } from './desktopApp'
import { bezierOf, entrance, glassMessage, pictureKeys, rectsOverlap, transformedBox } from './iosGlassModel'
import { hexColor, paintContent, paintSpin, readContent } from './iosGlassPaint'

// iOS app: the controls of the page's own chrome (the pills and round
// buttons of a page's header, of a bar floating over it) are of the
// system's glass (src-tauri/plugins/glass), through the app's own route
// (src-tauri/src/ios_chrome.rs). A page's element can't be: only a native
// view can. So for each of them:
// - this says to the app where it is, how it moves with the scroll, and
//   what it shows: a picture this paints of its text and icons
//   (src/iosGlassPaint.js);
// - the app lays a glass view at that place, inside the web view, where it
//   scrolls with the page by itself;
// - the element's own drawing is off (data-ios-glass-on), the element
//   still there: a finger on the glass is a finger on the page, so the
//   press, a long press, a scroll started there are the page's own, as is
//   what VoiceOver reads.
//
// Which controls: data-ios-glass, on a pill (a button, a link, a
// .button-group) or on a row or a bar, whose pills it then takes (the ones
// the page draws a surface for). data-ios-glass="off" keeps one out, and
// what is in it. A .lent-button's glass is tinted with its fill.
//
// The app moves the glass with the scroll itself (nothing runs here while
// the page scrolls), by one of three rules: `fixed`, `sticky`, `page`
// (src/iosGlassModel.js, controlTop). A control the app couldn't follow to
// the pixel keeps the page's own drawing: in a part of the page that
// scrolls on its own, under an animation the app can't play, turned.
// So does one the glass, over all of the page, would show through: in a
// sheet, a dialog or a menu, or under one.
//
// Glass and drawing are never both seen, nor neither:
// - a control new on the screen (its page shown, its element made) has its
//   drawing off before it was ever painted, and its glass comes in, with
//   what brings its page in (the switch's fade and scale, a mail's slide);
// - one whose drawing was showing (a sheet just closed over it) keeps it
//   until the glass has faded in over it; a sheet opening, the drawing is
//   back at once under the glass, which fades out.
// Before iOS 26 there is no such glass (501), nor on a tablet: the page
// keeps its own.

const HEADERS = { 'X-Tafac-Ios': '1', 'Content-Type': 'application/json' }
const MARK = 'data-ios-glass'
const ON = 'data-ios-glass-on'
// What can be a control, in a part of the page that is marked.
const PILLS = 'button, a[href], .button-group'
// The app's primary button: its glass takes its colour.
const PRIMARY = '.lent-button'
// What the page opens over itself.
const LAYERS = '.weather-modal-backdrop, .fixed.inset-0, [role="dialog"], [role="alertdialog"], dialog[open], [role="menu"], [role="listbox"], [role="tooltip"], .context-menu'
// The place of the system's tab bar (MobileTabBar): the bar is over the
// page, the glass in it.
const NATIVE_BAR = '[data-native-bar]'
// What the page passes under at the status bar, and what fades a page in.
const STATUS_VEIL = '.ios-status-veil'
const SWITCH_VEIL = '.page-switch-veil'
// A glass comes in over the page's own drawing in this long (a sheet just
// closed over it), and the drawing goes once it is in.
const FADE_IN = { duration: 180, easing: [0, 0, 0.58, 1] }
const FADE_MS = 220
// A control that moved without the page's tree changing; the page counts
// as scrolling this long after its last step.
const RESYNC_MS = 1000
const SCROLL_REST_MS = 250
// What an animation may change for the app to play it along, and what
// only repaints (a control doesn't move for it).
const PLAYED = ['transform', 'translate', 'scale', 'opacity']
const REPAINTS = /color$|shadow$|^outline|^background|^fill$|^stroke$|^textDecoration|^--/i
const TIMING_KEYS = ['offset', 'computedOffset', 'easing', 'composite']
const PENDING = Symbol('pending')
const KEPT_PICTURES = 240

const round = (value) => Math.round(value * 100) / 100
const edges = ({ left, top, width, height }) => ({ left, top, right: left + width, bottom: top + height })

// What a keyframe makes of its element's box: { a, d, e, f }, a matrix
// that only scales and moves. null for one that turns or skews, or that
// this can't read (a move in percents).
function keyframeMatrix(frame) {
  let matrix = { a: 1, d: 1, e: 0, f: 0 }
  if (frame.transform && frame.transform !== 'none') {
    try {
      const read = new DOMMatrix(frame.transform)
      if (!read.is2D || Math.abs(read.b) > 1e-6 || Math.abs(read.c) > 1e-6) return null
      matrix = { a: read.a, d: read.d, e: read.e, f: read.f }
    } catch {
      return null
    }
  }
  // The properties of their own come after `transform`: scaled, then moved.
  if (frame.scale && frame.scale !== 'none') {
    const [x, y = x] = String(frame.scale).trim().split(/\s+/).map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    matrix = { a: matrix.a * x, d: matrix.d * y, e: matrix.e * x, f: matrix.f * y }
  }
  if (frame.translate && frame.translate !== 'none') {
    const parts = String(frame.translate).trim().split(/\s+/)
    if (!parts.every((part) => /^-?[\d.]+(px)?$/.test(part))) return null
    matrix = { ...matrix, e: matrix.e + parseFloat(parts[0]), f: matrix.f + parseFloat(parts[1] ?? '0') }
  }
  return matrix
}

const isStill = ({ a, d, e, f }) => Math.abs(a - 1) < 1e-4 && Math.abs(d - 1) < 1e-4 && Math.abs(e) < 0.01 && Math.abs(f) < 0.01

export function enableIosGlass(doc = document, win = window) {
  if (!isIosApp()) return
  // Whether the app has the glass: null until it has said.
  let supported = null
  // The app took everything so far: a new control's drawing goes before its
  // glass is confirmed. After a refusal, only once it is.
  let eager = true
  let scheduled = false
  // The page's tree may have changed: which controls there are, and how
  // each moves, is read again.
  let dirty = true
  let lastBody = ''
  let queue = Promise.resolve()
  let count = 0
  let timer = 0
  let beat = 0
  const ids = new WeakMap()
  let found = []
  let facts = new WeakMap()
  // What each control shows as the page has it (null: can't be painted),
  // until something in it or around it changes.
  let contents = new WeakMap()
  // What each control's glass shows, kept while its next picture is painted.
  const showing = new WeakMap()
  // What the app was last told of each control.
  const told = new WeakMap()
  // The elements whose own drawing has been seen since they last had glass.
  const own = new WeakSet()
  // When the app confirmed each control's glass.
  const confirmed = new WeakMap()
  let glass = new Set()
  // What a control shows (its key) → its picture (PENDING while painted,
  // null: can't be); the keys the app holds.
  const pictures = new Map()
  let held = new Set()
  // A sticky element → where it would be unstuck, and what that was read from.
  const naturals = new WeakMap()

  const schedule = () => {
    if (scheduled || supported !== true) return
    scheduled = true
    win.requestAnimationFrame(sync)
  }
  const changed = () => {
    dirty = true
    schedule()
  }
  // Something changed at `target`: what the controls in it (`below`: or
  // under it) show is read again.
  const forget = (target, below = false) => {
    for (const element of found) {
      if (element.contains(target) || (below && target.contains?.(element))) contents.delete(element)
    }
  }

  const isShown = (element) => (typeof element.checkVisibility === 'function' ? element.checkVisibility({ visibilityProperty: true }) : element.getClientRects().length > 0)
  const onScreen = (element) => element.isConnected && !element.closest('[hidden]')
  const isRunning = (animation) => animation.playState === 'running' && animation.timeline === doc.timeline && Boolean(animation.effect?.target)

  // The pills marked, or in a part of the page that is.
  function controls() {
    const pills = new Set()
    for (const marked of doc.querySelectorAll(`[${MARK}]`)) {
      if (marked.getAttribute(MARK) === 'off') continue
      if (marked.matches(PILLS)) pills.add(marked)
      for (const pill of marked.querySelectorAll(PILLS)) pills.add(pill)
    }
    return [...pills].filter((pill) => {
      // Kept out, or in what the page opened over itself (a calendar
      // hanging from a marked row).
      if (pill.closest(`[${MARK}="off"]`) || pill.closest(LAYERS)) return false
      // In another control: that one's glass holds it.
      const outer = pill.parentElement?.closest(PILLS)
      return !outer || !pills.has(outer)
    })
  }

  // What the page draws behind a pill, as a colour: null for none.
  function fillOf(element) {
    const face = element.querySelector(':scope > .smooth-surface .smooth-surface-face')
    return hexColor(face ? win.getComputedStyle(face).fill : win.getComputedStyle(element).backgroundColor, doc)
  }

  // The primary button's colour at rest (under a finger the page lightens
  // it: the glass gives by itself).
  function tintOf(element) {
    return hexColor(win.getComputedStyle(element).getPropertyValue('--lent-button-fill').trim(), doc) ?? fillOf(element)
  }

  // What doesn't change while the page's tree doesn't: whether it is a
  // control at all (`control`), and how it moves (`anchor`: 'fixed',
  // 'sticky' with the element that sticks, 'page').
  function factsOf(element) {
    if (facts.has(element)) return facts.get(element)
    const fact = { control: false, anchor: null, sticky: null, tint: null }
    facts.set(element, fact)
    // In a marked row, the pills only: what the page draws a surface for.
    const surfaced = element.hasAttribute(MARK) || element.matches('.button-group') || element.querySelector(':scope > .smooth-surface, :scope > .smooth-surface-pending') || fillOf(element)
    if (!surfaced) return fact
    let anchor = 'page'
    let sticky = null
    for (let current = element; current && current !== doc.body && current !== doc.documentElement; current = current.parentElement) {
      const style = win.getComputedStyle(current)
      if (style.position === 'fixed') {
        anchor = 'fixed'
        sticky = null
        break
      }
      if (style.position === 'sticky') {
        // One in another: not followed.
        if (sticky) return fact
        sticky = current
        anchor = 'sticky'
      }
      // A part of the page that scrolls on its own.
      if (current !== element && /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`) && (current.scrollHeight > current.clientHeight + 1 || current.scrollWidth > current.clientWidth + 1)) return fact
    }
    fact.control = true
    fact.anchor = anchor
    fact.sticky = sticky
    fact.tint = element.matches(PRIMARY) ? tintOf(element) : null
    return fact
  }

  // Where a sticky element would be if it weren't stuck (its top on the
  // screen). Stuck, its line is moved away for the time of a reading; what
  // was read is kept while nothing around it moved.
  function unstuckTop(sticky, style, box, holderBox) {
    if (box.top > parseFloat(style.top) + 0.5) return box.top
    const before = sticky.previousElementSibling
    const stamp = [holderBox.top + win.scrollY, holderBox.width, box.height, parseFloat(style.marginTop), before ? before.getBoundingClientRect().bottom + win.scrollY : 0].map(Math.round).join('|')
    const kept = naturals.get(sticky)
    if (kept?.stamp === stamp) return kept.top - win.scrollY
    const inline = sticky.style.top
    sticky.style.top = '-100000px'
    const top = sticky.getBoundingClientRect().top
    sticky.style.top = inline
    if (sticky.getAttribute('style') === '') sticky.removeAttribute('style')
    naturals.set(sticky, { stamp, top: top + win.scrollY })
    return top
  }

  // Where a control is for the app (src/iosGlassModel.js, controlTop):
  // { x, y } in the page, on the screen for `fixed`; `stick` and `limit` for
  // `sticky`. null: not followed.
  function placeOf(fact, box) {
    if (fact.anchor === 'fixed') {
      // The page pulled past an end, WebKit still holds it to the screen,
      // but says its box as if it had gone with the page: put back.
      const end = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight)
      const pulled = win.scrollY - Math.min(Math.max(win.scrollY, 0), end)
      return { x: round(box.left), y: round(box.top + pulled) }
    }
    if (fact.anchor === 'page') return { x: round(box.left + win.scrollX), y: round(box.top + win.scrollY) }
    const sticky = fact.sticky
    const style = win.getComputedStyle(sticky)
    const line = parseFloat(style.top)
    // What it sticks in: the first box around it.
    let holder = sticky.parentElement
    while (holder && win.getComputedStyle(holder).display === 'contents') holder = holder.parentElement
    if (!Number.isFinite(line) || !holder) return null
    const stuck = sticky.getBoundingClientRect()
    const holderBox = holder.getBoundingClientRect()
    const holderStyle = win.getComputedStyle(holder)
    // The end of what it is in takes it up with it.
    const end = holderBox.bottom - (parseFloat(holderStyle.borderBottomWidth) || 0) - (parseFloat(holderStyle.paddingBottom) || 0) - (parseFloat(style.marginBottom) || 0) - stuck.height
    const within = box.top - stuck.top
    return {
      x: round(box.left + win.scrollX),
      y: round(unstuckTop(sticky, style, stuck, holderBox) + win.scrollY + within),
      stick: round(line + within),
      limit: round(end + win.scrollY + within),
    }
  }

  // An animation over a control, for the app: `false` when it only
  // repaints (nothing to follow), null when the app can't play it along,
  // else where it starts its element from (`matrix`: how its first
  // keyframe moves and scales it, null when it doesn't; `opacity`: its
  // first and last, null when it doesn't fade), when it started (on the
  // device's clock) and how it goes.
  function played(animation) {
    const effect = animation.effect
    const frames = effect.getKeyframes()
    const changes = [...new Set(frames.flatMap((frame) => Object.keys(frame)))].filter((key) => !TIMING_KEYS.includes(key))
    if (changes.every((key) => REPAINTS.test(key))) return false
    const timing = effect.getComputedTiming()
    if (animation.currentTime == null || animation.playbackRate !== 1 || frames.length !== 2 || !changes.every((key) => PLAYED.includes(key))) return null
    if (timing.iterations !== 1 || timing.direction !== 'normal' || !(timing.duration > 0) || !Number.isFinite(timing.endTime)) return null
    // A CSS animation's easing is its keyframe's, a transition's its own.
    const easing = timing.easing && timing.easing !== 'linear' ? (frames[0].easing === 'linear' ? timing.easing : null) : frames[0].easing
    const curve = bezierOf(easing)
    const first = keyframeMatrix(frames[0])
    const last = keyframeMatrix(frames[1])
    // It ends where the page leaves it: nothing of it stays.
    if (!curve || !first || !last || !isStill(last)) return null
    const opacity = changes.includes('opacity') ? [Number(frames[0].opacity), Number(frames[1].opacity)] : null
    if (opacity && !opacity.every(Number.isFinite)) return null
    return {
      animation,
      target: effect.target,
      matrix: isStill(first) ? null : first,
      opacity,
      end: timing.endTime,
      start: Math.round(win.performance.timeOrigin + win.performance.now() - (animation.currentTime - timing.delay)),
      duration: Math.round(timing.duration),
      easing: curve,
    }
  }

  // What `read` says with these animations at their end, where the page is
  // as it will stay. They go on from where they were. (At their start, the
  // page isn't read: WebKit shows it a few milliseconds further on.)
  function atEnd(plays, read) {
    const times = plays.map((play) => play.animation.currentTime)
    try {
      for (const play of plays) play.animation.currentTime = play.end
      return read()
    } finally {
      plays.forEach((play, index) => {
        play.animation.currentTime = times[index]
      })
    }
  }

  const timingOf = ({ start, duration, easing }) => ({ start, duration, easing })

  // A picture by its key, painted once: at once where it can be, else
  // PENDING until it is.
  function pictureOf(key, paint) {
    if (!pictures.has(key)) {
      let painted = null
      try {
        painted = paint()
      } catch {
        // A picture the canvas may not read: none.
      }
      if (painted instanceof Promise) {
        pictures.set(key, PENDING)
        painted.catch(() => null).then((done) => {
          pictures.set(key, done)
          schedule()
        })
      } else {
        pictures.set(key, painted)
      }
    }
    return pictures.get(key)
  }

  // What a control shows, its pictures painted: { radius, image?, spins?,
  // busy? }; PENDING while they are, null when it can't be shown.
  // `inner`: something in it is on its way (a caret turning): what it
  // showed, until it has arrived.
  function lookOf(element, size, inner) {
    const kept = contents.get(element)
    if (kept && (Math.abs(kept.width - size.width) > 0.5 || Math.abs(kept.height - size.height) > 0.5)) contents.delete(element)
    if (!contents.has(element) && !(inner && showing.has(element))) contents.set(element, readContent(element, win))
    const content = contents.get(element)
    if (content === null) return null
    if (content) {
      const image = content.parts.length > 0 ? pictureOf(content.key, () => paintContent(content, doc)) : ''
      const spins = content.spins.map((spin) => pictureOf(spin.key, () => paintSpin(spin, doc)))
      const curves = content.spins.map((spin) => bezierOf(spin.easing))
      if ([image, ...spins, ...curves].includes(null)) return null
      if (![image, ...spins].includes(PENDING)) {
        const look = {
          radius: content.radius,
          ...(image ? { image: content.key } : null),
          ...(spins.length > 0 ? { spins: content.spins.map((spin, index) => ({ image: spin.key, x: spin.x, y: spin.y, width: spin.width, height: spin.height, period: Math.round(spin.period), easing: curves[index] })) } : null),
          ...(content.busy.length > 0 ? { busy: content.busy.map((spinner) => ({ x: spinner.x, y: spinner.y, width: spinner.width, height: spinner.height, color: hexColor(spinner.color, doc) ?? '#000000' })) } : null),
        }
        showing.set(element, look)
        return look
      }
    }
    return showing.get(element) ?? PENDING
  }

  // The status bar's veil, as the app fades what passes under it:
  // { height, solid, from, to } (src/iosGlassModel.js, shownUnderVeil).
  function statusVeil() {
    const veil = doc.querySelector(STATUS_VEIL)
    if (!veil || !isShown(veil)) return null
    const style = win.getComputedStyle(veil)
    const height = veil.getBoundingClientRect().height
    if (!(height > 0)) return null
    const stop = /([\d.]+)%/.exec(style.maskImage || style.webkitMaskImage || '')
    // Without a scroll-driven fade it is always there.
    const driven = String(style.animationTimeline || '').includes('scroll')
    const from = driven ? parseFloat(style.animationRangeStart) : NaN
    const to = driven ? parseFloat(style.animationRangeEnd) : NaN
    return { height: round(height), solid: stop ? Number(stop[1]) / 100 : 1, from: Number.isFinite(from) ? from : 0, to: Number.isFinite(to) ? to : 0 }
  }

  // The page's own drawing back for the elements that lost their glass.
  function unmark(kept = new Set()) {
    for (const element of doc.querySelectorAll(`[${ON}]`)) {
      if (kept.has(element) || !onScreen(element)) continue
      element.removeAttribute(ON)
      own.add(element)
    }
  }

  // A mark on the frame the page is about to paint, which the app can see
  // arrive: the page's theme-color, its channels' two last bits changed
  // (nothing to the eye). WebKit hands the app that colour with the frame
  // itself. null where the colour isn't one this can mark.
  function markFrame() {
    const metas = [...doc.querySelectorAll('meta[name="theme-color"]')]
    const meta = metas.find((candidate) => !candidate.media || win.matchMedia(candidate.media).matches) ?? metas[0]
    const read = /^#([0-9a-f]{6})$/i.exec(meta?.content?.trim() ?? '')
    if (!read) return null
    const color = parseInt(read[1], 16)
    let marked = color
    while (marked === color) {
      beat = (beat + 1) % 64
      marked = (color & 0xfcfcfc) | (beat & 3) | (((beat >> 2) & 3) << 8) | (((beat >> 4) & 3) << 16)
    }
    meta.content = `#${marked.toString(16).padStart(6, '0')}`
    return meta.content
  }

  // The app is told what the page's next frame shows, and waits for that
  // frame (`after`: its mark) to show it: the glass is the app's, there at
  // once, where the page's own frame takes its time to the screen (a page
  // coming in, some hundred milliseconds). Without it a page's controls
  // were there ahead of the page.
  // `fade`: the controls that go with the page's own drawing back under
  // them: they fade out over it. The others go with their page, at once.
  function send(state, elements, fade = []) {
    const body = JSON.stringify(state)
    if (body === lastBody) return
    lastBody = body
    const mark = markFrame()
    const more = { ...(mark ? { after: mark } : null), ...(fade.length > 0 ? { fade } : null) }
    queue = queue
      .then(() => fetch('/__ios/glass', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ...glassMessage(state, pictures, held), ...more }) }))
      .then((response) => {
        if (response.status === 501) {
          supported = false
          glass = new Set()
          unmark()
          return
        }
        if (!response.ok) throw new Error(`glass: ${response.status}`)
        held = pictureKeys(state)
        const now = win.performance.now()
        for (const element of elements) {
          if (!confirmed.has(element)) confirmed.set(element, now)
        }
        // The drawings still showing under their glass go once it is in.
        win.clearTimeout(timer)
        timer = win.setTimeout(schedule, FADE_MS)
      })
      .catch(() => {
        // Not taken: the page's own drawing, until a glass is confirmed.
        eager = false
        held = new Set()
        lastBody = ''
        glass = new Set()
        unmark()
      })
  }

  // A control as the app is told of it; null while it keeps the page's own
  // drawing, PENDING while its picture is painted. `animationsOf(node)`:
  // the animations running on a node; `veil`: the one fading the page in.
  function describe(element, layers, animationsOf, veil) {
    const fact = factsOf(element)
    if (!fact.control) return null
    const wasGlass = glass.has(element) && told.has(element)
    // As the app has it: it stays where it is.
    const asTold = () => (wasGlass ? told.get(element) : null)
    // Under a finger: the page's own press (it gives a little) isn't the
    // glass's, which gives by itself.
    if (wasGlass && element.matches(':active')) return asTold()

    const plays = []
    for (let current = element; current && current !== doc.documentElement; current = current.parentElement) {
      for (const animation of animationsOf(current)) {
        const play = played(animation)
        // Under an animation the app can't play, or one that ends with it
        // unseen: as it is until it ends.
        if (play === null || (play && play.opacity && !(play.opacity[1] > 0))) return asTold()
        if (play) plays.push(play)
      }
    }
    // From the nearest to the furthest around it.
    const moves = plays.filter((play) => play.matrix)
    const fades = plays.filter((play) => play.opacity)
    // Something in it is on its way: a caret turning, an icon changing.
    const inner = element.getAnimations({ subtree: true }).some((animation) => isRunning(animation) && animation.effect.target !== element && animation.effect.getComputedTiming().iterations !== Infinity)

    // The control where it will stay: its box, its place for the app, what
    // it shows; and where what moves it turns about.
    const settle = () => {
      const holder = element.parentElement
      if (holder?.checkVisibility && !holder.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null
      const rect = element.getBoundingClientRect()
      const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      if (box.width < 1 || box.height < 1) return null
      // Turned or skewed: its box isn't it.
      const matrix = win.getComputedStyle(element).transform
      if (matrix && matrix !== 'none') {
        const { b, c } = new DOMMatrix(matrix)
        if (Math.abs(b) > 0.001 || Math.abs(c) > 0.001) return null
      }
      // Under something the page opened.
      if (layers.some((layer) => !layer.element.contains(element) && rectsOverlap(layer.box, edges(box)))) return null
      // Held to the screen: what takes a press at its middle is on top of it.
      if (fact.anchor !== 'page') {
        const x = box.left + box.width / 2
        const y = box.top + box.height / 2
        if (x >= 0 && y >= 0 && x <= win.innerWidth && y <= win.innerHeight) {
          const top = doc.elementFromPoint(x, y)
          if (top && !element.contains(top) && !top.contains(element) && !top.closest(NATIVE_BAR)) return null
        }
      }
      const place = placeOf(fact, box)
      if (!place) return null
      const origins = moves.map((move) => {
        const moved = move.target.getBoundingClientRect()
        const [x, y] = win.getComputedStyle(move.target).transformOrigin.split(' ').map(parseFloat)
        return { x: moved.left + x, y: moved.top + y }
      })
      return { box, place, origins, look: lookOf(element, box, inner) }
    }
    const settled = plays.length > 0 ? atEnd(plays, settle) : settle()
    if (!settled) return null
    const { box, place, origins, look } = settled
    if (look === PENDING) return PENDING
    if (!look) return null

    if (!ids.has(element)) ids.set(element, `glass-${(count += 1)}`)
    const entry = {
      id: ids.get(element),
      anchor: fact.anchor,
      ...place,
      width: round(box.width),
      height: round(box.height),
      radius: Math.min(look.radius, round(box.height / 2), round(box.width / 2)),
      ...(fact.tint ? { tint: fact.tint } : null),
      ...(look.image ? { image: look.image } : null),
      ...(look.spins ? { spins: look.spins } : null),
      ...(look.busy ? { busy: look.busy } : null),
    }
    if (wasGlass) {
      // How it came in is said once.
      const { move, fade } = told.get(element)
      if (move) entry.move = move
      if (fade) entry.fade = fade
    } else {
      // How it comes in: from where what moves it starts it, as faded as
      // what fades it starts, and under the veil that fades its page in;
      // over its own drawing, where that shows, in a fade of its own
      // (no `start`: from when the app shows it). Else at once, with the
      // page's frame that has it.
      // Several animations at once (a mail's panel, its content, its
      // toolbar, each on its own clock) are one for the app, from where
      // they start it together, on the clock of the last to end.
      const last = (several) => several.reduce((latest, play) => (play.start + play.duration > latest.start + latest.duration ? play : latest))
      const first = {
        ...moves.reduce((at, move, index) => transformedBox(at, origins[index], move.matrix), box),
        alpha: fades.reduce((alpha, fade) => (alpha * fade.opacity[0]) / fade.opacity[1], 1),
      }
      const arrival = entrance(first, { ...box, alpha: 1 })
      if (arrival?.move) entry.move = { ...arrival.move, ...timingOf(last(moves)) }
      const under = veil && !veil.target.contains(element) && rectsOverlap(veil.box, edges(box))
      if (under) entry.fade = { from: round((arrival?.alpha ?? 1) * (1 - veil.opacity[0])), ...timingOf(last([veil, ...fades])) }
      else if (arrival?.alpha != null) entry.fade = { from: round(arrival.alpha), ...timingOf(last(fades)) }
      else if (own.has(element) && !element.hasAttribute(ON)) entry.fade = { from: 0, ...FADE_IN }
    }
    told.set(element, entry)
    return entry
  }

  // The controls there are now, said to the app, each one's own drawing
  // off or back.
  function tell() {
    if (dirty) {
      dirty = false
      facts = new WeakMap()
      found = controls()
    }
    const layers = [...doc.querySelectorAll(LAYERS)].filter(isShown).map((element) => ({ element, box: element.getBoundingClientRect() }))
    const running = new Map()
    const animationsOf = (node) => {
      if (!running.has(node)) running.set(node, node.getAnimations().filter(isRunning))
      return running.get(node)
    }
    // The veil that fades a page in is over all of it: its controls come
    // in as it clears.
    const veilElement = doc.querySelector(SWITCH_VEIL)
    const veilPlay = veilElement ? animationsOf(veilElement).map(played).find((play) => play?.opacity) : null
    const veil = veilPlay && veilPlay.opacity[0] > 0.005 ? { ...veilPlay, box: veilElement.getBoundingClientRect() } : null

    const list = []
    const next = new Set()
    for (const element of found) {
      // Not on the screen (its page behind another): as it was left.
      if (!onScreen(element)) continue
      const entry = describe(element, layers, animationsOf, veil)
      if (entry === PENDING) {
        // Not painted yet: nothing of it shows until it is.
        if (eager && !own.has(element) && !element.hasAttribute(ON)) element.setAttribute(ON, '')
        if (element.hasAttribute(ON)) next.add(element)
        else own.add(element)
        continue
      }
      if (!entry) {
        own.add(element)
        continue
      }
      list.push(entry)
      next.add(element)
    }
    // Out of their glass, their own drawing back: those fade out over it.
    const fading = [...glass].filter((element) => !next.has(element) && told.has(element) && onScreen(element) && isShown(element)).map((element) => ids.get(element))
    glass = next
    unmark(next)
    for (const element of found) {
      if (!next.has(element)) confirmed.delete(element)
    }

    const now = win.performance.now()
    for (const element of next) {
      if (element.hasAttribute(ON)) continue
      // Never seen: its glass is all it shows. Seen: once its glass is in.
      if ((eager && !own.has(element)) || now - (confirmed.get(element) ?? Infinity) >= FADE_MS) {
        element.setAttribute(ON, '')
        own.delete(element)
      }
    }

    const statusUnder = statusVeil()
    send({
      dark: doc.documentElement.dataset.theme === 'dark',
      ...(statusUnder ? { veil: statusUnder } : null),
      controls: list,
    }, next, fading)

    if (pictures.size > KEPT_PICTURES) {
      for (const [key, picture] of pictures) {
        if (pictures.size <= KEPT_PICTURES / 2) break
        if (picture !== PENDING && !held.has(key)) pictures.delete(key)
      }
    }
  }

  function sync() {
    scheduled = false
    if (supported !== true) return
    try {
      tell()
    } catch (error) {
      // Rather the page's own drawing everywhere than a control gone.
      console.error('iOS glass', error)
      glass = new Set()
      unmark()
      send({ controls: [] }, glass)
    }
  }

  // Whether the app has the glass at all, before the first control shows.
  // What the page shows by then has been seen in its own drawing.
  const nothing = JSON.stringify({ controls: [] })
  queue = queue
    .then(() => fetch('/__ios/glass', { method: 'POST', headers: HEADERS, body: nothing }))
    .then((response) => {
      supported = response.ok
      lastBody = nothing
      for (const element of controls()) {
        if (onScreen(element)) own.add(element)
      }
      changed()
    })
    .catch(() => {
      supported = false
    })

  new MutationObserver((records) => {
    for (const record of records) forget(record.target, record.type === 'attributes')
    changed()
  }).observe(doc.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [MARK, 'hidden', 'disabled', 'class', 'open', 'aria-pressed', 'aria-label', 'aria-expanded', 'aria-busy', 'aria-current', 'src'],
  })
  // The theme and the palette: every picture's colours.
  const repaint = () => {
    contents = new WeakMap()
    changed()
  }
  new MutationObserver(repaint).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style', 'class'] })
  win.addEventListener('resize', repaint)
  doc.fonts?.ready.then(repaint)
  // Something started or stopped moving, a picture arrived: a control may
  // be on its way in, or somewhere else, or show something else.
  for (const type of ['animationstart', 'animationend', 'animationcancel', 'transitionend', 'transitioncancel', 'load']) {
    doc.addEventListener(type, (event) => {
      forget(event.target)
      schedule()
    }, true)
  }
  // A look now and then, for what moved without a sign. Not while the page
  // scrolls: the app follows that by itself.
  let scrolled = 0
  win.addEventListener('scroll', () => {
    scrolled = win.performance.now()
  }, { capture: true, passive: true })
  win.setInterval(() => {
    if (!doc.hidden && win.performance.now() - scrolled > SCROLL_REST_MS) schedule()
  }, RESYNC_MS)
}
