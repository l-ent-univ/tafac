import { useCallback, useEffect, useRef, useState } from 'react'
import ContextMenu from './ContextMenu'
import {
  EDITABLE_SELECTOR,
  KEYBOARD_ECHO_MS,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  SNAPSHOT_MS,
  hasEscapeModifier,
  resolveMenu,
  selectionAt,
  setMenuOpener,
} from '../contextMenuEvents'

// The app's right-click menu everywhere it has something to offer (mounted
// once, beside App). What it opens on, from the element pressed outwards:
// - a field, a textarea, the composer's editor (contenteditable): the
//   browser's menu (spelling, paste);
// - selected text, the click on it: « Copier » (and « Rechercher dans les
//   mails » in Messagerie, its `search` service);
// - a place's own menu (useContextMenu: a class, a grade, a mail's address…),
//   unless a link inside it is closer;
// - a link: « Ouvrir », « Ouvrir dans un nouvel onglet », « Copier le lien »;
//   an address (mailto:) or a file, theirs;
// - anything else: the browser's menu (back, reload: nothing of ours).
// Places with a menu of their own (the apps' tiles, the mail list) handle
// the event first (it comes here prevented). ⇧, ⌥ or ⌘ held: always the
// browser's menu, the way out. On a touch screen a long press opens a
// place's menu (not a link's: the system previews it); the keyboard's menu
// key and ⇧F10 open the focused element's.

