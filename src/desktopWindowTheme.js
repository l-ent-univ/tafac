// Desktop app on macOS: the sidebar's material (src-tauri/src/window.rs) is
// light or dark as the window is, so the window takes the app's theme.
// « Clair » or « Sombre » sets it; « Automatique » leaves it to the system
// (null): set there, it would also fix the page's prefers-color-scheme, and
// « Automatique » would stop following the system.
export function syncWindowTheme(theme, win = window) {
  const value = theme === 'light' || theme === 'dark' ? theme : null
  const internals = win.__TAURI_INTERNALS__
  if (!internals) return
  Promise.resolve(internals.invoke('plugin:window|set_theme', { value })).catch(() => {})
}
