import { useEffect, useRef, useState } from 'react'

// Thin strip on the panel's left edge, as the sidebar's on its right
// (Sidebar's SidebarResizeHandle): drag to resize, double-click for the
// default width, or the arrow keys. Stored on release. `sizing`: its
// createSidePanelSizing (src/sidePanelWidth.js). `cssVar`: the
// panel's width property, set on an ancestor; `panelSelector`: the panel,
// measured when no width is stored; `label`: read out.
function SidePanelResizeHandle({ sizing, width, onWidthChange, onResizingChange, cssVar, panelSelector, label }) {
  const [isDragging, setIsDragging] = useState(false)
  const widthRef = useRef(width)
  useEffect(() => {
    widthRef.current = width
  }, [width])
  // Closed mid-drag (Escape): the page's resize cursor goes with it.
  useEffect(() => {
    if (!isDragging) return undefined
    return () => {
      document.documentElement.classList.remove('sidebar-resizing')
      onResizingChange(false)
    }
  }, [isDragging, onResizingChange])

  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsDragging(true)
    onResizingChange(true)
    document.documentElement.classList.add('sidebar-resizing')
  }

  const handlePointerMove = (event) => {
    if (!isDragging) return
    const next = sizing.clamp(window.innerWidth - sizing.rightPx - event.clientX)
    widthRef.current = next
    onWidthChange(next)
  }

  const endDragging = (event) => {
    if (!isDragging) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setIsDragging(false)
    onResizingChange(false)
    document.documentElement.classList.remove('sidebar-resizing')
    onWidthChange(widthRef.current, { persist: true })
  }

  // The panel's measured width when none is stored (a share of the window).
  const currentWidth = (target) => widthRef.current ?? target.closest('section')?.querySelector(panelSelector)?.getBoundingClientRect().width ?? sizing.min

  const handleKeyDown = (event) => {
    const step = { ArrowLeft: sizing.keyboardStepPx, ArrowRight: -sizing.keyboardStepPx }[event.key]
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      onWidthChange(event.key === 'Home' ? sizing.min : sizing.maxWidth(), { persist: true })
      return
    }
    if (!step) return
    event.preventDefault()
    onWidthChange(sizing.clamp(currentWidth(event.currentTarget) + step), { persist: true })
  }

  return (
    <div
      className="group hidden 4xl:block fixed top-6 bottom-6 z-30 w-3 translate-x-1/2"
      style={{ right: `calc(${sizing.rightPx}px + var(${cssVar}))` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={sizing.min}
        aria-valuemax={sizing.max}
        aria-valuenow={width ?? undefined}
        tabIndex={0}
        title="Glisser pour redimensionner, double-clic pour rétablir"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDragging}
        onPointerCancel={endDragging}
        onDoubleClick={() => onWidthChange(null, { persist: true })}
        onKeyDown={handleKeyDown}
        className="flex h-full w-full justify-center cursor-col-resize touch-none outline-none"
      >
        <span
          aria-hidden="true"
          className={`sidebar-handle-tint h-full w-[3px] rounded-full transition-opacity duration-150 ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'}`}
        />
      </div>
    </div>
  )
}

export default SidePanelResizeHandle
