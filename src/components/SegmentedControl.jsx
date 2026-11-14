import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import SmoothSurface from './SmoothSurface'

// The app's segmented control (.segmented, overrides.css): options side by
// side in a recessed track, the picked one under a raised thumb of the
// app's material that slides to it. The Planning's views, « Salles et
// personnels »' tabs, Réglages' theme, logo and signature.
// `options`: [{ value, label, icon?, ariaLabel?, title? }]; `value`, the
// picked one, `onChange(value)` on another (not the picked one again).
// `label`: the group's name, read out. `kind`: 'radio' (a choice) or
// 'tabs' (a tab list over a tabpanel). `size`: 'md' (34px options, the
// header's 42px row) or 'sm' (30px). `stretch`: options share the width
// (else each its own). The arrow keys, Home and End move the pick.
// In the buttons' textures: the track a well, the thumb a raised knob, both
// on the smooth pill (SmoothSurface, .segmented in overrides.css).
function SegmentedControl({ options, value, onChange, label, kind = 'radio', size = 'md', stretch = true, className = '' }) {
  const trackRef = useRef(null)
  const optionRefs = useRef(new Map())
  const [thumb, setThumb] = useState(null)
  // No slide into place on the first measure: the thumb starts where it is.
  const [ready, setReady] = useState(false)
  const activeIndex = options.findIndex((option) => option.value === value)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const measure = () => {
      const active = optionRefs.current.get(value)
      if (!active) {
        setThumb(null)
        return
      }
      setThumb((current) => {
        const next = { x: active.offsetLeft, w: active.offsetWidth }
        return current && current.x === next.x && current.w === next.w ? current : next
      })
    }
    measure()
    // Fonts landing, the panel resized, a label changing: measured again.
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    for (const element of optionRefs.current.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [value, options])

  useLayoutEffect(() => {
    if (!thumb || ready) return undefined
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [thumb, ready])

  const isTabs = kind === 'tabs'
  const pick = (option) => {
    if (option.value !== value) onChange(option.value)
  }
  const handleKeyDown = (event) => {
    const last = options.length - 1
    const from = activeIndex < 0 ? 0 : activeIndex
    const target = {
      ArrowRight: Math.min(last, from + 1),
      ArrowDown: Math.min(last, from + 1),
      ArrowLeft: Math.max(0, from - 1),
      ArrowUp: Math.max(0, from - 1),
      Home: 0,
      End: last,
    }[event.key]
    if (target === undefined) return
    event.preventDefault()
    const option = options[target]
    pick(option)
    optionRefs.current.get(option.value)?.focus()
  }

  return (
    <div
      ref={trackRef}
      className={`segmented segmented--${size} ${stretch ? 'segmented--stretch' : ''} ${className}`}
      role={isTabs ? 'tablist' : 'radiogroup'}
      aria-label={label}
      data-ready={ready || undefined}
      onKeyDown={handleKeyDown}
      style={thumb ? { '--segmented-x': `${thumb.x}px`, '--segmented-w': `${thumb.w}px` } : undefined}
    >
      <SmoothSurface />
      {thumb ? <span className="segmented-thumb" aria-hidden="true"><SmoothSurface /></span> : null}
      {options.map((option, index) => {
        const isActive = index === activeIndex
        return (
          <button
            key={option.value}
            ref={(element) => {
              if (element) optionRefs.current.set(option.value, element)
              else optionRefs.current.delete(option.value)
            }}
            type="button"
            role={isTabs ? 'tab' : 'radio'}
            aria-selected={isTabs ? isActive : undefined}
            aria-checked={isTabs ? undefined : isActive}
            aria-label={option.ariaLabel}
            title={option.title}
            tabIndex={isActive || (activeIndex < 0 && index === 0) ? 0 : -1}
            data-active={isActive || undefined}
            className="segmented-option"
            onClick={() => pick(option)}
          >
            {option.icon ? <Icon icon={option.icon} className="segmented-icon" aria-hidden="true" /> : null}
            {/* The font on a span: index.css gives buttons `font: inherit`, outside Tailwind's layers. */}
            <span className="segmented-label">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
