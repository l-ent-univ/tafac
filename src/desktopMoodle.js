// Desktop app: what the page says to Moodle's web view and hears from it
// (src-tauri/src/moodle.rs, through /__desktop/moodle/*). The view is native
// and lies over the page's slot (src/components/MoodlePage.jsx): the page
// tells it where the slot is, when to show and when to hide.

const HEADERS = { 'X-Tafac-Desktop': '1', 'Content-Type': 'application/json' }

const PHASES = new Set(['none', 'opening', 'ready', 'signin', 'expired', 'failed', 'elsewhere', 'gone'])

// Before the app has said anything.
export const INITIAL_MOODLE_STATE = Object.freeze({
  version: null,
  phase: 'opening',
  loading: false,
  back: false,
  forward: false,
  title: '',
  file: false,
})

// What the app sent, in the shapes the page counts on; null if it isn't one.
// phase: 'none' (no view), 'opening' (signing in, or on the way to the page
// asked for), 'ready', 'signin' (Moodle asks to sign in and the server
// couldn't, the session still valid), 'expired' (the server found the
// session expired: the app signs out), 'failed' (the page didn't load),
// 'elsewhere' (the view is in another window of the app: there is one, the
// last window to ask has it), 'gone' (it was closed with the window it was
// in: to be opened again).
export function parseMoodleState(value) {
  if (!value || typeof value !== 'object' || !PHASES.has(value.phase)) return null
  return {
    version: Number.isSafeInteger(value.version) ? value.version : null,
    phase: value.phase,
    loading: value.loading === true,
    back: value.back === true,
    forward: value.forward === true,
    title: typeof value.title === 'string' ? value.title : '',
    file: value.file === true,
  }
}

export function sameMoodleState(left, right) {
  return Boolean(left) && Boolean(right)
    && Object.keys(INITIAL_MOODLE_STATE).every((key) => key === 'version' || left[key] === right[key])
}

// The slot's place in the window, in whole points (the view's size is):
// edges rounded, so it never leaves a hairline beside the sidebar.
export function slotBounds(rect) {
  const x = Math.round(rect.left)
  const y = Math.round(rect.top)
  return { x, y, width: Math.round(rect.right) - x, height: Math.round(rect.bottom) - y }
}

export function rectsOverlap(left, right) {
  return left.left < right.right && right.left < left.right && left.top < right.bottom && right.top < left.bottom
}

// Where the slot is probed, as fractions of its width and height: close
// enough that a sheet, a menu or a note over it is met. A little inside its
// edges: what only pokes over one (the sidebar's handle, on its edge) isn't
// over the slot.
const PROBES = [0, 0.12, 0.26, 0.4, 0.54, 0.68, 0.82, 1]
const PROBE_INSET = 12

// A dialog or a sheet anywhere: it comes over the page (sliding in, it isn't
// over the slot yet).
const DIALOGS = '.weather-modal-backdrop, [role="dialog"], [role="alertdialog"], dialog[open]'
// Small things, which the probes may miss: counted when they reach the slot.
const POPUPS = '[role="menu"], [role="tooltip"], [role="listbox"], .context-menu'

function isRendered(element) {
  if (typeof element.checkVisibility === 'function') return element.checkVisibility({ visibilityProperty: true })
  return element.getClientRects().length > 0
}

// Whether the page draws something over the slot. The view is native, above
// all of the page: whatever the page opens there would stay behind it.
export function isSlotCovered(slot, doc = document) {
  const rect = slot.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return true
  if ([...doc.querySelectorAll(DIALOGS)].some((element) => !slot.contains(element) && isRendered(element))) return true
  if ([...doc.querySelectorAll(POPUPS)].some((element) => !slot.contains(element) && isRendered(element) && rectsOverlap(element.getBoundingClientRect(), rect))) return true
  // Anything else: what takes a press at a point of the slot is on top there.
  const inset = Math.min(PROBE_INSET, rect.width / 2, rect.height / 2)
  for (const fx of PROBES) {
    for (const fy of PROBES) {
      const x = rect.left + inset + fx * (rect.width - 2 * inset)
      const y = rect.top + inset + fy * (rect.height - 2 * inset)
      const top = doc.elementFromPoint(x, y)
      if (top && !slot.contains(top)) return true
    }
  }
  return false
}

