import { useLayoutEffect, useRef, useState } from 'react'

// A highlight that slides to the selected option of a group (sidebar nav,
// segmented controls) instead of jumping. Options mark themselves with
// data-active="true"; the group element gets the returned ref and must be
// `relative`.
export function useSlidingIndicator(activeKey) {
  const containerRef = useRef(null)
  const [box, setBox] = useState(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return undefined
    }

    const measure = () => {
      const active = container.querySelector('[data-active="true"]')
      const next = active && active.offsetWidth > 0
        ? { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight }
        : null
      // Same place, same object: the observer's first callback must not
      // restart (and cut short) a slide already under way.
      setBox((current) => (
        current && next
          && current.left === next.left && current.top === next.top
          && current.width === next.width && current.height === next.height
          ? current
          : next
      ))
    }

    measure()
    // Width changes (resizable sidebar, labels loading their font) and a
    // group shown after being display:none both resize the container.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(container)
    return () => observer?.disconnect()
  }, [activeKey])

  return [containerRef, box]
}
