import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Mail and deadlines cards when both are shown (and the RU's, with them).
// On phones they sit side by
// side in a swipeable strip ("Phone layout" in overrides.css) with a pager
// under it: one dot per card, the one in view drawn as a pill, a tap scrolls
// to that card. From xs up the strip dissolves (display: contents) into the
// widget row and the pager is hidden. The pager also hides when either card
// renders nothing, since the strip then holds a single full-width card.
function WidgetListStrip({ labels, visible = false, children }) {
  const stripRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const getCards = useCallback(() => (
    stripRef.current ? [...stripRef.current.children].filter((el) => el.classList.contains('widget-card')) : []
  ), [])

  // Offset of a card from the strip's snap position (its left padding).
  const getCardOffset = useCallback((card) => {
    const strip = stripRef.current
    const paddingLeft = parseFloat(getComputedStyle(strip).paddingLeft) || 0
    return card.getBoundingClientRect().left - strip.getBoundingClientRect().left - paddingLeft
  }, [])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return undefined

    let frameId = 0
    function syncActiveIndex() {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const cards = getCards()
        if (cards.length < 2) return
        // The last card can't reach the snap position: at the end of the
        // strip it is the one in view.
        if (strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1) {
          setActiveIndex(cards.length - 1)
          return
        }
        const distances = cards.map((card) => Math.abs(getCardOffset(card)))
        setActiveIndex(distances.indexOf(Math.min(...distances)))
      })
    }

    strip.addEventListener('scroll', syncActiveIndex, { passive: true })
    return () => {
      strip.removeEventListener('scroll', syncActiveIndex)
      window.cancelAnimationFrame(frameId)
    }
  }, [getCardOffset, getCards])

  // When the cards swap order (busier one first, src/listCardOrder.js),
  // scroll snapping would keep the previously shown card in view: go back
  // to the new first card instead.
  const orderKey = labels.join('|')
  const previousOrderKeyRef = useRef(orderKey)
  useLayoutEffect(() => {
    if (previousOrderKeyRef.current === orderKey) return
    previousOrderKeyRef.current = orderKey
    if (stripRef.current) stripRef.current.scrollLeft = 0
    setActiveIndex(0)
  }, [orderKey])

  const scrollToCard = (index) => {
    const strip = stripRef.current
    const card = getCards()[index]
    if (!strip || !card) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    strip.scrollBy({ left: getCardOffset(card), behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return (
    <>
      <div ref={stripRef} className="widget-lists">
        {children}
      </div>
      <div
        className={`widget-lists-pager justify-center transition-opacity duration-500 delay-[280ms] ${visible ? 'opacity-100' : 'opacity-0'}`}
        role="group"
        aria-label="Cartes mails, échéances et menu"
      >
        {labels.map((label, index) => {
          const isActive = index === activeIndex
          return (
            <button
              key={label}
              type="button"
              className="inline-flex items-center justify-center w-6 h-8 -my-1.5 p-0 border-0 bg-transparent cursor-pointer"
              onClick={() => scrollToCard(index)}
              aria-label={`Afficher la carte ${label}`}
              aria-current={isActive || undefined}
            >
              <span
                className={`block h-1.5 rounded-full transition-[width,background-color] duration-200 ease-out ${isActive ? 'w-4 bg-text' : 'w-1.5 bg-text-30'}`}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>
    </>
  )
}

export default WidgetListStrip
