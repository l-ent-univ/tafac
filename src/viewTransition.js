import { flushSync } from 'react-dom'

// Runs a state change as a view transition where the browser has them and
// motion is welcome, plainly otherwise (a UE's tile opening full page, the
// mail composer going full screen). `after` runs on the updated DOM before
// the new state is captured (to set the scroll it should land on).
export function withViewTransition(update, after = () => {}) {
  const apply = () => {
    flushSync(update)
    after()
  }
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduceMotion) {
    apply()
    return Promise.resolve()
  }
  return document.startViewTransition(apply).updateCallbackDone.catch(() => {})
}
