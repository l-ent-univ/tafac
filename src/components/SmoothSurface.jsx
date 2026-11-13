import { useId, useLayoutEffect, useRef, useState } from 'react'
import { generatePath } from '@lisse/core'

// A button's surface as a smooth-cornered shape: Figma's corner smoothing
// (60 %, the curve easing into the straight edges rather than meeting them),
// from Lisse (@lisse/core). Rendered first inside a .lent-button or a
// .material button, it sizes itself to that button and draws, behind its
// content: the face, a 1 px dark stroke outside it, a shade over the face,
// a pressed-in shade along its top edge (--surface-press, while pressed)
// and a 1 px white rim inside, bright at the top and fading down. The
// colours, the shade, the rim's strength and the drop shadow are the
// button's CSS variables (--surface-…, overrides.css), so its states, the
// themes and the palettes drive them as before. Until it has measured its
// button (the first render, the prerendered landing) the button keeps its
// CSS look, round-cornered: overrides.css switches only once it's here.
// The corner radius is the button's own, at most half its height (a pill).
// Its box is set inline: placed over the button's border box (an absolute
// child starts inside the border: the material's 1 px would shift it) and
// out of reach of the rules that style a button's own icon (.close-button
// svg fades it, others size or move it).

const SMOOTHING = 0.6

function readRadius(element, width, height) {
  const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
  return Math.min(radius, width / 2, height / 2)
}

export default function SmoothSurface() {
  const ref = useRef(null)
  const [shape, setShape] = useState(null)
  const id = useId().replace(/:/g, '')

  useLayoutEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return undefined
    // Layout size (offsetWidth/Height-like, but fractional): a press's
    // scale doesn't reshape it.
    const update = (width, height) => {
      if (!width || !height) return
      const radius = readRadius(host, width, height)
      const corners = { radius, smoothing: SMOOTHING, preserveSmoothing: true }
      const style = getComputedStyle(host)
      const offsetTop = -(parseFloat(style.borderTopWidth) || 0)
      const offsetLeft = -(parseFloat(style.borderLeftWidth) || 0)
      const outer = generatePath(width, height, corners)
      const rim = generatePath(width - 1, height - 1, { ...corners, radius: Math.max(0, radius - 0.5) })
      host.style.setProperty('--smooth-clip', `path("${outer}")`)
      setShape((current) => (current && current.outer === outer && current.offsetTop === offsetTop && current.offsetLeft === offsetLeft
        ? current
        : { width, height, outer, rim, offsetTop, offsetLeft }))
    }
    update(host.offsetWidth, host.offsetHeight)
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0]
      if (box) update(box.inlineSize, box.blockSize)
      else update(host.offsetWidth, host.offsetHeight)
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      host.style.removeProperty('--smooth-clip')
    }
  }, [])

  if (!shape) return <svg ref={ref} className="smooth-surface-pending" aria-hidden="true" />

  const { width, height, outer, rim, offsetTop, offsetLeft } = shape
  return (
    <svg
      ref={ref}
      className="smooth-surface"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', top: offsetTop, left: offsetLeft, width, height, margin: 0, opacity: 1, transform: 'none', translate: 'none', scale: 'none' }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* The outer stroke's mask: all but the shape, so the stroke
            (2px, centred on the edge) shows only its outer 1px, even
            over a see-through face. */}
        <mask id={`${id}-outside`} maskUnits="userSpaceOnUse" x={-4} y={-4} width={width + 8} height={height + 8}>
          <rect x={-4} y={-4} width={width + 8} height={height + 8} fill="#fff" />
          <path d={outer} fill="#000" />
        </mask>
        {/* The outer stroke, top to bottom: one colour (--surface-edge)
            unless a host sets two (an edge carved into the page: dark
            above, light below). */}
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--surface-edge-top, var(--surface-edge, transparent))' }} />
          <stop offset="1" style={{ stopColor: 'var(--surface-edge-bottom, var(--surface-edge, transparent))' }} />
        </linearGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--surface-shade-top, transparent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--surface-shade-bottom, transparent)' }} />
        </linearGradient>
        <linearGradient id={`${id}-press`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--surface-press, transparent)' }} />
          <stop offset="0.38" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" style={{ stopOpacity: 'var(--surface-rim-top)' }} />
          <stop offset="0.42" stopColor="#fff" style={{ stopOpacity: 'var(--surface-rim-mid)' }} />
          <stop offset="1" stopColor="#fff" style={{ stopOpacity: 'var(--surface-rim-bottom)' }} />
        </linearGradient>
      </defs>
      <path className="smooth-surface-edge" d={outer} stroke={`url(#${id}-edge)`} mask={`url(#${id}-outside)`} />
      <path className="smooth-surface-face" d={outer} />
      <path d={outer} fill={`url(#${id}-shade)`} />
      <path className="smooth-surface-press" d={outer} fill={`url(#${id}-press)`} />
      <path className="smooth-surface-rim" d={rim} transform="translate(0.5 0.5)" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="1" />
    </svg>
  )
}
