import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'

const BUBBLE_WIDTH = 280
const BUBBLE_GAP = 8
const VIEWPORT_EDGE = 12

// ⓘ next to a card's title. Hover or focus shows the note; a tap toggles it
// (touch). The bubble is rendered in a portal at a fixed width, under the ⓘ
// (above it when there's no room) and kept inside the window, so a small
// card's `overflow-hidden` never clips or squeezes it. A scroll or resize
// closes it. Clicks stay here: a clickable card isn't opened by the ⓘ.
// `icon` / `iconClassName`: another glyph than ⓘ (the UE cards' warning).
// `text`: a word beside the glyph, the button then a small pill (a jury code).
function CardInfoTip({ label, children, icon = 'carbon:information', iconClassName = 'text-text-muted hover:text-text focus-visible:text-text', text = null }) {
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [position, setPosition] = useState(null)
  const buttonRef = useRef(null)
  const bubbleRef = useRef(null)
  const noteId = useId()
  const isOpen = isHovered || isFocused || isPinned

  const close = useCallback(() => {
    setIsHovered(false)
    setIsPinned(false)
  }, [])

  // Placed before paint, once the bubble's height is known.
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current || !bubbleRef.current) return
    const anchor = buttonRef.current.getBoundingClientRect()
    const width = Math.min(BUBBLE_WIDTH, window.innerWidth - 2 * VIEWPORT_EDGE)
    const height = bubbleRef.current.offsetHeight
    const fitsBelow = anchor.bottom + BUBBLE_GAP + height <= window.innerHeight - VIEWPORT_EDGE
    const left = Math.min(
      Math.max(VIEWPORT_EDGE, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - VIEWPORT_EDGE,
    )
    setPosition({
      top: fitsBelow ? anchor.bottom + BUBBLE_GAP : Math.max(VIEWPORT_EDGE, anchor.top - BUBBLE_GAP - height),
      left,
      width,
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleScroll = () => {
      close()
      buttonRef.current?.blur()
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [isOpen, close])

  const isShown = isOpen && position != null

  return (
    <span
      className="inline-flex shrink-0"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setIsHovered(true)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setIsHovered(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={noteId}
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation()
          setIsPinned((current) => !current)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') close()
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          setIsPinned(false)
        }}
        className={`inline-flex items-center justify-center rounded-full border-0 cursor-pointer transition-colors duration-150 ${text ? 'h-[22px] gap-[4px] pr-[8px] pl-[5px]' : 'size-[18px] bg-transparent p-0'} ${iconClassName}`}
      >
        <Icon icon={icon} className="w-[15px] h-[15px]" aria-hidden="true" />
        {text ? <span className="font-display text-[12.5px] font-bold leading-none tracking-[0.3px]">{text}</span> : null}
      </button>
      {typeof document !== 'undefined' ? createPortal(
        <span
          ref={bubbleRef}
          id={noteId}
          role="tooltip"
          className={`pointer-events-none fixed z-[90] block corners-[14px] border border-black/10 bg-black px-3 py-[8px] font-body text-[12px] font-medium leading-snug text-white shadow-[0_12px_32px_rgba(0,0,0,0.18)] transition-[opacity,transform] duration-180 ease-out dark:border-white/15 dark:bg-white dark:text-black ${
            isShown ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-1 opacity-0'
          }`}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: position?.width ?? BUBBLE_WIDTH,
          }}
        >
          {children}
        </span>,
        document.body,
      ) : null}
    </span>
  )
}

export default CardInfoTip
