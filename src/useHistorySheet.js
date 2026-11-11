import { useCallback, useEffect, useRef, useState } from 'react'

// A sheet over the page with a history entry of its own, as the grade
// detail sheet has (GradeDetailProvider): opening it adds `key` to a new
// entry's state, next to appHistory's `tafac` (same page, same UE, so the
// app's and the UE view's popstate handlers leave it alone). Back (Android's
// gesture, the browser button) then only closes the sheet, Forward opens it
// again (afresh); its own close steps back off that entry.
export function useHistorySheet(key) {
  const [isOpen, setIsOpen] = useState(false)
  // Read by the history handlers, which outlive a render.
  const isOpenRef = useRef(false)
  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  // A reload on the sheet's entry: the sheet isn't reopened, so its mark goes.
  useEffect(() => {
    if (!window.history.state?.[key]) return
    try {
      const { [key]: _omit, ...state } = window.history.state ?? {}
      window.history.replaceState(state, '')
    } catch {
      // No history: nothing to tidy.
    }
  }, [key])

  const open = useCallback(() => {
    setIsOpen(true)
    try {
      window.history.pushState({ ...(window.history.state ?? {}), [key]: true }, '')
    } catch {
      // Sandboxed frame: the sheet just closes without its entry.
    }
  }, [key])

  // The close button, Escape, the backdrop: back off the sheet's entry when
  // it's the current one (popstate then closes it), plainly otherwise.
  // True when it stepped back (the page's own entry comes with a popstate).
  const close = useCallback(() => {
    if (isOpenRef.current && window.history.state?.[key]) {
      window.history.back()
      return true
    }
    setIsOpen(false)
    return false
  }, [key])

  useEffect(() => {
    const handlePopState = (event) => {
      const isEntryOpen = Boolean(event.state?.[key])
      if (isOpenRef.current !== isEntryOpen) setIsOpen(isEntryOpen)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [key])

  return { isOpen, open, close }
}
