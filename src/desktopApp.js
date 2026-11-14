// The desktop app (src-tauri) loads this same page from its own scheme:
// tafac://localhost on macOS and Linux, http://tafac.localhost on Windows
// (WebView2). Nowhere else does the page have that address.
export function isDesktopApp() {
  try {
    return window.location.protocol === 'tafac:' || window.location.hostname === 'tafac.localhost'
  } catch {
    return false
  }
}

// The desktop app on macOS: no title bar (the page runs up to the window's
// top edge, the window's buttons over the sidebar's top corner) and the
// system's sidebar material behind the page (src-tauri/src/window.rs).
export function isMacDesktopApp() {
  try {
    return isDesktopApp() && /Mac/.test(navigator.platform || navigator.userAgent)
  } catch {
    return false
  }
}

// On <html>, for the CSS (src/overrides.css): data-desktop-app (pointer,
// scrolling and dragging like an app's) and, on macOS, data-desktop-macos
// (the sidebar on the system's material, room for the window's buttons).
export function markDesktopApp(root = document.documentElement) {
  if (!isDesktopApp()) return
  root.setAttribute('data-desktop-app', '')
  if (isMacDesktopApp()) root.setAttribute('data-desktop-macos', '')
}
