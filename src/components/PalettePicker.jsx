import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PALETTES, TINT_MAX, TINT_MIN, applyPalette, contrastOf, paletteAt, paletteColors, withContrast } from '../theme'

// Réglages › Apparence › Couleurs: a pad in Arc's manner. The hue runs
// around it (red at the top, clockwise) and the tint grows from the centre
// to the rim, so one dot picks both; the whole interface follows it as it
// is dragged, and the pick is kept on release. The centre is Sable, the
// default, so the way back is the same gesture. Under the pad, the presets
// (PALETTES): a tap moves the dot onto one.
// `value`: the palette ({ id, hue, tint }); `onChange(palette)` on release
// or on a preset.
//
// The drag never goes through React: pointer moves are coalesced to one
// per frame, and that frame writes the pad's variables (dot position and
// colour), the name and the slider text straight to the DOM, then paints
// the page (applyPalette, live). React renders once, on release, with the
// same values. On a finger the dot sits under it, so a lens above the dot
// shows the colour and its name.

// Inside this share of the radius the dot means Sable; the tints spread
// from there to the rim.
const SAND_RADIUS = 0.16
// The centre is magnetic. Within PULL_RADIUS of it the dot lags the
// pointer more and more, drawn in; under SNAP_IN it clicks onto Sable, and
// it lets go only past SNAP_OUT, so it doesn't flicker on the edge.
// (All in shares of the dot's reach, like SAND_RADIUS.)
const PULL_RADIUS = 0.32
const SNAP_IN = 0.2
const SNAP_OUT = 0.27
const HUE_STEP = 6
const TINT_STEP = 0.1

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// Polar position of a palette on the pad: x to the right, y down, in
// -1..1 of the dot's reach.
function positionOf(palette) {
  if (palette.id === 'sand') return { x: 0, y: 0 }
  const radius = SAND_RADIUS + ((palette.tint - TINT_MIN) / (TINT_MAX - TINT_MIN)) * (1 - SAND_RADIUS)
  const angle = (palette.hue * Math.PI) / 180
  return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius }
}

// The pointer at (x, y) and whether the dot was on Sable: where the dot
// goes. Inside the pull, its distance from the centre eases from the
// pointer's toward 0 (t²(2 − t): level with the pointer at the pull's edge,
// flat at the heart). Outside the snap, it never reaches Sable's ring.
function paletteAtPosition(x, y, snapped = false) {
  const reach = Math.min(1, Math.hypot(x, y))
  if (reach < (snapped ? SNAP_OUT : SNAP_IN)) return PALETTES[0]
  const t = reach / PULL_RADIUS
  const radius = Math.max(SAND_RADIUS, t < 1 ? PULL_RADIUS * t * t * (2 - t) : reach)
  const hue = (Math.atan2(x, -y) * 180) / Math.PI
  const tint = TINT_MIN + ((radius - SAND_RADIUS) / (1 - SAND_RADIUS)) * (TINT_MAX - TINT_MIN)
  return paletteAt(hue, tint)
}

// The line under the name: what the pick is, in words.
function detailOf(palette) {
  if (palette.id === 'sand') return 'Les couleurs d’origine'
  const intensity = Math.round(((palette.tint - TINT_MIN) / (TINT_MAX - TINT_MIN)) * 100)
  return `Teinte ${palette.hue}° · intensité ${intensity} %`
}

function describe(palette) {
  if (palette.id === 'sand') return 'Sable'
  const intensity = Math.round(((palette.tint - TINT_MIN) / (TINT_MAX - TINT_MIN)) * 100)
  return `${palette.label}, teinte ${palette.hue}°, intensité ${intensity} %`
}

// The pad's variables for a palette: where the dot is and what colour it
// shows (in each theme), read by the dot and the lens.
function padStyle(palette) {
  const position = positionOf(palette)
  const colors = paletteColors(palette)
  return {
    '--dot-x': position.x.toFixed(4),
    '--dot-y': position.y.toFixed(4),
    // The lens sits above the dot, below it near the top rim.
    '--lens-side': position.y < -0.55 ? '1' : '-1',
    '--swatch-light': colors.swatch,
    '--swatch-dark': colors.swatchDark,
  }
}

