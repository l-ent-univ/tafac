import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'

// Kept this far from the window's edges.
const EDGE_MARGIN = 12

// The app's right-click menu (the apps' tiles, the mail list): opened at the
// pointer (`x`, `y`, client coordinates), kept inside the window, growing
// from the pointer. `items`: { id, label, icon, onSelect, destructive,
// disabled } or 'separator'; for a list of folders (the mail page's
// « Dossiers », « Déplacer vers »), also `depth` (indented that many steps),
// `detail` (a muted count at the end), `checked` (the one shown, ticked)
// and `hint` (a tooltip: the folder's path); for a colour, `swatch` (a
// CSS colour drawn as a dot in the icon's place; an empty string draws the
// « none » dot). `title`: an optional muted
// line on top (what the actions apply to); `above`: it grows upwards from
// (x, y), for a button at the screen's foot. A long list scrolls inside the
// menu. Closes on a pick, a click elsewhere, Escape, a scroll (of the page,
// not of the menu itself), a resize or the window losing focus; the arrow
// keys move between the items. Text sits on spans: a <button> takes its font from index.css's
// `button { font: inherit }`, outside Tailwind's layers. `anchor`: the
// button it was opened from, if any: a press on it is left to that button
// (which closes it, as a toggle), not taken as a click elsewhere.
function ContextMenu({ x, y, items, title = null, label, above = false, anchor = null, onClose }) {
  const menuRef = useRef(null)
  const [position, setPosition] = useState({ left: x, top: y, originX: '0px', originY: '0px' })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    // Its laid-out size, not the box on screen: the pop-in animation scales
    // it down at first, which made a menu near the right edge overflow it.
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const left = Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - width - EDGE_MARGIN))
    const top = Math.max(EDGE_MARGIN, Math.min(above ? y - height : y, window.innerHeight - height - EDGE_MARGIN))
    setPosition({ left, top, originX: `${x - left}px`, originY: `${y - top}px` })
    menu.querySelector('[role^="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [x, y, above])

  useEffect(() => {
    function handlePointerDown(event) {
      if (anchor?.contains(event.target)) return
      if (!menuRef.current?.contains(event.target)) onClose()
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const enabled = [...(menuRef.current?.querySelectorAll('[role^="menuitem"]:not(:disabled)') ?? [])]
      const index = enabled.indexOf(document.activeElement)
      const step = event.key === 'ArrowDown' ? 1 : -1
      enabled[(index + step + enabled.length) % enabled.length]?.focus()
    }
    function handleScroll(event) {
      if (!menuRef.current?.contains(event.target)) onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    // Capture: Escape closes the menu, not what's under it (the reader).
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose, anchor])

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu fixed z-60 min-w-[232px] max-w-[300px] max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain p-[5px] border border-border corners-[16px] bg-context-bg shadow-[0_1px_3px_rgb(52_18_0/0.08),0_18px_44px_-12px_var(--color-shadow)] backdrop-blur-[16px] animate-context-menu-in"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top, '--context-origin-x': position.originX, '--context-origin-y': position.originY }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {title ? <p className="m-0 px-[10px] pt-[6px] pb-[4px] text-[12px] font-semibold leading-none text-text-muted">{title}</p> : null}
      {items.map((item, index) => (item === 'separator' ? (
        <div key={`separator-${index}`} className="mx-[10px] my-[5px] h-px bg-border" aria-hidden="true" />
      ) : (
        <button
          key={item.id}
          type="button"
          role={item.checked == null ? 'menuitem' : 'menuitemradio'}
          disabled={item.disabled}
          title={item.hint || undefined}
          aria-checked={item.checked == null ? undefined : item.checked}
          style={item.depth ? { paddingLeft: `${10 + item.depth * 16}px` } : undefined}
          className={`context-menu-item flex w-full min-h-[34px] items-center gap-[10px] px-[10px] border-0 corners-[11px] bg-transparent text-left cursor-pointer hover:bg-context-hover focus-visible:bg-context-hover focus-visible:outline-none disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${item.destructive ? 'context-menu-item--destructive' : 'text-text'}`}
          onClick={() => {
            onClose()
            item.onSelect?.()
          }}
        >
          {item.swatch != null ? (
            <span
              className={`size-[16px] shrink-0 rounded-full border ${item.swatch ? 'border-black/10 dark:border-white/15' : 'context-menu-swatch--none border-border'}`}
              style={item.swatch ? { backgroundColor: item.swatch } : undefined}
              aria-hidden="true"
            />
          ) : item.icon ? <Icon icon={item.icon} className={`size-[16px] shrink-0 ${item.destructive ? '' : 'text-text-muted'}`} aria-hidden="true" /> : null}
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-tight">{item.label}</span>
          {item.detail != null ? <span className="shrink-0 text-[12px] font-semibold leading-none tabular-nums text-text-muted">{item.detail}</span> : null}
          {item.checked ? <Icon icon="carbon:checkmark" className="size-[14px] shrink-0 text-text" aria-hidden="true" /> : null}
        </button>
      )))}
    </div>,
    document.body,
  )
}

export default ContextMenu
