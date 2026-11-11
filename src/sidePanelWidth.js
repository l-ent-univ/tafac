import { useCallback, useState } from 'react'

// A side panel's width (the mail reader's, MailPage; the planning's
// « Salles et personnels », PlanningDirectoryPanel), dragged from its left
// edge and stored for the device, else `defaultWidth` (a CSS share of the
// window). `contentMin`: room the page keeps beside a dragged panel (its
// 24px gutters included).
export function createSidePanelSizing({ storageKey, defaultWidth, min, max, contentMin, rightPx = 12, keyboardStepPx = 16 }) {
  const read = () => {
    try {
      const value = Number(JSON.parse(localStorage.getItem(storageKey) || 'null')?.value)
      return Number.isFinite(value) ? value : null
    } catch {
      return null
    }
  }

  const store = (width) => {
    try {
      if (width == null) localStorage.removeItem(storageKey)
      else localStorage.setItem(storageKey, JSON.stringify({ value: width }))
    } catch {
      // Storage unavailable
    }
  }

  // The widest the panel gets in this window: the page keeps its room.
  const maxWidth = () => {
    const sidebarWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 0
    return Math.max(min, Math.min(max, window.innerWidth - sidebarWidth - contentMin))
  }

  const clamp = (width) => Math.round(Math.min(maxWidth(), Math.max(min, width)))

  // The CSS width: a dragged one still gives way to the page in a narrower
  // window (as clamp does under the pointer).
  const toCss = (width) => {
    if (width == null) return defaultWidth
    return `clamp(${min}px, min(${width}px, 100vw - var(--sidebar-width, 280px) - ${contentMin}px), ${max}px)`
  }

  return { read, store, maxWidth, clamp, toCss, min, max, rightPx, keyboardStepPx }
}

// The stored width and its setter (`persist` on release), and whether it's
// being dragged (the page's padding then follows without its transition).
export function useSidePanelWidth(sizing) {
  const [width, setWidth] = useState(sizing.read)
  const [isResizing, setIsResizing] = useState(false)
  const onWidthChange = useCallback((next, { persist = false } = {}) => {
    setWidth(next)
    if (persist) sizing.store(next)
  }, [sizing])
  return { width, css: sizing.toCss(width), isResizing, onWidthChange, onResizingChange: setIsResizing }
}
