import { useEffect, useRef, useState } from 'react'

// How long the highlight stays stretched over both options before settling.
const STRETCH_MS = 150

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// The sliding highlight itself; position it with useSlidingIndicator().
// On a move it first stretches from the old option over the new one, then
// lets go of the old one: a liquid slide rather than a jump.
export function SlidingIndicator({ box, className = '' }) {
  const [shown, setShown] = useState(box)
  // The first placement lands directly; only later moves animate.
  const [canAnimate, setCanAnimate] = useState(false)
  const previousRef = useRef(box)

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = box

    const moved = previous && box && (previous.left !== box.left || previous.top !== box.top)
    if (!moved || !canAnimate || prefersReducedMotion()) {
      setShown(box)
      return undefined
    }

    const left = Math.min(previous.left, box.left)
    const top = Math.min(previous.top, box.top)
    setShown({
      left,
      top,
      width: Math.max(previous.left + previous.width, box.left + box.width) - left,
      height: Math.max(previous.top + previous.height, box.top + box.height) - top,
    })
    const timeoutId = window.setTimeout(() => setShown(box), STRETCH_MS)
    return () => window.clearTimeout(timeoutId)
  }, [box, canAnimate])

  useEffect(() => {
    if (!box || canAnimate) {
      return undefined
    }

    const frameId = window.requestAnimationFrame(() => setCanAnimate(true))
    return () => window.cancelAnimationFrame(frameId)
  }, [box, canAnimate])

  if (!shown) {
    return null
  }

  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute left-0 top-0 ${canAnimate ? 'transition-[transform,width,height] duration-[260ms] ease-[cubic-bezier(0.3,0.7,0.2,1)] motion-reduce:transition-none' : ''} ${className}`}
      style={{ transform: `translate(${shown.left}px, ${shown.top}px)`, width: shown.width, height: shown.height }}
    />
  )
}
