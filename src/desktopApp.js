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
