import { useCallback, useEffect, useRef } from 'react'

const CLOSE_DISTANCE = 120
const CLOSE_VELOCITY = 0.5 // px/ms
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const LEAVE_MS = 260

// The scroll box under the finger, inside the sheet.
function scrollerOf(target, sheet) {
  for (let node = target; node && node !== sheet; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

// While it sits on its container's bottom edge (the grade sheets are
// centred dialogs from 640 px).
function isDocked(sheet) {
  const parent = sheet.parentElement
  return Boolean(parent) && sheet.getBoundingClientRect().bottom >= parent.getBoundingClientRect().bottom - 1
}

// A sheet with a grabber, by touch: pulled down (its content at the top) it
// follows the finger and closes past a distance or on a flick; pushed up the
// first time, it grows to its container's full height, then scrolls as
// usual. Only while docked, and not from a control that takes its own drags
// (.touch-none, a range). Returns `dismiss`, for its close button, backdrop
// and Escape: the sheet slides down (a centred dialog fades and shrinks),
// its backdrop (the element before it) fades, then `onClose`.
export function useSheetDrag(sheetRef, onClose) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const leavingRef = useRef(false)
  const timerRef = useRef(0)
  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const dismiss = useCallback(() => {
    const sheet = sheetRef.current
    if (leavingRef.current) return
    if (!sheet || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onCloseRef.current()
      return
    }
    leavingRef.current = true
    const backdrop = sheet.previousElementSibling
    sheet.style.transition = `transform ${LEAVE_MS}ms ${EASE}, opacity ${LEAVE_MS}ms ${EASE}`
    if (isDocked(sheet)) {
      sheet.style.transform = 'translateY(100%)'
    } else {
      sheet.style.opacity = '0'
      sheet.style.transform = 'scale(0.96)'
    }
    if (backdrop) {
      backdrop.style.transition = `opacity ${LEAVE_MS}ms ease-out`
      backdrop.style.opacity = '0'
    }
    timerRef.current = window.setTimeout(() => onCloseRef.current(), LEAVE_MS - 20)
  }, [sheetRef])

  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let gesture = null
    let expanded = false

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
      if (leavingRef.current || event.touches.length !== 1 || !isDocked(sheet)) return
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
      if (current.offset > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) {
        dismiss()
      } else {
        sheet.style.transition = reduceMotion ? 'none' : `transform ${LEAVE_MS}ms ${EASE}`
        sheet.style.transform = ''
      }
    }

    sheet.addEventListener('touchstart', handleStart, { passive: true })
    sheet.addEventListener('touchmove', handleMove, { passive: false })
    sheet.addEventListener('touchend', handleEnd)
    sheet.addEventListener('touchcancel', handleEnd)
    return () => {
      sheet.removeEventListener('touchstart', handleStart)
      sheet.removeEventListener('touchmove', handleMove)
      sheet.removeEventListener('touchend', handleEnd)
      sheet.removeEventListener('touchcancel', handleEnd)
    }
  }, [sheetRef, dismiss])

  return dismiss
}
