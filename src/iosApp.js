import { isIosApp } from './desktopApp'

// iOS app: the page runs behind the status bar on a phone and draws its own
// top there (src/overrides.css, « iOS app · status bar »). The page tells
// the app its background colour, for what shows around the web view (on a
// tablet, the bar itself: src-tauri/src/ios_chrome.rs), and its theme, so
// the clock reads on it.

const HEADERS = { 'X-Tafac-Ios': '1', 'Content-Type': 'application/json' }

function post(body) {
  void fetch('/__ios/chrome', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }).catch(() => {})
}

// The theme-color in force: index.html has one per system scheme, which
// src/theme.js repaints with the theme and the palette.
function currentThemeColor(doc, win) {
  const metas = [...doc.querySelectorAll('meta[name="theme-color"]')]
  const meta = metas.find((candidate) => !candidate.media || win.matchMedia(candidate.media).matches) ?? metas[0]
  return meta?.content ?? ''
}

// Sent now and whenever it changes: a theme or a palette picked, the system
// going dark. (src/iosGlass.js changes that colour's last bits to mark a
// frame for the app: nothing to the eye, here either.)
export function enableIosStatusBar(doc = document, win = window) {
  if (!isIosApp()) return
  let last = ''
  const send = () => {
    const color = currentThemeColor(doc, win)
    if (!color || color === last) return
    last = color
    post({ color })
  }
  const observer = new MutationObserver(send)
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    observer.observe(meta, { attributes: true, attributeFilter: ['content'] })
  }
  win.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', send)
  send()
}

// « Clair » or « Sombre » sets the app's appearance; « Automatique » leaves
// it to the system.
export function syncIosAppearance(theme) {
  if (!isIosApp()) return
  post({ theme: theme === 'light' || theme === 'dark' ? theme : 'auto' })
}
