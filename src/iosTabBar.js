import { useEffect, useRef } from 'react'
import { iconLoaded, loadIcons } from '@iconify/react'
import { isIosApp } from './desktopApp'
import { drawIcon } from './iosIcons'
import { isSlotCovered } from './desktopMoodle'

// iOS app: the tab bar is the system's (src-tauri/plugins/tabbar), not the
// page's. The page stays in charge of it, through the app's own route
// (src-tauri/src/ios_chrome.rs):
// - it says its tabs, the one selected, and whether the bar may show. The
//   bar is native, above everything the page draws: while a sheet, a dialog
//   or a menu of the page's is where the bar is, it hides
//   (src/desktopMoodle.js has the same rule for Moodle's view);
// - a tab pressed comes back as a `tafac:tab` event on window, its detail
//   { id }, and the page does what its own bar did.

const HEADERS = { 'X-Tafac-Ios': '1', 'Content-Type': 'application/json' }
const TAB_EVENT = 'tafac:tab'
// A cover that came or went without the page's tree changing (a transition).
const RESYNC_MS = 1000

// The bar draws the page's own icons (the tab's `tabIcon` and
// `tabIconSelected`, Iconify names), which the page hands it as pictures.
// SF Symbols stand in for one it couldn't draw, so no tab is ever blank.
const SYMBOLS = {
  home: ['house', 'house.fill'],
  grades: ['chart.pie', 'chart.pie.fill'],
  planning: ['calendar', 'calendar'],
  mail: ['envelope', 'envelope.fill'],
  assiduity: ['person.crop.circle.badge.checkmark', 'person.crop.circle.fill.badge.checkmark'],
  moodle: ['graduationcap', 'graduationcap.fill'],
}
const FALLBACK_SYMBOLS = ['circle', 'circle.fill']

// An icon's side in the bar, in points (the page's own bar draws them at 22).
const ICON_POINTS = 22

// name → the icon as a PNG in base64 (null: couldn't be drawn), once drawn.
const pictures = new Map()
const drawing = new Set()

// Draws the icons not drawn yet, then calls `done`.
function drawIcons(names, doc, done) {
  for (const name of names) {
    if (!name || pictures.has(name) || drawing.has(name)) continue
    drawing.add(name)
    const draw = () => drawIcon(name, ICON_POINTS, doc).catch(() => null).then((picture) => {
      pictures.set(name, picture)
      drawing.delete(name)
      done()
    })
    if (iconLoaded(name)) void draw()
    else loadIcons([name], () => void draw())
  }
}

export function hasNativeTabBar() {
  return isIosApp()
}

// One request after the other: a « hide » never overtakes the « show »
// before it.
let queue = Promise.resolve()

function post(state) {
  queue = queue
    .then(() => fetch('/__ios/tabbar', { method: 'POST', headers: HEADERS, body: state }))
    .catch(() => {})
}

// property → the element that wears it as its colour, kept in the page;
// a colour as the browser says it → "#rrggbb".
const colorProbes = new Map()
const paintedColors = new Map()

// A colour of the page's as "#rrggbb", whatever CSS wrote it in (oklch(),
// color-mix()…): a canvas paints it and says what it painted.
// The probe stays in the page and a colour is painted once. Made and taken
// away at each reading, the probe woke the bar's own watch of the page's
// tree (useIosTabBar), which read the colour again: at every frame, for
// good, some 9 ms of each.
function readColor(property, doc) {
  try {
    let probe = colorProbes.get(property)
    if (!probe?.isConnected) {
      probe = doc.createElement('span')
      probe.hidden = true
      probe.style.color = `var(${property})`
      doc.documentElement.append(probe)
      colorProbes.set(property, probe)
    }
    const color = doc.defaultView.getComputedStyle(probe).color
    if (!paintedColors.has(color)) {
      const context = Object.assign(doc.createElement('canvas'), { width: 1, height: 1 }).getContext('2d')
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
      paintedColors.set(color, `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`)
    }
    return paintedColors.get(color)
  } catch {
    return null
  }
}

// The bar's state as the plugin reads it. `items`: the page's tab items
// ({ id, label, shortLabel, page, href, selected, tabIcon, tabIconSelected }),
// `newIds` the ones just launched, `icons` the pictures drawn so far.
export function tabBarState(items, { newIds = [], visible = true, tint = null, icons = pictures } = {}) {
  return {
    items: items.map((item) => {
      const [symbol, selectedSymbol] = SYMBOLS[item.id] ?? FALLBACK_SYMBOLS
      const image = icons.get(item.tabIcon) ?? null
      const selectedImage = icons.get(item.tabIconSelected) ?? image
      return {
        id: item.id,
        label: item.shortLabel ?? item.label,
        ...(image ? { image, selectedImage } : null),
        symbol,
        selectedSymbol,
        link: Boolean(item.href) && !item.disabled,
        badge: newIds.includes(item.id),
      }
    }),
    selected: items.find((item) => item.selected)?.id ?? null,
    visible,
    ...(tint ? { tint } : null),
  }
}

// Keeps the system's bar on the page's tabs while the component that calls
// it is there, and hides it after. `slotRef`: the element that holds the
// bar's place in the page; `onPress(id)`: a tab pressed.
export function useIosTabBar({ slotRef, items, newIds, onPress, enabled = true }) {
  const active = enabled && hasNativeTabBar()
  const latest = useRef({ items, newIds, onPress })
  const scheduleRef = useRef(null)

  // After each render: the tabs or the selected one may have changed.
  useEffect(() => {
    latest.current = { items, newIds, onPress }
    scheduleRef.current?.()
  })

  useEffect(() => {
    if (!active) return undefined
    const handleTab = (event) => latest.current.onPress?.(event.detail?.id)
    window.addEventListener(TAB_EVENT, handleTab)
    return () => window.removeEventListener(TAB_EVENT, handleTab)
  }, [active])

  useEffect(() => {
    if (!active) return undefined
    let frame = 0
    let sent = ''
    const sync = () => {
      frame = 0
      const slot = slotRef.current
      const shown = latest.current.items
      const names = shown.flatMap((item) => [item.tabIcon, item.tabIconSelected])
      drawIcons(names, document, schedule)
      // Not before its icons are drawn: the bar never changes its icons
      // under the student's eyes.
      if (names.some((name) => name && !pictures.has(name))) return
      const state = JSON.stringify(tabBarState(latest.current.items, {
        newIds: latest.current.newIds,
        visible: Boolean(slot) && !isSlotCovered(slot),
        tint: readColor('--brand', document),
      }))
      if (state === sent) return
      sent = state
      post(state)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(sync)
    }

    // Sheets, menus and notes come and go anywhere in the page; the tabs and
    // the theme change with it.
    const covers = new MutationObserver(schedule)
    covers.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-current', 'data-theme', 'data-palette'] })
    window.addEventListener('resize', schedule)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('animationend', schedule, true)
    const timer = window.setInterval(schedule, RESYNC_MS)
    scheduleRef.current = schedule
    schedule()

    return () => {
      scheduleRef.current = null
      window.cancelAnimationFrame(frame)
      window.clearInterval(timer)
      covers.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('transitionend', schedule, true)
      document.removeEventListener('animationend', schedule, true)
      post(JSON.stringify({ items: [], selected: null, visible: false }))
    }
  }, [active, slotRef])
}
