import { useCallback, useId, useLayoutEffect } from 'react'

// The places that give the app's right-click menu their own items
// (ContextMenuHost listens for the right click, a long press on a touch
// screen and the keyboard's menu key, finds the place and opens it). A
// place is marked by a data attribute (`data-menu`, its id here), so the
// element keeps its own handlers and refs; the registry holds what to show,
// read when the menu opens (never stale).
const registry = new Map()

export function getContextMenuEntry(id) {
  return registry.get(id) ?? null
}

// `build(key, context)`: the menu, an array of ContextMenu items (or
// { items, title, label }), null for none; called as it opens, `key` the
// one given to the props of the element pressed (a list's rows share one
// registration), `context.services` what the places around it offer (see
// below). Returns `menuProps(key)`, to spread on the element.
// `longPress` (default true): on a touch screen a long press opens it, for
// a button-like element (a row, a card) that has none of its own; false
// for one that should keep the system's (text to select).
// `services`: what a whole area offers the menus inside it, its own or the
// app's defaults (a selection's, a link's): `search(text)` (« Rechercher
// dans les mails »), `compose(address)` (« Nouveau message »). With no
// `build`, the registration only offers them.
export function useContextMenu(build, { longPress = true, services = null } = {}) {
  const id = useId()
  const pressable = longPress && Boolean(build)
  // Each render: the latest closures, without a ref read during render.
  useLayoutEffect(() => {
    registry.set(id, { build, longPress, services })
    return () => registry.delete(id)
  })
  return useCallback((key) => ({
    'data-menu': id,
    ...(key == null ? null : { 'data-menu-key': String(key) }),
    ...(pressable ? { 'data-menu-press': '' } : null),
  }), [id, pressable])
}

// Copies text, from a menu's pick (a user gesture). The async clipboard
// where there is one; elsewhere (an http page: the phone's dev server) a
// hidden field and the old copy command. Whether it went.
export async function copyToClipboard(text) {
  const content = String(text ?? '')
  if (!content) return false
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content)
      return true
    } catch {
      // Refused (no focus): the old way below.
    }
  }
  const field = document.createElement('textarea')
  field.value = content
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.append(field)
  field.select()
  field.setSelectionRange(0, content.length)
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  field.remove()
  return copied
}
