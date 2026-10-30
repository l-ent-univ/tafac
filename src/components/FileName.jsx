import { useLayoutEffect, useRef, useState } from 'react'

// A file's name on one line, cut in its middle when it doesn't fit, as
// Finder does: its start and its end (the extension and a few characters
// before it) kept around an ellipsis, to the width there is (measured on a
// canvas in the row's font, again as it resizes). The row's hover has it in
// full, the download keeps it. The reader's attachment rows, the composer's
// attachment chips.
const FILE_NAME_END = 12
let measureContext = null
function FileName({ name }) {
  const text = String(name ?? '')
  const ref = useRef(null)
  const [shown, setShown] = useState(text)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    function fit() {
      const width = element.clientWidth
      if (!width) return
      measureContext ??= document.createElement('canvas').getContext('2d')
      measureContext.font = getComputedStyle(element).font
      const measure = (value) => measureContext.measureText(value).width
      if (measure(text) <= width) {
        setShown(text)
        return
      }
      const end = text.slice(-FILE_NAME_END)
      let low = 0
      let high = Math.max(text.length - FILE_NAME_END, 0)
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (measure(`${text.slice(0, middle)}…${end}`) <= width) low = middle
        else high = middle - 1
      }
      setShown(`${text.slice(0, low)}…${end}`)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    // The body font may load after the first measure.
    void document.fonts?.ready.then(fit)
    return () => observer.disconnect()
  }, [text])

  return <span ref={ref} className="block truncate">{shown}</span>
}

export default FileName
