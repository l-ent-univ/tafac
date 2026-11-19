import { isIosApp } from './desktopApp'
import { runRefreshers, watchRefreshers } from './pullRefresh'

// iOS app: pulling the page down refreshes it, with the system's own
// spinner (src-tauri/plugins/refresh), through the app's own route
// (src-tauri/src/ios_chrome.rs). The page says whether what it shows can
// be refreshed (src/pullRefresh.js): the spinner is there to pull only
// then. A pull comes back as a `tafac:refresh` event on window; the page
// reloads, then says it is done.

const HEADERS = { 'X-Tafac-Ios': '1', 'Content-Type': 'application/json' }
const REFRESH_EVENT = 'tafac:refresh'

function post(body) {
  return fetch('/__ios/refresh', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }).catch(() => {})
}

export function enableIosPullRefresh(win = window) {
  if (!isIosApp()) return
  let enabled = null
  watchRefreshers((hasAny) => {
    if (hasAny === enabled) return
    enabled = hasAny
    void post({ enabled })
  })
  let running = false
  win.addEventListener(REFRESH_EVENT, () => {
    if (running) return
    running = true
    void runRefreshers().finally(() => {
      running = false
      void post({ done: true })
    })
  })
}
