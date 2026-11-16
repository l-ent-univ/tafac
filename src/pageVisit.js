import { createContext, useContext, useEffect, useRef } from 'react'

// What a page's content knows of its page: whether it is the one shown, and
// which showing of it this is. Everywhere but the iOS app a page is mounted
// as it's shown and unmounted as it's left: always shown, on its first
// visit. The iOS app keeps its pages mounted behind the one shown
// (src/keptPages.js): there a hidden page goes quiet (no clock, no refresh,
// no clip playing) and an arrival is another `visit`, not a mount.
export const PageVisitContext = createContext({ shown: true, visit: 1 })

export function usePageShown() {
  return useContext(PageVisitContext).shown
}

// 1 on the page's first showing, one more each time it is shown again.
export function usePageVisit() {
  return useContext(PageVisitContext).visit
}

// Calls `onReturn` each time the page is shown again after another: what a
// mount did for an arrival (a refresh if stale, the arrival counted). Never
// as the page mounts, so never outside the iOS app.
export function usePageReturn(onReturn) {
  const { shown, visit } = useContext(PageVisitContext)
  const latest = useRef(onReturn)
  const seen = useRef(visit)
  useEffect(() => {
    latest.current = onReturn
  })
  useEffect(() => {
    if (!shown || seen.current === visit) return
    seen.current = visit
    latest.current()
  }, [shown, visit])
}

// What a page puts over the app (a sheet, a menu, a note: portals in <body>,
// out of the page's own place) goes with the page: `close` is called as the
// page is hidden. → whether the page is shown, for what is drawn meanwhile.
export function useClosedWithPage(close) {
  const shown = usePageShown()
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    if (!shown) latest.current()
  }, [shown])
  return shown
}

// `tick` every `ms` while the page is shown, and once as it shows again:
// what a clock missed while hidden.
export function usePageInterval(tick, ms) {
  const shown = usePageShown()
  const latest = useRef(tick)
  useEffect(() => {
    latest.current = tick
  })
  usePageReturn(() => latest.current())
  useEffect(() => {
    if (!shown) return undefined
    const timer = window.setInterval(() => latest.current(), ms)
    return () => window.clearInterval(timer)
  }, [shown, ms])
}
