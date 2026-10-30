import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'

// A list row swiped sideways with a finger to reveal its actions, as in
// Apple Mail (the mail list's rows, MailPage): `leading` shows on the left
// as the row moves right, `trailing` on the right as it moves left. Each
// action: { id, label, icon, tone ('blue', 'orange', 'red', 'gray'),
// onSelect, full, removes }, listed from the row's edge inwards: the first
// sits at the edge and, with `full`, runs on a long swipe (past about half
// the row) without lifting to tap it. `removes`: the action takes the row
// out of the list, so it slides away and stays out (the list's own exit
// animation follows, `exiting`); the others spring the row back shut.
//
// The finger decides: past 10 px it's a swipe if it went sideways, else the
// browser's vertical scroll (touch-action: pan-y; a mouse never drags, the
// right-click menu is its way to the same actions). Let go, the row settles
// open on its buttons (past half of them, or on a flick) or shut. One row
// is open at a time; a touch anywhere else or a scroll shuts it, a tap on
// the open row too (without opening it). A finger held still on the row
// (`onLongPress({ clientX, clientY })`) stands for the right click, which
// iOS doesn't send.
//
// The moving parts are written to the DOM straight from the pointer events
// (no render per move); React only adds the buttons while they show.

const ACTION_WIDTH = 76
const LOCK_DISTANCE = 10
const LONG_PRESS_MS = 500
// px/ms: faster than this, a lift opens or shuts the row whatever the distance.
const FLICK_SPEED = 0.35
const SETTLE_MS = 280
const SLIDE_OUT_MS = 220
const SETTLE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

// The row shown open: { root, close, cleanup }.
let openRow = null

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// The pull past a limit, slower the further it goes and never past
// `dimension` (UIScrollView's curve).
function rubberBand(distance, dimension) {
  return (1 - 1 / ((distance * 0.55) / dimension + 1)) * dimension
}

// How far the row opens on a side: its buttons, up to three quarters of it.
function openWidthOf(actions, width) {
  return Math.min(actions.length * ACTION_WIDTH, width * 0.75)
}

// Past this, a side whose first action is `full` runs it on the lift.
function fullThresholdOf(actions, width) {
  return Math.max(openWidthOf(actions, width) + 40, width * 0.5)
}

