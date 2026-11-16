import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { hasNativeMenu, showNativeMenu } from '../iosMenu'
import { dropdownMenuItems } from '../iosMenuItems'
import { useClosedWithPage } from '../pageVisit'
import SmoothSurface from './SmoothSurface'

// The rows and panel of the apps' context menu (AvailableApplications), so
// every menu looks and opens the same way. Long lists scroll.
const MENU_CLASSES = 'glass glass--menu favorites-context-menu fixed z-[80] max-h-[min(340px,60vh)] overflow-y-auto p-[6px] border corners-[18px] animate-context-menu-in'
const OPTION_CLASSES = 'favorites-context-action w-full flex items-center gap-[10px] min-h-[44px] px-3 border-0 corners-[12px] bg-transparent text-brand font-inherit text-[15px] font-semibold text-left cursor-pointer animate-context-action-in hover:bg-context-hover focus-visible:bg-context-hover focus-visible:outline-none'
const MENU_MIN_WIDTH = 220
const MENU_GAP = 8
const VIEWPORT_EDGE = 12

// The app's dropdown: a trigger styled by the caller (`triggerClassName`)
// that opens a list styled as the context menu, rendered in a portal so a
// scrolling parent (Mon compte) never clips it. It opens under the trigger,
// or above when there's no room, aligned on the trigger's start or end.
// Arrows/Home/End move, Enter picks, Escape, a click outside, a scroll or a
// resize closes. `options`: [{ value, label }]. `triggerLabel` (optional)
// replaces what the trigger shows (a shorter form); its accessible name and
// the menu keep the option's label. `actions` (optional): [{ id, label,
// icon, onSelect }], buttons under the options past a hairline (the
// planning's « Salles et personnels », under its views), outside the list
// of choices but in the arrows' reach.
//
// In the iOS app the list is the system's menu, hanging from the trigger
// (src/iosMenu.js): the choices, the one in force ticked, then the actions.
// The trigger stays the page's. Where the system can't, the list is this
// one as everywhere else.
function Dropdown({
  options,
  value,
  onChange,
  label,
  placeholder = '',
  disabled = false,
  align = 'start',
  className = '',
  triggerClassName = '',
  chevronClassName = 'size-3.5',
  triggerLabel = null,
  actions = [],
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const optionRefs = useRef([])
  const listId = useId()

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = options[selectedIndex] ?? null

  // The system's menu, where it can stand for the list (set back when it
  // turned out it couldn't).
  const [ownMenuOnly, setOwnMenuOnly] = useState(false)
  const menuItems = isOpen && !ownMenuOnly ? dropdownMenuItems(options, selectedIndex, actions) : null
  const isNative = menuItems != null && hasNativeMenu(menuItems)
  // What is picked is looked up in the choices of the moment.
  const latest = useRef(null)
  useEffect(() => {
    latest.current = { menuItems, options, actions, value, onChange }
  })
  useEffect(() => {
    const box = isNative ? triggerRef.current?.getBoundingClientRect() : null
    if (!box) return undefined
    let live = true
    const menu = showNativeMenu({ x: box.left, y: box.top, width: box.width, height: box.height, items: latest.current.menuItems })
    void menu.result.then((answer) => {
      if (!live) return
      if (!answer.shown) {
        setOwnMenuOnly(true)
        return
      }
      setIsOpen(false)
      const [kind, index] = String(answer.id ?? '').split(':')
      const current = latest.current
      if (kind === 'option') {
        const option = current.options[Number(index)]
        if (option && option.value !== current.value) current.onChange(option.value)
      } else if (kind === 'action') {
        current.actions[Number(index)]?.onSelect()
      }
    })
    return () => {
      live = false
      menu.close()
    }
  }, [isNative])

  // Placed before paint, once the menu's size is known.
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !menuRef.current) return
    const trigger = triggerRef.current.getBoundingClientRect()
    const width = Math.max(MENU_MIN_WIDTH, trigger.width, menuRef.current.offsetWidth)
    const height = menuRef.current.offsetHeight
    const fitsBelow = trigger.bottom + MENU_GAP + height <= window.innerHeight - VIEWPORT_EDGE
    const opensAbove = !fitsBelow && trigger.top - MENU_GAP - height >= VIEWPORT_EDGE
    const preferredLeft = align === 'end' ? trigger.right - width : trigger.left
    setPosition({
      top: opensAbove ? trigger.top - MENU_GAP - height : trigger.bottom + MENU_GAP,
      left: Math.min(Math.max(VIEWPORT_EDGE, preferredLeft), window.innerWidth - width - VIEWPORT_EDGE),
      minWidth: width,
      originX: align === 'end' ? `${width}px` : '0px',
      originY: opensAbove ? `${height}px` : '0px',
    })
  }, [isOpen, align])

  // Focus moves in once the menu is placed: it stays hidden until then, and a
  // hidden option can't take focus.
  const isPlaced = position != null
  useEffect(() => {
    if (isOpen && isPlaced) {
      optionRefs.current[Math.max(0, selectedIndex)]?.focus({ preventScroll: true })
    }
  }, [isOpen, isPlaced, selectedIndex])

  useEffect(() => {
    // The system's menu closes itself.
    if (!isOpen || isNative) return undefined

    const isInside = (target) => rootRef.current?.contains(target) || menuRef.current?.contains(target)
    const handlePointerDown = (event) => {
      if (!isInside(event.target)) setIsOpen(false)
    }
    // The menu is fixed: anything moving under it closes it, except its own scroll.
    const handleScroll = (event) => {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false)
    }
    const handleResize = () => setIsOpen(false)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [isOpen, isNative])

  // The menu goes with its page, where a page left stays mounted (the iOS
  // app, src/pageVisit.js).
  const pageShown = useClosedWithPage(() => setIsOpen(false))

  const close = () => {
    setIsOpen(false)
    setPosition(null)
    triggerRef.current?.focus()
  }

  const pick = (nextValue) => {
    if (nextValue !== value) onChange(nextValue)
    close()
  }

  const handleMenuKeyDown = (event) => {
    const current = optionRefs.current.indexOf(document.activeElement)
    const last = options.length + actions.length - 1
    const moves = { ArrowDown: Math.min(last, current + 1), ArrowUp: Math.max(0, current - 1), Home: 0, End: last }
    if (event.key in moves) {
      event.preventDefault()
      optionRefs.current[moves[event.key]]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      setIsOpen(false)
    }
  }

  const open = () => {
    setPosition(null)
    setIsOpen(true)
  }

  const optionButtons = options.map((option, index) => {
    const isSelected = index === selectedIndex
    return (
      <button
        key={option.value}
        ref={(element) => { optionRefs.current[index] = element }}
        type="button"
        role="option"
        aria-selected={isSelected}
        className={OPTION_CLASSES}
        onClick={() => pick(option.value)}
      >
        <span className="flex-1">{option.label}</span>
        {isSelected ? <Icon icon="ph:check" className="w-[18px] h-[18px] shrink-0" aria-hidden="true" /> : null}
      </button>
    )
  })
  // The list of choices: the menu itself, or its first part with actions.
  const hasActions = actions.length > 0
  const listProps = { id: listId, role: 'listbox', 'aria-label': label }

  return (
    <div ref={rootRef} className={`relative inline-flex min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={label ? `${label} : ${selected?.label ?? placeholder}` : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            open()
          } else if (event.key === 'Escape' && isOpen) {
            // Close the menu only, not what it sits in (Mon compte).
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }}
        className={triggerClassName}
      >
        {/* A trigger in a button material: its smooth surface too. */}
        {/\b(material|lent-button)\b/.test(triggerClassName) ? <SmoothSurface /> : null}
        <span className="min-w-0 truncate">{triggerLabel ?? selected?.label ?? placeholder}</span>
        <Icon icon="ph:caret-down" className={`shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''} ${chevronClassName}`} aria-hidden="true" />
      </button>
      {isOpen && !isNative && pageShown && typeof document !== 'undefined' ? createPortal(
        <div
          ref={menuRef}
          {...(hasActions ? {} : listProps)}
          className={MENU_CLASSES}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            minWidth: position?.minWidth ?? MENU_MIN_WIDTH,
            visibility: position ? 'visible' : 'hidden',
            '--favorites-context-origin-x': position?.originX ?? '0px',
            '--favorites-context-origin-y': position?.originY ?? '0px',
          }}
          onKeyDown={handleMenuKeyDown}
        >
          {hasActions ? <div {...listProps}>{optionButtons}</div> : optionButtons}
          {hasActions ? (
            <>
              <div className="mx-3 my-[5px] h-px bg-border" aria-hidden="true" />
              {actions.map((action, index) => (
                <button
                  key={action.id}
                  ref={(element) => { optionRefs.current[options.length + index] = element }}
                  type="button"
                  className={OPTION_CLASSES}
                  onClick={() => {
                    close()
                    action.onSelect()
                  }}
                >
                  {action.icon ? <Icon icon={action.icon} className="w-[18px] h-[18px] shrink-0" aria-hidden="true" /> : null}
                  <span className="flex-1">{action.label}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

export default Dropdown
