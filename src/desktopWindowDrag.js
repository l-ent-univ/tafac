// Desktop app on macOS: the window has no title bar (src-tauri/src/window.rs).
// The band along its top, a Mac toolbar's height, moves the window as a
// title bar would: a press there on anything that isn't clickable drags it,
// a double click zooms it (on release, as macOS does and as Tauri's own drag
// regions do). The pages' headers sit in that band, their buttons keep
// working. The sidebar is a Tauri drag region (data-tauri-drag-region,
// handled by Tauri's script), left to it. Both go through Tauri's IPC,
// allowed by src-tauri/capabilities/default.json.

const BAND_HEIGHT = 52

const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY', 'VIDEO', 'IFRAME'])
const CLICKABLE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option', 'slider', 'textbox'])

function isClickable(element) {
  if (!(element instanceof Element)) return false
  if (CLICKABLE_TAGS.has(element.tagName)) return true
  if (CLICKABLE_ROLES.has(element.getAttribute('role'))) return true
  if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') return true
  if (element.isContentEditable) return true
  // The app's clickable cards and rows that aren't buttons carry it.
  return element.classList.contains('cursor-pointer')
}

function startsWindowMove(event) {
  if (event.button !== 0 || event.clientY > BAND_HEIGHT) return false
  // Over a dialog, a press outside it closes it.
  if (document.querySelector('[aria-modal="true"], dialog[open]')) return false
  const path = event.composedPath()
  if (path.some((element) => element instanceof Element && element.hasAttribute('data-tauri-drag-region'))) return false
  if (path.some(isClickable)) return false
  // On a scrollbar.
  const target = event.target
  if (target instanceof Element && event.offsetX > target.clientWidth && target.clientWidth > 0) return false
  return true
}

export function enableWindowMoveBand(win = window) {
  const invoke = (command) => win.__TAURI_INTERNALS__?.invoke(`plugin:window|${command}`)
  let doubleClickAt = null

  win.document.addEventListener('mousedown', (event) => {
    if (!startsWindowMove(event)) return
    if (event.detail === 2) {
      doubleClickAt = { x: event.clientX, y: event.clientY }
      return
    }
    if (event.detail !== 1) return
    event.preventDefault()
    invoke('start_dragging')
  })

  win.document.addEventListener('mouseup', (event) => {
    const at = doubleClickAt
    doubleClickAt = null
    if (event.detail !== 2 || !at || event.clientX !== at.x || event.clientY !== at.y) return
    if (!startsWindowMove(event)) return
    invoke('internal_toggle_maximize')
  })
}
