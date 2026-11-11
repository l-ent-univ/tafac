import { useCallback, useEffect, useRef, useState } from 'react'

// What the page shows in place of its own, with a history entry of its
// own, as a sheet has one (useHistorySheet) but holding a value (the
// planning's room or person shown on a phone, PlanningPage): `key` in the
// entry's state, next to appHistory's `tafac`. Shown on an entry pushed
// over the page's (or the current one's, replaced, when it already holds
// one: one entry however many are shown in a row), so Back goes back to
// the page's own; Forward shows it again. A reload, or the page mounting
// again on its entry, starts from the page's own. → { value, show(next),
// showAfterBack(next) }: `show(null)` backs off its entry (plainly without
// one); `showAfterBack(next)` waits for the history.back() just made (a
// sheet over the page closing, useHistorySheet's `close`) and shows `next`
// on the entry it lands on.
export function useHistoryValue(key) {
  const [value, setValue] = useState(null)
  const pendingRef = useRef(null)

  useEffect(() => {
    if (!window.history.state?.[key]) return
    try {
      const { [key]: _omit, ...state } = window.history.state ?? {}
      window.history.replaceState(state, '')
    } catch {
      // No history: nothing to tidy.
    }
  }, [key])

  const show = useCallback((next) => {
    const state = window.history.state ?? {}
    if (next == null) {
      if (state[key]) window.history.back()
      else setValue(null)
      return
    }
    try {
      if (state[key]) window.history.replaceState({ ...state, [key]: next }, '')
      else window.history.pushState({ ...state, [key]: next }, '')
    } catch {
      // Sandboxed frame: shown without its entry.
    }
    setValue(next)
  }, [key])

  const showAfterBack = useCallback((next) => {
    pendingRef.current = { next }
  }, [])

  useEffect(() => {
    const handlePopState = (event) => {
      setValue(event.state?.[key] ?? null)
      const pending = pendingRef.current
      if (!pending) return
      pendingRef.current = null
      show(pending.next)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [key, show])

  return { value, show, showAfterBack }
}
