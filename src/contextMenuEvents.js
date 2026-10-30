import { copyToClipboard, getContextMenuEntry } from './useContextMenu'
import { describeLink, linkMenuItems, normalizeMenu, selectionMenuItems } from './contextMenuItems'

// What ContextMenuHost opens for a press, worked out from the page (the
// places registered with useContextMenu, the link or selection under the
// pointer), and the same for a mail's body in its frame.

export const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
export const LONG_PRESS_MS = 500
// A finger moving this far is a scroll or a swipe, not a press.
export const LONG_PRESS_SLOP_PX = 10
// A right click's own selection snapshot (pointerdown) is this fresh at most.
export const SNAPSHOT_MS = 1500
// A keyboard-opened menu swallows the browser's own event this long after.
export const KEYBOARD_ECHO_MS = 600

// Set while the host is mounted: opens a menu ({ items, title, label }) at
// a point.
let openMenuAt = null

export function setMenuOpener(open) {
  openMenuAt = open
}

// The registrations from `element` outwards, the innermost first.
function registrationsFrom(element) {
  const chain = []
  let current = element?.closest?.('[data-menu]') ?? null
  while (current) {
    const entry = getContextMenuEntry(current.getAttribute('data-menu'))
    if (entry) chain.push({ element: current, entry, key: current.getAttribute('data-menu-key') })
    current = current.parentElement?.closest('[data-menu]') ?? null
  }
  return chain
}

// What the areas around offer, the innermost's winning.
function servicesOf(chain) {
  return chain.reduceRight((services, { entry }) => ({ ...services, ...entry.services }), {})
}

// The selected text when the point is on it, else ''.
export function selectionAt(doc, x, y) {
  const selection = doc?.getSelection?.()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return ''
  const text = selection.toString()
  if (!text.trim()) return ''
  for (let index = 0; index < selection.rangeCount; index += 1) {
    for (const rect of selection.getRangeAt(index).getClientRects()) {
      if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) return text
    }
  }
  return ''
}

// The menu for a press on `target`. `host`: where the places are looked up
// from (the target itself, or the frame it's in). `selectionText`: the
// selection under the pointer. `touch`: a long press (only places that take
// one; no selection or link menus).
export function resolveMenu({ target, host = target, selectionText = '', touch = false, inFrame = false }) {
  if (typeof target?.closest !== 'function') return null
  if (target.closest(EDITABLE_SELECTOR)) return null
  const chain = registrationsFrom(host)
  const services = servicesOf(chain)
  const copy = (text) => void copyToClipboard(text)

  if (selectionText && !touch) {
    const menu = normalizeMenu({ items: selectionMenuItems(selectionText, { copy, search: services.search ?? null }), label: 'Sélection' })
    return menu && { ...menu, kind: 'selection' }
  }

  const own = chain.find(({ entry }) => entry.build && (!touch || entry.longPress)) ?? null
  const anchor = target.closest('a[href]')
  // A link inside the place (not the place itself) is the closer one.
  const linkWins = anchor && (!own || (own.element !== anchor && own.element.contains(inFrame ? host : anchor)))
  if (linkWins) {
    if (touch) return null
    const link = describeLink({ href: anchor.getAttribute('href'), target: inFrame ? '_blank' : anchor.target, download: anchor.getAttribute('download') })
    if (!link) return null
    link.absoluteHref = anchor.href
    const openInNewTab = () => window.open(anchor.href, '_blank', 'noopener,noreferrer')
    const menu = normalizeMenu({
      items: linkMenuItems(link, {
        // What a click does (its handlers, its target); from a mail's frame,
        // a new tab as its links open.
        open: inFrame && link.kind !== 'download' ? openInNewTab : () => anchor.click(),
        openInNewTab,
        copy,
        compose: services.compose ?? null,
      }),
      label: link.kind === 'mail' ? link.address : 'Lien',
    })
    return menu && { ...menu, kind: 'link' }
  }

  if (!own) return null
  const menu = normalizeMenu(own.entry.build(own.key, { services, target }))
  return menu && { ...menu, label: menu.label ?? menu.title ?? 'Actions', kind: 'place' }
}

export const hasEscapeModifier = (event) => event.shiftKey || event.altKey || event.metaKey

// A mail's body (MailReader's frame, same origin, no scripts of its own):
// its links, addresses and selection get the app's menu too. Bound on each
// load; returns the unbinding.
export function bindFrameContextMenu(frame) {
  const doc = frame?.contentDocument
  if (!doc) return () => {}
  let snapshot = null
  const handlePointerDown = (event) => {
    if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
      snapshot = { at: Date.now(), text: selectionAt(doc, event.clientX, event.clientY) }
    }
  }
  const handleContextMenu = (event) => {
    if (hasEscapeModifier(event) || !openMenuAt) return
    const selectionText = snapshot && Date.now() - snapshot.at < SNAPSHOT_MS ? snapshot.text : selectionAt(doc, event.clientX, event.clientY)
    snapshot = null
    const menu = resolveMenu({ target: event.target, host: frame, selectionText, inFrame: true })
    if (!menu) return
    event.preventDefault()
    // The page takes the focus back from the frame first: the menu's first
    // item, focused from there, would show a keyboard's ring.
    frame.ownerDocument.defaultView.focus()
    const rect = frame.getBoundingClientRect()
    openMenuAt(menu, rect.left + event.clientX, rect.top + event.clientY)
  }
  doc.addEventListener('pointerdown', handlePointerDown, true)
  doc.addEventListener('contextmenu', handleContextMenu)
  return () => {
    doc.removeEventListener('pointerdown', handlePointerDown, true)
    doc.removeEventListener('contextmenu', handleContextMenu)
  }
}
