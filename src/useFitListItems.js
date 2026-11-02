import { useLayoutEffect, useRef, useState } from 'react'

// The items (li) of a list that fit whole in its box show; the ones below
// are hidden, out of the tab order. Checked after each render and when the
// box changes size. `slack`: room kept under the last shown item (a
// block's shadow). Returns the box's ref and how many are hidden.
export default function useFitListItems({ slack = 0 } = {}) {
  const ref = useRef(null)
  const [hiddenCount, setHiddenCount] = useState(0)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box || typeof ResizeObserver === 'undefined') return undefined
    const fit = () => {
      const limit = box.getBoundingClientRect().bottom - slack
      let count = 0
      for (const item of box.querySelectorAll('li')) {
        item.style.visibility = ''
        const hidden = item.getBoundingClientRect().bottom > limit + 0.5
        item.style.visibility = hidden ? 'hidden' : ''
        item.inert = hidden
        if (hidden) count += 1
      }
      // Set only when it changes: no render loop.
      setHiddenCount((current) => (current === count ? current : count))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  })
  return [ref, hiddenCount]
}
