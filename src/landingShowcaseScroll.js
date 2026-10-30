import { useEffect, useRef } from 'react'

// The landing showcase pinned on large screens (LandingShowcase.jsx): the
// section stays on screen while the page scrolls along its track
// (.landing-showcase-track, data-count: its tabs), and the scroll picks the
// tab. Every panel is in the page, one over the other, and the scroll itself
// moves them: one fades and slides out, then the next comes in, the lens
// gliding to its tab meanwhile (useScrollTabs). A tab picked scrolls to its
// stretch, the panels going straight to it (scrollToShowcaseTab).

// Where the showcase is pinned while the page scrolls through its tabs, one
// stretch of the track each: on screens tall and wide enough for a whole
// panel. The same as .landing-showcase-track's media query (overrides.css).
const PINNED_QUERY = '(min-width: 1024px) and (min-height: 700px)'
export const SHOWCASE_SECTION_ID = 'fonctionnalites'

// The track while the showcase is pinned, else null.
export function findPinnedTrack() {
  if (!window.matchMedia(PINNED_QUERY).matches) return null
  return document.getElementById(SHOWCASE_SECTION_ID)?.querySelector('.landing-showcase-track') ?? null
}

// The scroll covered by each tab's stretch (the track's height past one
// window's, shared by the steps between its tabs).
function trackStep(track) {
  const count = Number(track.dataset.count)
  return (track.offsetHeight - window.innerHeight) / (count - 1)
}

// Where the window is along the track, in tabs: 0 on the first tab's
// stretch, 1.5 halfway from the second to the third…
function trackProgress(track) {
  const count = Number(track.dataset.count)
  const step = trackStep(track)
  if (!(step > 0)) return null
  return Math.min(Math.max(-track.getBoundingClientRect().top / step, 0), count - 1)
}

// How much of a tab's stretch its change to the next one takes (in tabs,
// around the midpoint between two): one panel fades out over the first half
// of it, the other fades in over the second; each stays whole for the rest
// of its stretch.
const FADE = 0.44
// How far a panel slides as it fades, in px.
const SLIDE = 28
// How close to a picked tab the scroll has to get to be there (in tabs).
const SETTLED = 0.02

const clamp01 = (value) => Math.min(Math.max(value, 0), 1)
// 0 to 1 with soft ends (smoothstep).
const ease = (value) => value * value * (3 - 2 * value)

// How much of the panel `index` shows at `progress`: all of it on its tab's
// stretch, none on the others', gone by the midpoint between two (the next
// one starts from there: the two never blend).
function shownAt(progress, index) {
  return ease(clamp01((0.5 - Math.abs(progress - index)) / (FADE / 2)))
}

// Where the lens is at `progress`, in tabs: under a tab for its stretch,
// gliding to the next one while the panels change.
function lensAt(progress) {
  const index = Math.floor(progress)
  return index + ease(clamp01((progress - index - (0.5 - FADE / 2)) / FADE))
}

// A scroll to a picked tab under way (scrollToShowcaseTab): from `from` to
// `to` along the track (in tabs), the panels go straight from how they were
// (`shown`, each panel's share; `lens`) to that tab, whatever tabs the
// scroll passes; over once the scroll settles there, by `until` at the
// latest. `wake` asks the pinned showcase to place its panels again.
let jump = null
let wake = null

// Each panel's share and which way it slides (`sign`: 1 coming from below,
// -1 leaving upwards), and the lens's place, at `progress`.
function frameAt(progress, count) {
  if (jump) {
    const at = clamp01((progress - jump.from) / (jump.to - jump.from))
    const left = 1 - ease(clamp01(at * 2))
    const come = ease(clamp01(at * 2 - 1))
    const forward = jump.to > jump.from ? 1 : -1
    const panels = jump.shown.map((start, index) => (index === jump.to
      ? { shown: start + (1 - start) * come, sign: forward }
      : { shown: start * left, sign: -forward }))
    return { panels, lens: jump.lens + (jump.to - jump.lens) * ease(at) }
  }
  const panels = Array.from({ length: count }, (_, index) => ({
    shown: shownAt(progress, index),
    sign: index > progress ? 1 : -1,
  }))
  return { panels, lens: lensAt(progress) }
}

