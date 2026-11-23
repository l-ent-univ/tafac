import { isNativeApp } from './desktopApp.js'

// The website on a Mac offers the desktop app's disk image
// (server/desktopUpdate, docs/DESKTOP.md). The links go to the installers
// named in /desktop/latest.json (on GitHub's releases), read with a fetch: a
// link to /desktop/download/<platform> is a navigation, which a service
// worker installed before /desktop/ was kept out of it answers with the app
// itself. That lasting address stays the fallback.

export const MAC_PLATFORMS = ['darwin-aarch64', 'darwin-x86_64']

// A Mac's browser, not the apps. An iPad may say it is a Mac: a Mac has no
// touch screen.
export function isMacBrowser(nav = globalThis.navigator) {
  if (!nav) return false
  const { userAgent = '', platform = '', maxTouchPoints = 0 } = nav
  return /Macintosh|Mac OS X/.test(userAgent || platform) && !(maxTouchPoints > 1)
}

export function shouldOfferMacApp(nav = globalThis.navigator) {
  try {
    return !isNativeApp() && isMacBrowser(nav)
  } catch {
    return false
  }
}

// The platform for a processor family the browser told ('arm', 'x86'),
// null when it didn't: only Chromium tells (userAgentData). Safari and
// Firefox get the chooser (MacAppDownloadModal).
export function macPlatform(architecture) {
  if (architecture === 'x86') return 'darwin-x86_64'
  if (architecture === 'arm') return 'darwin-aarch64'
  return null
}

export function macDownloadUrl(platform) {
  return `/desktop/download/${platform}`
}

export async function readMacArchitecture(nav = globalThis.navigator) {
  try {
    const values = await nav?.userAgentData?.getHighEntropyValues?.(['architecture'])
    return typeof values?.architecture === 'string' ? values.architecture : null
  } catch {
    return null
  }
}

// The platform's installer in a manifest, if it is an https address.
export function installerFromManifest(manifest, platform) {
  const installer = manifest?.platforms?.[platform]?.installer
  if (typeof installer !== 'string') return null
  try {
    return new URL(installer).protocol === 'https:' ? installer : null
  } catch {
    return null
  }
}

// Each Mac platform's disk image: the installer itself, else the server's
// lasting address.
export async function readMacInstallers(fetchImpl = globalThis.fetch) {
  let manifest = null
  try {
    const response = await fetchImpl('/desktop/latest.json', { cache: 'no-cache' })
    if (response.ok) manifest = await response.json()
  } catch {
    // Offline or not served: the lasting addresses.
  }
  return Object.fromEntries(MAC_PLATFORMS.map((platform) => [
    platform,
    installerFromManifest(manifest, platform) ?? macDownloadUrl(platform),
  ]))
}

// What the button needs: the installers, and this Mac's platform when the
// browser told it (else null: the chooser).
export async function resolveMacDownloads({ nav = globalThis.navigator, fetchImpl = globalThis.fetch } = {}) {
  const [architecture, installers] = await Promise.all([readMacArchitecture(nav), readMacInstallers(fetchImpl)])
  return { platform: macPlatform(architecture), installers }
}