// The app's colours Moodle's view takes on (src-tauri/src/moodle_style.css
// reads them as --tafac-<name>): tokens.css' roles, the sidebar's solid
// material and overrides.css' solid glass. Keep in sync with
// THEME_TOKENS in src-tauri/src/moodle_style.rs.
export const MOODLE_THEME_TOKENS = Object.freeze({
  'surface-page': '--surface-page',
  'surface-sunken': '--surface-sunken',
  'surface-subtle': '--surface-subtle',
  'surface-strong': '--surface-strong',
  'surface-field': '--surface-field',
  'surface-card': '--surface-card',
  'surface-raised': '--surface-raised',
  'surface-raised-hover': '--surface-raised-hover',
  ink: '--ink',
  'ink-secondary': '--ink-secondary',
  'ink-muted': '--ink-muted',
  'ink-faint': '--ink-faint',
  line: '--line',
  'line-strong': '--line-strong',
  'state-hover': '--state-hover',
  'state-press': '--state-press',
  'focus-ring': '--focus-ring',
  brand: '--brand',
  'brand-hover': '--brand-hover',
  'brand-soft': '--brand-soft',
  'on-brand': '--on-brand',
  danger: '--danger',
  'danger-soft': '--danger-soft',
  warning: '--warning',
  'warning-soft': '--warning-soft',
  success: '--success',
  'success-soft': '--success-soft',
  info: '--info',
  'info-soft': '--info-soft',
  notify: '--notify',
  scrim: '--scrim',
  'shadow-tint': '--shadow-tint',
  sidebar: '--material-sidebar-solid',
  'glass-fill': '--glass-solid-fill',
  'glass-fill-hover': '--glass-solid-fill-hover',
})

// The theme as the page shows it now: { dark, tokens }, each token a colour
// the browser resolved (rgb(), oklch(), color()…), the palette's numbers
// and color-mix() worked out.
export function readMoodleTheme(doc = document) {
  const root = doc.documentElement
  const probe = doc.createElement('span')
  probe.hidden = true
  root.append(probe)
  const style = doc.defaultView.getComputedStyle(probe)
  const tokens = {}
  for (const [name, property] of Object.entries(MOODLE_THEME_TOKENS)) {
    probe.style.color = `var(${property})`
    const value = style.color
    if (value) tokens[name] = value
  }
  probe.remove()
  return { dark: root.dataset.theme === 'dark', tokens }
}

export function sameMoodleTheme(left, right) {
  if (!left || !right || left.dark !== right.dark) return false
  return Object.keys(MOODLE_THEME_TOKENS).every((name) => left.tokens[name] === right.tokens[name])
}

// One request after the other: a `hide` never overtakes the `show` before it.
let queue = Promise.resolve()

function post(path, body) {
  return fetch(`/__desktop/moodle/${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body ?? {}) })
}

// open { x, y, width, height, target?, theme? }, show { x, y, width,
// height }, bounds { x, y, width, height }, hide, command { command },
// theme { dark, tokens }. Resolves to whether the app took it.
export function askMoodle(path, body) {
  const request = queue.then(() => post(path, body)).then((response) => response.ok, () => false)
  queue = request
  return request
}

// The view's state. Waits (a second at most) for a change since `since`,
// the version of the state the page has; null when the app didn't answer.
export async function readMoodleState(since = null) {
  try {
    const response = await post('state', since == null ? {} : { since })
    return response.ok ? parseMoodleState(await response.json()) : null
  } catch {
    return null
  }
}
