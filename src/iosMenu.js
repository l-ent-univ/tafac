import { isIosApp } from './desktopApp'
import { dotPicture, iconPicture } from './iosIcons'
import { canBeNative, nativeMenuItems } from './iosMenuItems'

// iOS app: the page's context menu (src/components/ContextMenu.jsx) and its
// dropdowns (src/components/Dropdown.jsx) are the system's menu
// (src-tauri/plugins/menu), through the app's own route
// (src-tauri/src/ios_chrome.rs). The page says where it opens and what is
// in it; what is picked comes back as a `tafac:menu` event on window, its
// detail { token, id }, id null when it closed without a pick.
//
// Before iOS 17.4 the system can't open a menu from the app (501): the page
// draws its own, there and from then on.

const HEADERS = { 'X-Tafac-Ios': '1', 'Content-Type': 'application/json' }
const MENU_EVENT = 'tafac:menu'
// An icon's side in the menu, in points; a colour's dot, as the page's.
const ICON_POINTS = 20
const DOT_POINTS = 16
// A menu doesn't wait longer for its icons: it opens without the late ones.
const ICON_WAIT_MS = 120
let supported = true
let count = 0

// Whether the system's menu stands for this one.
export function hasNativeMenu(items) {
  return isIosApp() && supported && canBeNative(items)
}

function within(promise, ms, win) {
  return Promise.race([promise, new Promise((resolve) => win.setTimeout(() => resolve(null), ms))])
}

async function picture(item, doc, win) {
  if (item === 'separator') return null
  if (item.swatch != null) {
    const image = dotPicture(item.swatch, DOT_POINTS, doc)
    return image ? { image, template: false } : null
  }
  if (!item.icon) return null
  const image = await within(iconPicture(item.icon, ICON_POINTS, doc), ICON_WAIT_MS, win)
  return image ? { image } : null
}

function post(body) {
  return fetch('/__ios/menu', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
}

// Opens the menu at (x, y), the page's coordinates; with a `width` and a
// `height`, hanging from that box (a dropdown's button). `result`: { shown:
// false } when the system couldn't (the page draws its own), else { shown:
// true, id } with the item picked, null for none. `close()` takes the menu
// back (the page no longer wants it).
export function showNativeMenu({ x, y, width = null, height = null, title = null, items }, { doc = document, win = window } = {}) {
  const token = `menu-${(count += 1)}`
  let closed = false
  let asked = false

  const result = (async () => {
    const pictures = await Promise.all(items.map((item) => picture(item, doc, win)))
    if (closed) return { shown: true, id: null }

    let stopListening = () => {}
    const picked = new Promise((resolve) => {
      const hear = (event) => {
        if (event.detail?.token !== token) return
        stopListening()
        resolve(event.detail.id ?? null)
      }
      stopListening = () => win.removeEventListener(MENU_EVENT, hear)
      win.addEventListener(MENU_EVENT, hear)
    })

    asked = true
    const box = width != null && height != null ? { width, height } : null
    const response = await post({ token, x, y, ...box, ...(title ? { title } : null), items: nativeMenuItems(items, pictures) })
    if (!response.ok) {
      stopListening()
      if (response.status === 501) supported = false
      return { shown: false }
    }
    return { shown: true, id: await picked }
  })().catch(() => ({ shown: false }))

  return {
    result,
    close() {
      if (closed) return
      closed = true
      if (asked) void post({ close: token }).catch(() => {})
    },
  }
}
