import { useRef, useState } from 'react'
import SmoothSurface from './SmoothSurface'

// How far the thumb travels, off to on (the track's width, less the thumb
// and its 3 px insets).
const TRAVEL = { small: 16, regular: 18 }
// Past this, a press is a drag, not a click.
const DRAG_THRESHOLD = 3

// The app's switch (Réglages, the debug menu's toggles, the composer's
// signature). `small`: a notch smaller, beside a field's text. In the
// buttons' textures (.switch in overrides.css): the track a well pressed
// into the page, on the smooth pill (SmoothSurface), the thumb a raised
// knob of the material.
// A click (or Space, Enter) toggles it. Its thumb can also be dragged:
// pressed anywhere on the switch, it follows the pointer along the track
// and, let go, settles on the nearer side, which is the new value. A drag
// doesn't also count as a click. On a touch screen a vertical swipe still
// scrolls the page (touch-action: pan-y).
function Switch({ checked, onChange, small = false, label }) {
  const travel = small ? TRAVEL.small : TRAVEL.regular
  const [dragX, setDragX] = useState(null)
  const dragRef = useRef(null)
  const draggedRef = useRef(false)

  const endDrag = () => {
    dragRef.current = null
    setDragX(null)
  }

  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { startX: event.clientX, from: checked ? travel : 0, moved: false, x: checked ? travel : 0 }
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return
    drag.moved = true
    drag.x = Math.min(travel, Math.max(0, drag.from + dx))
    setDragX(drag.x)
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.moved) {
      // The click that follows this pointerup is the drag's, not a toggle.
      draggedRef.current = true
      const next = drag.x > travel / 2
      if (next !== checked) onChange(next)
    }
    endDrag()
  }

  const handleClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    onChange(!checked)
  }

  const dragging = dragX !== null
  // While dragged, the track shows the side the thumb would settle on.
  const shownOn = dragging ? dragX > travel / 2 : checked

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-dragging={dragging || undefined}
      data-shown={dragging ? (shownOn ? 'on' : 'off') : undefined}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        if (dragRef.current) endDrag()
      }}
      className={`switch relative inline-flex shrink-0 touch-pan-y select-none items-center rounded-full border-0 p-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${small ? 'h-[22px] w-[38px]' : 'h-[26px] w-[44px]'}`}
    >
      <SmoothSurface />
      <span
        aria-hidden="true"
        className={`switch-thumb absolute left-[3px] top-[3px] rounded-full transition-transform duration-150 ease-in-out ${small ? 'size-4' : 'size-5'} ${checked ? (small ? 'translate-x-4' : 'translate-x-[18px]') : 'translate-x-0'}`}
        style={dragging ? { translate: `${dragX}px 0`, transitionDuration: '0ms' } : undefined}
      />
    </button>
  )
}

export default Switch
