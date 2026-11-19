import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { NO_KEPT_PAGES, forgetScroll, keepPages, rememberScroll, scrollOf } from './keptPages'

// App's side of the pages kept in the iOS app (src/keptPages.js): which are
// kept, and each one's scroll, saved as it is left and put back as it shows
// again (the document scrolls on a phone, `columnRef`'s element on a wide
// screen: one position for every page otherwise).
// `owner`: who the pages are kept for, null where none is (everywhere but
// the iOS app, signed out); `offer`: the pages there are; `page`: the one
// shown. → { pages, leave }: `pages[id]`, a kept page's { visit, key };
// `leave(to, { fromTop })`, called before `to` is shown, true when the
// scroll is this hook's to set (false: the caller's, as without kept pages).
export function useKeptPages({ owner, offer, page, columnRef }) {
  const [state, setState] = useState(NO_KEPT_PAGES)
  // While rendering: a page is never drawn for another owner than its own.
  const kept = keepPages(state, { owner, offer, page })
  if (kept !== state) setState(kept)

  const keptRef = useRef(kept)
  useLayoutEffect(() => {
    keptRef.current = kept
  }, [kept])

  // Read before the page changes: once the page left is out of the layout,
  // the document is the next one's height and its scroll is gone.
  const leave = useCallback((to, { fromTop = false } = {}) => {
    const current = keptRef.current
    if (!current.owner || current.shown === to) return false
    const scroll = { window: window.scrollY, column: columnRef.current?.scrollTop ?? 0 }
    setState((latest) => {
      const left = rememberScroll(latest, scroll)
      return fromTop ? forgetScroll(left, to) : left
    })
    return true
  }, [columnRef])

  const isKeeping = Boolean(kept.owner)
  const shown = kept.shown
  const visit = kept.pages[shown]?.visit ?? 0
  const { window: windowTop, column: columnTop } = scrollOf(kept, shown)
  // Before the page shown is painted: where it was left, its top the first
  // time. --page-scroll: for its switch effect, which grows from the middle
  // of what is on screen (overrides.css).
  useLayoutEffect(() => {
    if (!isKeeping) return
    const column = columnRef.current
    column?.scrollTo({ top: columnTop, behavior: 'instant' })
    window.scrollTo({ top: windowTop, behavior: 'instant' })
    column?.style.setProperty('--page-scroll', `${Math.max(windowTop, columnTop)}px`)
  }, [isKeeping, shown, visit, windowTop, columnTop, columnRef])

  return { pages: kept.pages, leave }
}
