// The apps (src-tauri) load this same page from their own scheme:
// tafac://localhost on macOS, Linux and iOS, http://tafac.localhost on
// Windows (WebView2). Nowhere else does the page have that address. There
// the server is the device's own, behind the app's bridge.
export function isNativeApp() {
  try {
    return window.location.protocol === 'tafac:' || window.location.hostname === 'tafac.localhost'
  } catch {
    return false
  }
}

// The iOS app: the phone's layout, and nothing of what the desktop app adds
// around the page (menu bar, updates, Moodle's view, saved passwords). An
// iPad may say it is a Mac: a Mac has no touch screen.
export function isIosApp() {
  try {
    if (!isNativeApp()) return false
    const { userAgent, platform, maxTouchPoints } = navigator
    return /iPhone|iPad|iPod/.test(userAgent) || (/Mac/.test(platform || userAgent) && maxTouchPoints > 1)
  } catch {
    return false
  }
}

// The desktop app: a window on a computer.
export function isDesktopApp() {
  return isNativeApp() && !isIosApp()
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

// The desktop app on Windows 11: Mica behind the window (src-tauri/src/
// window.rs, which says so before the page runs). Not on Windows 10.
export function isMicaDesktopApp(win = window) {
  try {
    return isDesktopApp() && win.__TAFAC_MICA__ === true
  } catch {
    return false
  }
}

// On <html>, for the CSS (src/overrides.css): data-desktop-app (pointer,
// scrolling and dragging like an app's), on macOS data-desktop-macos (the
// sidebar on the system's material, room for the window's buttons) and on
// Windows 11 data-desktop-windows (the sidebar on Mica).
// The iOS app gets data-ios-app instead, and no zoom: an app's screens
// don't pinch or double-tap larger (the viewport says so, which the app's
// web view follows where Safari wouldn't; overrides.css stops the gestures
// themselves). The website keeps its zoom.
export function markDesktopApp(root = document.documentElement) {
  if (isIosApp()) {
    root.setAttribute('data-ios-app', '')
    root.ownerDocument
      ?.querySelector('meta[name="viewport"]')
      ?.setAttribute('content', 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover')
  }
  if (!isDesktopApp()) return
  root.setAttribute('data-desktop-app', '')
  if (isMacDesktopApp()) root.setAttribute('data-desktop-macos', '')
  if (isMicaDesktopApp()) root.setAttribute('data-desktop-windows', '')
}
