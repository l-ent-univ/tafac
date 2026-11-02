import { useEffect, useRef } from 'react'

const CLOSE_DISTANCE = 120
const CLOSE_VELOCITY = 0.5 // px/ms
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

// The scroll box under the finger, inside the sheet.
function scrollerOf(target, sheet) {
  for (let node = target; node && node !== sheet; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

// A sheet with a grabber, by touch: pulled down (its content at the top) it
// follows the finger and closes past a distance or on a flick; pushed up the
// first time, it grows to its container's full height, then scrolls as
// usual. Only while it sits on its container's bottom edge (the grade
// sheets are centred dialogs from 640 px), and not from a control that
// takes its own drags (.touch-none, a range).
export function useSheetDrag(sheetRef, onClose) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let gesture = null
    let expanded = false
    let closing = false
    let closeTimer = 0

    const isDocked = () => {
      const parent = sheet.parentElement
      return parent && sheet.getBoundingClientRect().bottom >= parent.getBoundingClientRect().bottom - 1
    }

    const expand = () => {
      expanded = true
      const parent = sheet.parentElement
      sheet.style.height = `${sheet.offsetHeight}px`
      sheet.style.maxHeight = 'none'
      void sheet.offsetHeight
      if (!reduceMotion) sheet.style.transition = `height 320ms ${EASE}`
      sheet.style.height = `${parent.clientHeight}px`
      sheet.style.paddingTop = 'env(safe-area-inset-top)'
    }

    const handleStart = (event) => {
      if (closing || event.touches.length !== 1 || !isDocked()) return
      if (event.target.closest?.('.touch-none, input[type="range"]')) return
      const touch = event.touches[0]
      gesture = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, scroller: scrollerOf(event.target, sheet), axis: null, offset: 0 }
    }

    const handleMove = (event) => {
      if (!gesture) return
      const touch = event.touches[0]
      const dx = touch.clientX - gesture.x
      const dy = touch.clientY - gesture.y
      if (!gesture.axis) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        if (Math.abs(dx) > Math.abs(dy)) {
          gesture = null
          return
        }
        const atTop = !gesture.scroller || gesture.scroller.scrollTop <= 0
        if (dy > 0 && atTop) gesture.axis = 'pull'
        else if (dy < 0 && !expanded) gesture.axis = 'grow'
        else {
          gesture = null
          return
        }
        if (gesture.axis === 'grow') expand()
        else sheet.style.transition = 'none'
      }
      event.preventDefault()
      if (gesture.axis === 'pull') {
        gesture.offset = Math.max(0, dy)
        sheet.style.transform = `translateY(${gesture.offset}px)`
      }
    }

    const handleEnd = (event) => {
      const current = gesture
      gesture = null
      if (current?.axis !== 'pull') return
      const velocity = current.offset / Math.max(1, event.timeStamp - current.time)
      sheet.style.transition = reduceMotion ? 'none' : `transform 260ms ${EASE}`
      if (current.offset > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) {
        closing = true
        sheet.style.transform = 'translateY(100%)'
        if (reduceMotion) onCloseRef.current()
        else closeTimer = window.setTimeout(() => onCloseRef.current(), 220)
      } else {
        sheet.style.transform = ''
      }
    }

    sheet.addEventListener('touchstart', handleStart, { passive: true })
    sheet.addEventListener('touchmove', handleMove, { passive: false })
    sheet.addEventListener('touchend', handleEnd)
    sheet.addEventListener('touchcancel', handleEnd)
    return () => {
      window.clearTimeout(closeTimer)
      sheet.removeEventListener('touchstart', handleStart)
      sheet.removeEventListener('touchmove', handleMove)
      sheet.removeEventListener('touchend', handleEnd)
      sheet.removeEventListener('touchcancel', handleEnd)
    }
  }, [sheetRef])
}