// Inline styles written only when they change (each write restyles its
// element): what each element has, by element.
const written = new WeakMap()

function write(element, name, value) {
  let memo = written.get(element)
  if (!memo) written.set(element, (memo = {}))
  if (memo[name] === value) return
  memo[name] = value
  element.style.setProperty(name, value)
}

function unwrite(element, ...names) {
  written.delete(element)
  for (const name of names) element.style.removeProperty(name)
}

// The panels and the lens as `frame` has them (frameAt's); `null` lets go
// of them, back to the selected tab's panel alone (the CSS's). The others
// are kept from the pointer and assistive tech while they don't show.
function placePanels(track, frame, slide) {
  const panels = track.querySelectorAll('.landing-showcase-panel')
  const lens = track.querySelector('.landing-tabs-lens')
  if (frame === null) {
    for (const panel of panels) unwrite(panel, 'opacity', 'translate', 'visibility')
    if (lens) unwrite(lens, '--tab-progress')
    return
  }
  panels.forEach((panel, index) => {
    const { shown, sign } = frame.panels[index]
    const offset = slide ? (1 - shown) * SLIDE * sign : 0
    write(panel, 'opacity', shown.toFixed(3))
    write(panel, 'translate', `0 ${offset.toFixed(1)}px`)
    write(panel, 'visibility', shown > 0 ? 'visible' : 'hidden')
  })
  if (lens) write(lens, '--tab-progress', frame.lens.toFixed(4))
}

// Scrolls to the showcase with its tab `index` shown: to that tab's stretch
// of the track when pinned (the panels going straight to it, `jump`), to
// the section's top otherwise.
export function scrollToShowcaseTab(index, { smooth = true } = {}) {
  const behavior = smooth && window.matchMedia('(prefers-reduced-motion: no-preference)').matches ? 'smooth' : 'auto'
  const track = findPinnedTrack()
  if (!track) {
    document.getElementById(SHOWCASE_SECTION_ID)?.scrollIntoView({ behavior, block: 'start' })
    return
  }
  const progress = trackProgress(track)
  if (progress !== null && Math.abs(progress - index) >= SETTLED) {
    const { panels, lens } = frameAt(progress, Number(track.dataset.count))
    jump = { from: progress, to: index, shown: panels.map((panel) => panel.shown), lens, until: Date.now() + 2000 }
  }
  window.scrollTo({ top: window.scrollY + track.getBoundingClientRect().top + index * trackStep(track), behavior })
  wake?.()
}

// While pinned, the panels and the lens follow the scroll (placePanels,
// each frame it moves) and so does the tab (onIndex with the nearest one's
// index, not with the ones a jump passes); with reduced motion the panels
// only fade.
export function useScrollTabs(trackRef, onIndex) {
  const onIndexRef = useRef(onIndex)
  useEffect(() => {
    onIndexRef.current = onIndex
  })

  useEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const query = window.matchMedia(PINNED_QUERY)
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)')
    const count = Number(track.dataset.count)

    let frameId = 0
    let timeoutId = 0
    const update = () => {
      frameId = 0
      window.clearTimeout(timeoutId)
      const progress = query.matches ? trackProgress(track) : null
      if (progress === null) {
        jump = null
        placePanels(track, null)
        return
      }
      if (jump && (Math.abs(progress - jump.to) < SETTLED || Date.now() >= jump.until)) jump = null
      placePanels(track, frameAt(progress, count), motion.matches)
      // A jump the scroll stops short of (the wheel turned meanwhile) ends
      // on time all the same.
      if (jump) timeoutId = window.setTimeout(handleScroll, jump.until - Date.now())
      else onIndexRef.current(Math.round(progress))
    }
    const handleScroll = () => {
      if (!frameId) frameId = window.requestAnimationFrame(update)
    }

    wake = handleScroll
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    query.addEventListener('change', handleScroll)
    handleScroll()
    return () => {
      if (wake === handleScroll) wake = null
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
      query.removeEventListener('change', handleScroll)
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
      jump = null
      placePanels(track, null)
    }
  }, [trackRef])
}
