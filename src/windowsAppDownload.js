import { isNativeApp } from './desktopApp.js'
import { installerFromManifest } from './macAppDownload.js'

// The website on Windows offers the desktop app's installer, as on a Mac
// (src/macAppDownload.js, server/desktopUpdate, docs/DESKTOP.md): the
// signed-out landing page and the signed-in sidebar.

export const WINDOWS_PLATFORM = 'windows-x86_64'

// A Windows browser, not the apps. Windows on ARM runs the x64 app too.
export function isWindowsBrowser(nav = globalThis.navigator) {
  if (!nav) return false
  const { userAgent = '', platform = '' } = nav
  return /Windows/.test(userAgent || platform)
}

export function shouldOfferWindowsApp(nav = globalThis.navigator) {
  try {
    return !isNativeApp() && isWindowsBrowser(nav)
  } catch {
    return false
  }
}

// The installer the newest release announces, null until one does (and when
// tafac.fr can't be reached): no button leads to a 404 before the first
// release that has a Windows build. Read with a fetch, not a link to
// /desktop/download/<platform>: see macAppDownload.js.
export async function readWindowsInstaller(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl('/desktop/latest.json', { cache: 'no-cache' })
    if (!response.ok) return null
    return installerFromManifest(await response.json(), WINDOWS_PLATFORM)
  } catch {
    return null
  }
}