function SwipeableRow({ leading = [], trailing = [], onLongPress, exiting = false, className = '', children }) {
  const rootRef = useRef(null)
  const contentRef = useRef(null)
  const leadingRef = useRef(null)
  const trailingRef = useRef(null)
  // Where the row is (px, + to the right) and the touch moving it:
  // { id, x, y, base, speed, at, horizontal, done }, `done` once the long
  // press took it.
  const offsetRef = useRef(0)
  const gestureRef = useRef(null)
  // The side past its full-swipe point, if any.
  const fullRef = useRef(null)
  const suppressClickRef = useRef(false)
  // A removing action ran: the row waits slid out for the list to take it.
  const pendingRemovalRef = useRef(false)
  const timersRef = useRef({ longPress: 0, hide: 0, run: 0, removal: 0 })
  // The latest actions, for the ones run after a slide (not the render's
  // they were picked in).
  const actionsRef = useRef({ leading, trailing, onLongPress })
  const [revealed, setRevealed] = useState(false)

  useLayoutEffect(() => {
    actionsRef.current = { leading, trailing, onLongPress }
  })

  const sideActions = useCallback((side) => (side === 'leading' ? actionsRef.current.leading : actionsRef.current.trailing) ?? [], [])
  const rowWidth = useCallback(() => rootRef.current?.clientWidth || 360, [])
  // settle(0), for the listeners of an open row (holdOpen, set up before it).
  const settleRef = useRef(null)

  // The row at `x`, with a settle of `duration` ms or at once (a drag).
  const apply = useCallback((x, duration = 0) => {
    offsetRef.current = x
    const content = contentRef.current
    if (content) {
      content.style.transition = duration ? `transform ${duration}ms ${SETTLE_EASE}` : 'none'
      content.style.transform = x ? `translate3d(${x}px, 0, 0)` : ''
    }
    // Each side's buttons fill the room the row leaves.
    for (const [layer, width] of [[leadingRef.current, Math.max(x, 0)], [trailingRef.current, Math.max(-x, 0)]]) {
      if (!layer) continue
      layer.style.transition = duration ? `width ${duration}ms ${SETTLE_EASE}` : 'none'
      layer.style.width = `${width}px`
    }
  }, [])

  // One button of a side taking all its room (a full swipe, or a removing
  // action tapped), the others folding away; `index` null lets go.
  const expand = useCallback((side, index) => {
    for (const layer of [leadingRef.current, trailingRef.current]) {
      if (!layer) continue
      const active = index != null && layer === (side === 'leading' ? leadingRef.current : trailingRef.current)
      layer.toggleAttribute('data-expanding', active)
      ;[...layer.children].forEach((button, buttonIndex) => button.toggleAttribute('data-expanded', active && buttonIndex === index))
    }
  }, [])

  const markFull = useCallback((side) => {
    if (fullRef.current === side) return
    fullRef.current = side
    expand(side, side ? 0 : null)
  }, [expand])

  const releaseOpen = useCallback(() => {
    if (openRow?.root !== rootRef.current) return
    openRow.cleanup()
    openRow = null
  }, [])

  // The one open row: shut by a touch outside it or any scroll (another row
  // opening shuts it too).
  const holdOpen = useCallback(() => {
    const root = rootRef.current
    if (!root || openRow?.root === root) return
    openRow?.close()
    const close = () => settleRef.current?.(0)
    const handlePointerDown = (event) => {
      if (!root.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('scroll', close, true)
    openRow = {
      root,
      close,
      cleanup: () => {
        document.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('scroll', close, true)
      },
    }
  }, [])

  // Shut (x 0) or open on a side, sprung; shut, the buttons go once it's
  // over.
  const settle = useCallback((x) => {
    const duration = prefersReducedMotion() ? 0 : SETTLE_MS
    window.clearTimeout(timersRef.current.hide)
    apply(x, duration)
    if (x !== 0) {
      holdOpen()
      return
    }
    markFull(null)
    releaseOpen()
    timersRef.current.hide = window.setTimeout(() => {
      if (offsetRef.current === 0 && !gestureRef.current) setRevealed(false)
    }, duration + 40)
  }, [apply, holdOpen, markFull, releaseOpen])

  useLayoutEffect(() => {
    settleRef.current = settle
  }, [settle])

  // An action of `side` (by id): a removing one slides the row out and runs
  // as it's gone, the others as the row springs back.
  const run = useCallback((side, id) => {
    const actions = sideActions(side)
    const index = actions.findIndex((action) => action.id === id)
    if (index < 0) return
    if (!actions[index].removes) {
      settle(0)
      actions[index].onSelect?.()
      return
    }
    const reduced = prefersReducedMotion()
    releaseOpen()
    expand(side, index)
    apply((side === 'leading' ? 1 : -1) * rowWidth(), reduced ? 0 : SLIDE_OUT_MS)
    pendingRemovalRef.current = true
    const timers = timersRef.current
    window.clearTimeout(timers.run)
    timers.run = window.setTimeout(() => {
      sideActions(side).find((action) => action.id === id)?.onSelect?.()
      // Still in the list a moment later (the action didn't take it): back.
      window.clearTimeout(timers.removal)
      timers.removal = window.setTimeout(() => {
        if (!pendingRemovalRef.current) return
        pendingRemovalRef.current = false
        settle(0)
      }, 1000)
    }, reduced ? 0 : SLIDE_OUT_MS)
  }, [apply, expand, releaseOpen, rowWidth, settle, sideActions])

  // Gone from the list, then back before its exit was over (« Annuler »):
  // shut again.
  useEffect(() => {
    if (exiting) {
      window.clearTimeout(timersRef.current.removal)
      return
    }
    if (!pendingRemovalRef.current) return
    pendingRemovalRef.current = false
    settle(0)
  }, [exiting, settle])

  // The buttons just added: at the row's offset.
  useLayoutEffect(() => {
    if (!revealed) return
    apply(offsetRef.current)
    if (fullRef.current) expand(fullRef.current, 0)
  }, [revealed, apply, expand])

  useEffect(() => {
    const timers = timersRef.current
    const root = rootRef.current
    return () => {
      Object.values(timers).forEach((timer) => window.clearTimeout(timer))
      if (root && openRow?.root === root) {
        openRow.cleanup()
        openRow = null
      }
    }
  }, [])

  // Where the finger puts the row: 1:1 over the buttons; past them, held
  // back (rubber band), except on a side with a full swipe, which follows
  // on to the edge; a side without actions only gives a little.
  const resist = (raw) => {
    const width = rowWidth()
    const sign = Math.sign(raw)
    const distance = Math.abs(raw)
    const actions = sideActions(raw > 0 ? 'leading' : 'trailing')
    if (!actions.length) return sign * rubberBand(distance, width * 0.1)
    const open = openWidthOf(actions, width)
    if (distance <= open) return raw
    if (actions[0].full) return sign * Math.min(distance, width)
    return sign * (open + rubberBand(distance - open, width * 0.2))
  }

  const fullSideAt = (x) => {
    if (!x) return null
    const side = x > 0 ? 'leading' : 'trailing'
    const actions = sideActions(side)
    return actions[0]?.full && Math.abs(x) >= fullThresholdOf(actions, rowWidth()) ? side : null
  }

  const handlePointerDown = (event) => {
    // A new gesture: a click the last one kept from landing would have come
    // by now.
    suppressClickRef.current = false
    const gesture = gestureRef.current
    if (gesture && gesture.id !== event.pointerId) {
      // A second finger (a pinch): the row lets go.
      gestureRef.current = null
      window.clearTimeout(timersRef.current.longPress)
      if (gesture.horizontal) settle(0)
      return
    }
    if (event.pointerType !== 'touch') {
      // A mouse on an open row (a touch screen with a mouse): shuts it.
      if (offsetRef.current) {
        suppressClickRef.current = true
        settle(0)
      }
      return
    }
    if (!event.isPrimary || pendingRemovalRef.current) return
    window.clearTimeout(timersRef.current.run)
    gestureRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, base: offsetRef.current, speed: 0, at: event.timeStamp, lastX: event.clientX, horizontal: false, done: false }
    window.clearTimeout(timersRef.current.longPress)
    if (actionsRef.current.onLongPress) {
      timersRef.current.longPress = window.setTimeout(() => {
        const current = gestureRef.current
        if (!current || current.horizontal || current.done) return
        // The rest of this touch is the menu's; its lift opens nothing.
        current.done = true
        suppressClickRef.current = true
        if (offsetRef.current) settle(0)
        actionsRef.current.onLongPress?.({ clientX: current.x, clientY: current.y })
      }, LONG_PRESS_MS)
    }
  }

  const handlePointerMove = (event) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.id !== event.pointerId || gesture.done) return
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    if (!gesture.horizontal) {
      if (Math.hypot(dx, dy) > LOCK_DISTANCE) window.clearTimeout(timersRef.current.longPress)
      if (Math.abs(dy) > LOCK_DISTANCE && Math.abs(dy) >= Math.abs(dx)) {
        // Up or down: the page's scroll. An open row shuts (the scroll does
        // it too, but a list too short to scroll sends none).
        gestureRef.current = null
        if (gesture.base) settle(0)
        return
      }
      if (Math.abs(dx) < LOCK_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.2) return
      gesture.horizontal = true
      // From here on: no jump by the 10 px it took to decide.
      gesture.x += Math.sign(dx) * LOCK_DISTANCE
      gesture.lastX = event.clientX
      window.clearTimeout(timersRef.current.hide)
      try {
        contentRef.current?.setPointerCapture?.(event.pointerId)
      } catch {
        // A pointer the browser no longer tracks: the drag goes on uncaptured.
      }
      if (openRow && openRow.root !== rootRef.current) openRow.close()
      setRevealed(true)
    }
    const elapsed = Math.max(1, event.timeStamp - gesture.at)
    // Smoothed, so one late event doesn't make (or undo) a flick.
    gesture.speed = gesture.speed * 0.4 + ((event.clientX - gesture.lastX) / elapsed) * 0.6
    gesture.lastX = event.clientX
    gesture.at = event.timeStamp
    const x = resist(gesture.base + event.clientX - gesture.x)
    apply(x)
    markFull(fullSideAt(x))
  }

  const handlePointerEnd = (event) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.id !== event.pointerId) return
    gestureRef.current = null
    window.clearTimeout(timersRef.current.longPress)
    if (gesture.done) return
    if (!gesture.horizontal) {
      // A tap on the open row shuts it, without opening the mail.
      if (gesture.base) {
        suppressClickRef.current = true
        settle(0)
      }
      return
    }
    suppressClickRef.current = true
    const x = offsetRef.current
    const full = fullRef.current
    if (full && event.type !== 'pointercancel') {
      run(full, sideActions(full)[0].id)
      return
    }
    markFull(null)
    const sign = Math.sign(x)
    const actions = sideActions(sign > 0 ? 'leading' : 'trailing')
    if (!sign || !actions.length) {
      settle(0)
      return
    }
    // Let go: open on a flick outwards or past half the buttons, shut on a
    // flick back or short of it.
    const open = openWidthOf(actions, rowWidth())
    const flick = gesture.speed * sign
    if (flick < -FLICK_SPEED) settle(0)
    else if (flick > FLICK_SPEED || Math.abs(x) > open / 2) settle(sign * open)
    else settle(0)
  }

  const renderActions = (side) => {
    const actions = side === 'leading' ? leading : trailing
    if (!revealed || !actions.length) return null
    return (
      <div ref={side === 'leading' ? leadingRef : trailingRef} className={`mail-swipe-actions mail-swipe-actions--${side}`}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`mail-swipe-action mail-swipe-action--${action.tone ?? 'gray'}`}
            onClick={() => run(side, action.id)}
          >
            <span className="mail-swipe-action-inner">
              <Icon icon={action.icon} className="mail-swipe-action-icon size-5" aria-hidden="true" />
              <span className="mail-swipe-action-label text-[12px] font-semibold leading-[1.15]">{action.label}</span>
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={`mail-swipe ${revealed ? 'is-revealed' : ''} ${className}`}>
      <div
        ref={contentRef}
        className="mail-swipe-content"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return
          suppressClickRef.current = false
          event.stopPropagation()
          event.preventDefault()
        }}
        onContextMenuCapture={(event) => {
          const gesture = gestureRef.current
          if (!gesture) return
          // The long press opened the menu already, or the row is being
          // swiped: not the browser's long-press menu on top.
          if (gesture.done || gesture.horizontal) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          // The browser's long press came first (Android): the row's own
          // right-click handler opens the menu, the long press stands down.
          gesture.done = true
          window.clearTimeout(timersRef.current.longPress)
          suppressClickRef.current = true
        }}
      >
        {children}
      </div>
      {renderActions('leading')}
      {renderActions('trailing')}
    </div>
  )
}

export default SwipeableRow
