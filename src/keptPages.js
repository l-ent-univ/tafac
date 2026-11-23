// iOS app: a page stays mounted once visited, hidden while another shows, as
// a native tab's does: back on it, it is as it was left, nothing built or
// asked again (App's side: src/useKeptPages.js; the page's place:
// src/components/KeptPage.jsx; what a page is told: src/pageVisit.js).
// Here, without React, what is kept and for whom:
// - the pages kept, each with the times it was shown (`visit`: an arrival
//   on a kept page isn't a mount), where it was scrolled to when left
//   (`scroll`) and which mount it is (`key`);
// - they belong to an `owner` (the account) and to the pages on `offer`:
//   signed out, under another account or with other pages, the hidden ones
//   go, so nothing of a session is kept into another.
// « Moodle » isn't kept: its page is the place of a native view, which
// keeps Moodle's own state itself (MoodlePage).
const KEPT = new Set(['home', 'grades', 'planning', 'assiduity', 'mail'])

// On a page's place while it is kept (KeptPage), `hidden` with it.
export const KEPT_PAGE_CLASS = 'kept-page'

// A first visit, or a page asked from its top. `window`: the document's
// scroll (a phone); `column`: the app column's, which scrolls by itself on
// a wide screen.
export const PAGE_TOP = Object.freeze({ window: 0, column: 0 })

export const NO_KEPT_PAGES = Object.freeze({ owner: null, offer: '', shown: null, generation: 0, pages: Object.freeze({}) })

// The pages kept once `page` is the one shown, for `owner` (null: no page
// is kept) and the pages on `offer`. The same object when nothing changes:
// App derives it while rendering.
export function keepPages(state, { owner = null, offer = [], page }) {
  if (!owner) return state.owner === null ? state : { ...NO_KEPT_PAGES, generation: state.generation + 1 }

  const offerKey = [...offer].sort().join(',')
  let next = state
  if (state.owner !== owner) {
    next = { owner, offer: offerKey, shown: null, generation: state.generation + 1, pages: {} }
  } else if (state.offer !== offerKey) {
    // The page shown stays as it is (it isn't mounted again), alone.
    const shown = state.shown === page ? state.pages[page] : null
    next = { ...state, offer: offerKey, generation: state.generation + 1, pages: shown ? { [page]: shown } : {} }
  }
  if (next.shown === page) return next

  const entry = next.pages[page]
  // A page kept again after it was dropped is another mount: its key is new
  // (and its own: the pages are siblings).
  const shownEntry = entry ? { ...entry, visit: entry.visit + 1 } : { visit: 1, key: `${page}-${next.generation}`, scroll: null }
  return {
    ...next,
    shown: page,
    pages: KEPT.has(page) ? { ...next.pages, [page]: shownEntry } : next.pages,
  }
}

// The page shown is left: where it was scrolled to.
export function rememberScroll(state, scroll) {
  const entry = state.pages[state.shown]
  if (!entry) return state
  return { ...state, pages: { ...state.pages, [state.shown]: { ...entry, scroll: { window: scroll.window, column: scroll.column } } } }
}

// `page` is asked from its top (a day of the planning opened from a card).
export function forgetScroll(state, page) {
  const entry = state.pages[page]
  if (!entry?.scroll) return state
  return { ...state, pages: { ...state.pages, [page]: { ...entry, scroll: null } } }
}

// Where `page` comes back: where it was left, its top on a first visit.
export function scrollOf(state, page) {
  return state.pages[page]?.scroll ?? PAGE_TOP
}

// Whether `element` is in a kept page that isn't shown. Out of the layout,
// everything in it measures 0: what watches a size (ResizeObserver,
// IntersectionObserver) leaves its state as it is until the page is back.
export function isInHiddenPage(element) {
  return Boolean(element?.closest?.(`.${KEPT_PAGE_CLASS}[hidden]`))
}

// A page shown again comes out of `display: none`, where every CSS animation
// in it starts over: its content would arrive again as on a first visit.
// Each is taken to its end (those that loop go on); the page's own switch
// effect, on `root` itself, plays. → how many were ended.
export function settleAnimations(root) {
  let animations = []
  try {
    animations = root?.getAnimations?.({ subtree: true }) ?? []
  } catch {
    return 0
  }
  let settled = 0
  for (const animation of animations) {
    const effect = animation.effect
    // CSS animations only: a transition or a script's own wasn't started over.
    if (!effect || !('animationName' in animation)) continue
    if (effect.target === root && !effect.pseudoElement) continue
    if (!Number.isFinite(effect.getComputedTiming?.()?.endTime)) continue
    try {
      animation.finish()
      settled += 1
    } catch {
      // One that can't end (paused at rate 0): left as it is.
    }
  }
  return settled
}
