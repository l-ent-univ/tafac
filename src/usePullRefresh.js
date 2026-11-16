import { useEffect, useRef } from 'react'
import { usePageShown } from './pageVisit'
import { addRefresher } from './pullRefresh'

// What this component reloads when its page is pulled down (src/pullRefresh.js):
// `refresh()`, a promise where it knows when it is done. Only while its
// page is the one shown (a page left stays mounted in the iOS app).
export function usePullRefresh(refresh) {
  const shown = usePageShown()
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })
  useEffect(() => {
    if (!shown) return undefined
    return addRefresher(() => latest.current?.())
  }, [shown])
}
