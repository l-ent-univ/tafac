import { isMacDesktopApp } from './desktopApp'

// Desktop app on macOS: the menu bar (src-tauri/src/menu.rs) and the page
// talk both ways.
// - Its commands reach the page as a `tafac:command` event on window, its
//   detail { command, page }: 'go' (« Aller », page: a page's id),
//   'new-message', 'find', 'refresh'. App handles going somewhere and a new
//   message, the page in view what it searches or refreshes.
// - The page tells the menu what it has, through the app's own route
//   (src-tauri/src/desktop.rs): « Aller »'s pages (this university's, none
//   signed out), the page in view (ticked), and which commands apply there
//   (the others greyed).

const COMMAND_EVENT = 'tafac:command'
const HEADERS = { 'X-Tafac-Desktop': '1', 'Content-Type': 'application/json' }

export function onDesktopCommand(handler, win = window) {
  const listener = (event) => handler(event.detail ?? {})
  win.addEventListener(COMMAND_EVENT, listener)
  return () => win.removeEventListener(COMMAND_EVENT, listener)
}

let lastState = null
let resendsOnFocus = false

function post(body) {
  void fetch('/__desktop/menu', { method: 'POST', headers: HEADERS, body }).catch(() => {})
}

// { pages: [{ id, label }], current, compose, find, refresh }. Sent when it
// changes, and again when this window comes to the front (the menu is the
// app's, another window may have set it since).
export function syncDesktopMenu(state, win = window) {
  if (!isMacDesktopApp()) return
  const body = JSON.stringify(state)
  if (!resendsOnFocus) {
    resendsOnFocus = true
    win.addEventListener('focus', () => {
      if (lastState) post(lastState)
    })
  }
  if (body === lastState) return
  lastState = body
  post(body)
}
