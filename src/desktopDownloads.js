import { isNativeApp } from './desktopApp'

// The apps (desktop and iOS): the web view can't download from the app's own
// address (tafac://, served by the app; macOS says "unsupported URL"), only
// a blob. So a download link of the app's (a mail attachment) is fetched by
// the page first, with its session, then saved from a blob: the desktop
// opens its Save panel (src-tauri/src/links.rs), iOS its share sheet
// (src-tauri/src/ios_downloads.rs).
// In the browser nothing changes: the link downloads as usual.

function isAppFile(href) {
  try {
    const url = new URL(href, window.location.href)
    return url.origin === window.location.origin
  } catch {
    return false
  }
}

async function saveThroughBlob(href, name) {
  const response = await fetch(href, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name || ''
  document.body.append(link)
  link.click()
  link.remove()
  // Let the download start before the blob goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Downloads `href` as `name`: through a blob in the apps, as a plain
// download link elsewhere.
export function downloadFile(href, name) {
  if (isNativeApp() && isAppFile(href)) {
    saveThroughBlob(href, name).catch((error) => console.warn('[tafac] download', error))
    return
  }
  const link = document.createElement('a')
  link.href = href
  link.download = name || ''
  link.click()
}

// The apps: every download link of the app's in the page (<a download>)
// goes through downloadFile.
export function enableDesktopDownloads(doc = document) {
  if (!isNativeApp()) return
  doc.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    const link = event.target instanceof Element ? event.target.closest('a[download][href]') : null
    if (!link) return
    const href = link.getAttribute('href')
    if (!href || href.startsWith('blob:') || href.startsWith('data:') || !isAppFile(href)) return
    event.preventDefault()
    downloadFile(link.href, link.getAttribute('download'))
  })
}
