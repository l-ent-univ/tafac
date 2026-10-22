import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'

const ACTION_CLASSES = 'favorites-context-action w-full flex items-center gap-[10px] min-h-[44px] px-3 border-0 rounded-[12px] bg-transparent font-inherit text-[15px] font-semibold text-left cursor-pointer animate-context-action-in hover:bg-context-hover focus-visible:bg-context-hover focus-visible:outline-none'
const MARGIN = 12

// A message's right-click menu, drawn as the favourites' one
// (AvailableApplications): at the pointer and kept on screen. The arrows
// move between actions; Escape, Tab, a click elsewhere, scrolling or
// leaving the window close it. `items`: { icon, label, onSelect, danger }
// or 'separator'. `onClose` must keep its identity.
export default function MailContextMenu({ x, y, label, items, onClose }) {
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    })
    menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [x, y])

  useEffect(() => {
    const previous = document.activeElement
    const handlePointerDown = (event) => {
      if (!ref.current?.contains(event.target)) onClose()
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault()
        onClose()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const actions = [...(ref.current?.querySelectorAll('[role="menuitem"]') ?? [])]
      const index = actions.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? actions.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length
      actions[next]?.focus()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('blur', onClose)
      if (previous?.isConnected) previous.focus?.({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="favorites-context-menu fixed z-60 min-w-[252px] p-[6px] border border-border rounded-[18px] bg-context-bg shadow-[0_18px_40px_var(--color-shadow)] backdrop-blur-[12px] animate-context-menu-in max-md:min-w-[220px]"
      style={{
        left: position.left,
        top: position.top,
        '--favorites-context-origin-x': `${Math.max(18, x - position.left)}px`,
        '--favorites-context-origin-y': `${Math.max(18, y - position.top)}px`,
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (item === 'separator' ? (
        <div key={`separator-${index}`} className="mx-2 my-1 h-px bg-border/80" aria-hidden="true" />
      ) : (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`${ACTION_CLASSES} ${item.danger ? 'text-error' : 'text-brand'}`}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          <Icon icon={item.icon} className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      )))}
    </div>,
    document.body,
  )
}