function ContextMenuHost() {
  const [menu, setMenu] = useState(null)
  // Opened from the keyboard: where the focus goes back to.
  const returnFocusRef = useRef(null)
  // Stable: the menu listens with it.
  const close = useCallback(() => {
    // Back to where it was, unless the pick moved it (a sheet opening) or a
    // click took it elsewhere.
    const returnFocus = returnFocusRef.current
    returnFocusRef.current = null
    if (returnFocus?.isConnected && document.activeElement?.closest?.('.context-menu')) {
      returnFocus.focus({ preventScroll: true })
    }
    setMenu(null)
  }, [])

  useEffect(() => {
    let nonce = 0
    const open = (next, x, y, returnFocus = null) => {
      nonce += 1
      returnFocusRef.current = returnFocus
      setMenu({ ...next, x, y, nonce })
    }
    setMenuOpener(open)

    // The selection as it was when the right button went down: Safari
    // selects the word under it before the menu event.
    let snapshot = null
    // A long press under way: { x, y, target, timer, fired }.
    let press = null
    // The click that ends a long press, not taken as a tap.
    let swallowClick = false
    // The menu key pressed (when), and the event it brought.
    let keyboardAt = 0
    let keyboardEvent = null
    let echoUntil = 0

    const cancelPress = () => {
      if (press && !press.fired) window.clearTimeout(press.timer)
      press = null
    }

    function handleContextMenuCapture(event) {
      if (Date.now() < echoUntil) {
        // The browser's own event after a menu the key already opened.
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (Date.now() - keyboardAt < KEYBOARD_ECHO_MS) {
        // The key's event (the browser's, or the one sent): any after it
        // is an echo.
        keyboardAt = 0
        keyboardEvent = event
        echoUntil = Date.now() + KEYBOARD_ECHO_MS
        return
      }
      if (hasEscapeModifier(event)) {
        // Past every handler: the browser's menu.
        event.stopPropagation()
        return
      }
      // Android's long press: the press under way opens the menu now.
      if (press?.fired) {
        event.preventDefault()
        event.stopPropagation()
      } else if (press) {
        window.clearTimeout(press.timer)
        press.fired = true
      }
    }

    function handleContextMenu(event) {
      if (event.defaultPrevented) return
      const fromKeyboard = event === keyboardEvent
      keyboardEvent = null
      // A long press (Android sends the event for it): a place's menu only,
      // the system keeps its own for links and text.
      const touch = event.pointerType === 'touch' || event.pointerType === 'pen'
      const target = fromKeyboard ? (document.activeElement ?? event.target) : event.target
      const fresh = snapshot && Date.now() - snapshot.at < SNAPSHOT_MS
      const selectionText = fromKeyboard || touch ? '' : fresh ? snapshot.text : selectionAt(document, event.clientX, event.clientY)
      snapshot = null
      const next = resolveMenu({ target, selectionText, touch })
      if (!next) return
      event.preventDefault()
      if (touch) swallowClick = true
      // Not the word Safari selected on the way: the menu is the place's.
      if (fresh && !selectionText && next.kind !== 'selection') document.getSelection()?.removeAllRanges()
      if (fromKeyboard) {
        const rect = target.getBoundingClientRect()
        open(next, rect.left + Math.min(16, rect.width / 2), rect.bottom + 4, target)
        return
      }
      open(next, event.clientX, event.clientY)
    }

    function handlePointerDown(event) {
      swallowClick = false
      cancelPress()
      if (event.pointerType === 'mouse') {
        if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
          snapshot = { at: Date.now(), text: selectionAt(document, event.clientX, event.clientY) }
        }
        return
      }
      if (!event.isPrimary || !event.target?.closest?.('[data-menu-press]')) return
      const target = event.target
      const current = { x: event.clientX, y: event.clientY, fired: false, timer: 0 }
      current.timer = window.setTimeout(() => {
        const next = resolveMenu({ target, touch: true })
        if (!next) {
          press = null
          return
        }
        current.fired = true
        swallowClick = true
        // Whatever the press began selecting goes.
        document.getSelection()?.removeAllRanges()
        open(next, current.x, current.y)
      }, LONG_PRESS_MS)
      press = current
    }

    function handlePointerMove(event) {
      if (press && !press.fired && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX) cancelPress()
    }

    function handlePointerEnd() {
      if (press && !press.fired) cancelPress()
    }

    function handleClickCapture(event) {
      if (!swallowClick) return
      swallowClick = false
      if (event.target?.closest?.('.context-menu')) return
      event.preventDefault()
      event.stopPropagation()
    }

    function handleScroll() {
      if (press && !press.fired) cancelPress()
    }

    // The keyboard's menu key, ⇧F10: the focused element's menu. The
    // browser's own event when it sends one, else one sent to it (macOS
    // sends none), which the places' handlers take as a right click.
    function handleKeyDown(event) {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
      const focused = document.activeElement
      if (!focused || focused === document.body || focused.closest(EDITABLE_SELECTOR)) return
      keyboardAt = Date.now()
      window.setTimeout(() => {
        if (!keyboardAt || Date.now() < echoUntil || !focused.isConnected) return
        const rect = focused.getBoundingClientRect()
        focused.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + Math.min(16, rect.width / 2),
          clientY: rect.bottom + 4,
        }))
        keyboardAt = 0
      }, 0)
    }

    window.addEventListener('contextmenu', handleContextMenuCapture, true)
    document.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true })
    window.addEventListener('pointerup', handlePointerEnd, true)
    window.addEventListener('pointercancel', handlePointerEnd, true)
    window.addEventListener('click', handleClickCapture, true)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    window.addEventListener('keydown', handleKeyDown, true)
    // Back or forward: the page under the menu is going.
    window.addEventListener('popstate', close)
    return () => {
      setMenuOpener(null)
      cancelPress()
      window.removeEventListener('contextmenu', handleContextMenuCapture, true)
      document.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('pointermove', handlePointerMove, { capture: true })
      window.removeEventListener('pointerup', handlePointerEnd, true)
      window.removeEventListener('pointercancel', handlePointerEnd, true)
      window.removeEventListener('click', handleClickCapture, true)
      window.removeEventListener('scroll', handleScroll, { capture: true })
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('popstate', close)
    }
  }, [close])

  if (!menu) return null
  return (
    <ContextMenu
      key={menu.nonce}
      x={menu.x}
      y={menu.y}
      items={menu.items}
      title={menu.title}
      label={menu.label}
      onClose={close}
    />
  )
}

export default ContextMenuHost