function PalettePicker({ value, onChange }) {
  const padRef = useRef(null)
  const nameRef = useRef(null)
  const detailRef = useRef(null)
  const presetsRef = useRef(null)
  const lensNameRef = useRef(null)
  // The drag in flight: the pointer, the pad's geometry measured once at
  // the start, the latest pointer position and the frame waiting to paint it.
  const drag = useRef(null)
  const [dragging, setDragging] = useState(false)
  // Every pick keeps the contrast set below the pad (PaletteContrast).
  const carry = (palette) => withContrast(palette, contrastOf(value))
  // The last hue, so Sable leaves on the arrow keys toward where it came from.
  const lastHue = useRef(value.hue ?? 245)

  useEffect(() => {
    if (value.id !== 'sand') lastHue.current = value.hue
  }, [value])

  // Writes a palette to the pad without React: the drag's every frame, and
  // the way back to `value` when a drag is cancelled.
  const paint = (palette) => {
    const pad = padRef.current
    for (const [name, text] of Object.entries(padStyle(palette))) pad.style.setProperty(name, text)
    pad.setAttribute('aria-valuenow', String(palette.hue ?? 0))
    pad.setAttribute('aria-valuetext', describe(palette))
    nameRef.current.textContent = palette.label
    detailRef.current.textContent = detailOf(palette)
    lensNameRef.current.textContent = palette.label
    // The preset under the dot, if any, wears the pick's ring as it passes.
    for (const button of presetsRef.current.children) {
      button.toggleAttribute('data-current', button.dataset.palette === palette.id)
    }
  }

  // After React has rendered `value`, the DOM the drag wrote is in step
  // with it again (React only writes what changed since its own last render).
  useLayoutEffect(() => {
    if (!drag.current) paint(value)
  })

  const paletteFromPointer = (clientX, clientY) => {
    const { bounds, reach, palette } = drag.current
    const x = (clientX - bounds.left - bounds.width / 2) / reach
    const y = (clientY - bounds.top - bounds.height / 2) / reach
    return carry(paletteAtPosition(x, y, palette.id === 'sand'))
  }

  // The dot clicking onto the centre (a spring, the ring answering, a tick
  // under a finger) or pulling free of it (a short glide back to the
  // pointer). Straight to the DOM, as the rest of the drag.
  const magnet = (from, to) => {
    const pad = padRef.current
    const state = drag.current
    if ((from.id === 'sand') === (to.id === 'sand')) return
    clearTimeout(state.release)
    if (to.id === 'sand') {
      pad.dataset.magnet = 'in'
      if (pad.dataset.pointer === 'touch') navigator.vibrate?.(8)
    } else {
      pad.dataset.magnet = 'out'
      state.release = setTimeout(() => { delete pad.dataset.magnet }, 180)
    }
  }

  const frame = () => {
    const state = drag.current
    if (!state) return
    state.frame = 0
    const palette = paletteFromPointer(state.clientX, state.clientY)
    magnet(state.palette, palette)
    state.palette = palette
    paint(palette)
    applyPalette(palette, { live: true })
  }

  const schedule = (event) => {
    const state = drag.current
    state.clientX = event.clientX
    state.clientY = event.clientY
    if (!state.frame) state.frame = requestAnimationFrame(frame)
  }

  const endDrag = () => {
    const state = drag.current
    cancelAnimationFrame(state.frame)
    clearTimeout(state.release)
    delete padRef.current.dataset.magnet
    drag.current = null
    setDragging(false)
    return state
  }

  const handlePointerDown = (event) => {
    if (drag.current || (event.button !== 0 && event.pointerType === 'mouse')) return
    const pad = padRef.current
    const bounds = pad.getBoundingClientRect()
    const inset = parseFloat(getComputedStyle(pad).getPropertyValue('--pad-inset')) || 0
    drag.current = {
      pointerId: event.pointerId, bounds, reach: bounds.width / 2 - inset, frame: 0, palette: value,
      clientX: event.clientX, clientY: event.clientY,
    }
    pad.setPointerCapture(event.pointerId)
    pad.dataset.pointer = event.pointerType
    setDragging(true)
    // The first position paints at once: the dot jumps to the finger.
    frame()
  }

  const handlePointerMove = (event) => {
    if (drag.current?.pointerId !== event.pointerId) return
    schedule(event)
  }

  const handlePointerUp = (event) => {
    if (drag.current?.pointerId !== event.pointerId) return
    const picked = paletteFromPointer(event.clientX, event.clientY)
    magnet(drag.current.palette, picked)
    endDrag()
    paint(picked)
    onChange(picked)
  }

  // The browser took the pointer (a scroll, a system gesture): back to the
  // palette held before the drag.
  const handlePointerCancel = (event) => {
    if (drag.current?.pointerId !== event.pointerId) return
    endDrag()
    paint(value)
    applyPalette(value)
  }

  // The arrows: left and right turn the hue (Shift, by a quarter turn's
  // sixth), up and down the tint; under the least tint is Sable.
  const handleKeyDown = (event) => {
    const hueStep = event.shiftKey ? HUE_STEP * 5 : HUE_STEP
    let next = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const direction = event.key === 'ArrowRight' ? 1 : -1
      next = value.id === 'sand'
        ? paletteAt(lastHue.current + direction * hueStep, TINT_MIN)
        : paletteAt(value.hue + direction * hueStep, value.tint)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const direction = event.key === 'ArrowUp' ? 1 : -1
      if (value.id === 'sand') {
        if (direction < 0) return
        next = paletteAt(lastHue.current, TINT_MIN)
      } else {
        const tint = value.tint + direction * TINT_STEP
        next = tint < TINT_MIN - 1e-6 ? PALETTES[0] : paletteAt(value.hue, clamp(tint, TINT_MIN, TINT_MAX))
      }
    } else if (event.key === 'Home') {
      next = PALETTES[0]
    } else {
      return
    }
    event.preventDefault()
    onChange(carry(next))
  }

  return (
    <div className="palette-picker">
      <div
        ref={padRef}
        role="slider"
        tabIndex={0}
        aria-label="Teinte et intensité"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={value.hue ?? 0}
        aria-valuetext={describe(value)}
        className="palette-pad modal-nested-corners"
        style={padStyle(value)}
        data-dragging={dragging ? '' : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
      >
        <span className="palette-pad-centre" aria-hidden="true" />
        <span className="palette-dot" aria-hidden="true" />
        <span className="palette-lens" aria-hidden="true">
          <span className="palette-lens-name" ref={lensNameRef} />
        </span>
      </div>
      <div className="palette-side">
        {/* Written by paint(): the drag changes them every frame, outside
            React. */}
        <div className="palette-current" aria-hidden="true">
          <p className="palette-name" ref={nameRef} />
          <p className="palette-detail" ref={detailRef} />
        </div>
        <div role="radiogroup" aria-label="Palettes" className="palette-presets" ref={presetsRef}>
          {PALETTES.map((entry) => {
            const selected = entry.id === value.id
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={entry.label}
                title={entry.label}
                tabIndex={selected || (value.id === 'custom' && entry.id === 'sand') ? 0 : -1}
                className="palette-preset"
                data-palette={entry.id}
                style={{ '--swatch-light': paletteColors(entry).swatch, '--swatch-dark': paletteColors(entry).swatchDark }}
                onClick={() => onChange(carry(entry))}
                onKeyDown={(event) => {
                  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
                  if (!step) return
                  event.preventDefault()
                  const from = PALETTES.findIndex((item) => item.id === entry.id)
                  const index = (from + step + PALETTES.length) % PALETTES.length
                  onChange(carry(PALETTES[index]))
                  event.currentTarget.parentElement.children[index]?.focus()
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Contrast, Arc's slider: soft to firm, the middle as the palette is
// drawn (tokens.css, --p-contrast). The page follows the thumb live; the
// value is kept when it is let go. A settings row, under the pad.
const CONTRAST_STEP = 0.05

function contrastText(contrast) {
  if (contrast < 0.35) return 'Doux'
  if (contrast > 0.65) return 'Marqué'
  return 'Normal'
}

export function PaletteContrast({ value, onChange, className = '' }) {
  const [draft, setDraft] = useState(null)
  const contrast = draft ?? contrastOf(value)

  const commit = () => {
    if (draft === null) return
    setDraft(null)
    if (draft !== contrastOf(value)) onChange(withContrast(value, draft))
  }

  return (
    <div className={`palette-contrast-row ${className}`}>
      <label htmlFor="palette-contrast" className="palette-contrast-label">Contraste</label>
      <input
        id="palette-contrast"
        type="range"
        className="palette-contrast"
        min={0}
        max={1}
        step={CONTRAST_STEP}
        value={contrast}
        aria-valuetext={contrastText(contrast)}
        style={{ '--contrast-fill': `${contrast * 100}%` }}
        onChange={(event) => {
          const next = Number(event.target.value)
          setDraft(next)
          applyPalette(withContrast(value, next), { live: true })
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  )
}

export default PalettePicker
