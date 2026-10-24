import { useEffect, useState } from 'react'

// Shared by the landing page's mockups and sections.

// Where the pointer is in the window, from -1 to 1 on each axis, as
// --parallax-x / --parallax-y on the element (once per frame at most). The
// layers move by them in CSS (.landing-parallax in overrides.css). Mouse
// only, and not with reduced motion.
export function usePointerParallax(ref) {
  useEffect(() => {
    const element = ref.current
    const canMove = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches
    if (!element || !canMove) return undefined

    let frameId = 0
    let x = 0
    let y = 0
    const apply = () => {
      frameId = 0
      element.style.setProperty('--parallax-x', x.toFixed(3))
      element.style.setProperty('--parallax-y', y.toFixed(3))
    }
    const handlePointerMove = (event) => {
      x = (event.clientX / window.innerWidth) * 2 - 1
      y = (event.clientY / window.innerHeight) * 2 - 1
      if (!frameId) frameId = window.requestAnimationFrame(apply)
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.cancelAnimationFrame(frameId)
    }
  }, [ref])
}

// Plays the video only while it's on screen; with reduced motion it stays
// on its first frame (the poster).
export function useVisiblePlayback(ref) {
  useEffect(() => {
    const video = ref.current
    if (!video || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void video.play().catch(() => {})
      else video.pause()
    }, { threshold: 0.2 })
    observer.observe(video)
    return () => observer.disconnect()
  }, [ref])
}

// True once the element has come on screen, and from then on (for a
// data-revealed that starts its children's entrance in CSS).
export function useRevealOnce(ref) {
  const [isRevealed, setRevealed] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setRevealed(true)
      observer.disconnect()
    }, { threshold: 0.2 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return isRevealed
}

// To a section of the page, without a #hash in the address (the page's own
// history stays as it is).
export function scrollToSection(event, id) {
  const target = document.getElementById(id)
  if (!target) return
  event.preventDefault()
  const smooth = window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}

// Lets the element be picked up and thrown around: it follows the pointer,
// leaning into the way it moves, then springs back home once let go
// (.landing-drag in overrides.css). Its own `transform` only, so whatever
// animates inside it keeps going.
export function useDragToPlay(ref) {
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined

    let origin = null
    let frameId = 0
    let x = 0
    let y = 0
    let tilt = 0
    let lastX = 0
    // Leans the way it's dragged, settling back upright when held still.
    const apply = () => {
      frameId = 0
      element.style.transform = `translate(${x}px, ${y}px) rotate(${tilt.toFixed(2)}deg) scale(1.06)`
      tilt *= 0.85
      if (origin && Math.abs(tilt) > 0.1) frameId = window.requestAnimationFrame(apply)
    }
    const handlePointerDown = (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      element.setPointerCapture(event.pointerId)
      origin = { x: event.clientX, y: event.clientY }
      lastX = event.clientX
      x = 0
      y = 0
      tilt = 0
      element.dataset.dragging = ''
      apply()
    }
    const handlePointerMove = (event) => {
      if (!origin) return
      x = event.clientX - origin.x
      y = event.clientY - origin.y
      tilt = Math.max(-14, Math.min(14, tilt + (event.clientX - lastX) * 0.6))
      lastX = event.clientX
      if (!frameId) frameId = window.requestAnimationFrame(apply)
    }
    const handlePointerUp = () => {
      if (!origin) return
      origin = null
      window.cancelAnimationFrame(frameId)
      frameId = 0
      delete element.dataset.dragging
      element.style.transform = ''
    }

    element.addEventListener('pointerdown', handlePointerDown)
    element.addEventListener('pointermove', handlePointerMove)
    element.addEventListener('pointerup', handlePointerUp)
    element.addEventListener('pointercancel', handlePointerUp)
    return () => {
      element.removeEventListener('pointerdown', handlePointerDown)
      element.removeEventListener('pointermove', handlePointerMove)
      element.removeEventListener('pointerup', handlePointerUp)
      element.removeEventListener('pointercancel', handlePointerUp)
      window.cancelAnimationFrame(frameId)
    }
  }, [ref])
}
