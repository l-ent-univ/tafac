import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const DURATION = 320
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

function reduceMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

// The transform that puts a box drawn at `to` over the box at `from`.
function flipTransform(from, to) {
  const scale = from.width / to.width
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${scale})`
}

/**
 * The student card, enlarged over everything: it grows from where it sat
 * (`originRef`, hidden meanwhile) to the middle of the screen, and shrinks
 * back there on a click anywhere or Escape. `children` the card itself,
 * `aspect` its width over its height (to fit the screen's height too).
 */
export default function StudentCardZoom({ originRef, aspect = 1.6, onClose, label = 'Carte étudiante', children }) {
  const backdropRef = useRef(null)
  const cardRef = useRef(null)
  const closingRef = useRef(false)

  // Grows out of the card in the page.
  useLayoutEffect(() => {
    const origin = originRef.current
    const card = cardRef.current
    if (!origin || !card) return undefined
    origin.style.visibility = 'hidden'
    if (!reduceMotion()) {
      card.animate(
        [{ transform: flipTransform(origin.getBoundingClientRect(), card.getBoundingClientRect()) }, { transform: 'none' }],
        { duration: DURATION, easing: EASING },
      )
      backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: 'ease-out' })
    }
    return () => {
      origin.style.visibility = ''
    }
  }, [originRef])

  // Shrinks back into it, then goes.
  const close = () => {
    if (closingRef.current) return
    closingRef.current = true
    const origin = originRef.current
    const card = cardRef.current
    if (!origin || !card || reduceMotion()) {
      onClose()
      return
    }
    const options = { duration: DURATION * 0.85, easing: EASING, fill: 'forwards' }
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], options)
    card
      .animate([{ transform: 'none' }, { transform: flipTransform(origin.getBoundingClientRect(), card.getBoundingClientRect()) }], options)
      .finished.then(onClose, onClose)
  }

  const closeRef = useRef(close)
  useLayoutEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      // Captured and marked handled: Escape closes the zoom, not the
      // settings under it.
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex cursor-zoom-out items-center justify-center p-5 max-sm:p-[14px]"
      onClick={(event) => {
        event.stopPropagation()
        close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div ref={backdropRef} className="absolute inset-0 bg-backdrop backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={cardRef}
        className="relative will-change-transform drop-shadow-2xl"
        style={{ width: `min(100%, 900px, calc((100dvh - 40px) * ${aspect}))` }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
