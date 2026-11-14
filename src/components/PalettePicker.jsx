import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import {
  INTENSITY_DEFAULT, INTENSITY_ELEVEN, INTENSITY_MAX, INTENSITY_MIN, PALETTES, applyPalette, intensityOf, paletteAt,
  paletteColors, tintOfIntensity,
} from '../theme'

// Réglages › Apparence › Couleurs, in Dia's manner: the pick's name and a
// row of swatches, one per palette (PALETTES, Sable first: the way back to
// the original colours). A tap picks one; the pick wears a
// ring and a pencil, and a tap on it opens a dial under it for the
// intensity: 1 to 10, the presets' at 5, the top. The knob clicks from notch
// to notch after the pointer, the marks light up to it, a small LCD reads
// the number and the whole interface follows; the pick is kept on release.
// Turned past 10 as far as the star, the dial goes to 11.
// `value`: the palette ({ id, hue, tint }); `onChange(palette)` on a swatch,
// on release or on a key.

// The scale: a notch every 22.5°, 0° at the top, clockwise. Its first mark,
// a notch under 1, is the scale's foot: always lit, never a value.
const NOTCH = 22.5
const ANGLE_FOOT = -(INTENSITY_DEFAULT * NOTCH)
const angleOf = (step) => ANGLE_FOOT + step * NOTCH
const ANGLE_MAX = angleOf(INTENSITY_MAX)
const ANGLE_ELEVEN = angleOf(INTENSITY_ELEVEN)
// 11 takes turning the knob nearly onto the star; it lets go halfway back
// to 10, so it doesn't flicker on the edge.
const ELEVEN_IN = ANGLE_ELEVEN - 4
const ELEVEN_OUT = ANGLE_MAX + NOTCH / 2
// The knob never crosses the gap under it: turned past an end, it stays
// there until the pointer comes back the way it went. The pointer is
// followed half a turn past either end, no further.
const OVERTURN = 180
// Closer than this to the knob's centre (px), the pointer's angle means
// nothing.
const DEAD_CENTRE = 6
const MARKS = Array.from({ length: INTENSITY_MAX + 1 }, (_, index) => index)
const DIAL_GAP = 10
const VIEWPORT_EDGE = 12
// The dial's way out (overrides.css, palette-dial-out).
const DIAL_OUT_MS = 140

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// The notch for the knob's angle. `from` is the one it is on: 11 holds on
// differently than it catches.
function stepAt(angle, from) {
  const eleven = angle >= (from === INTENSITY_ELEVEN ? ELEVEN_OUT : ELEVEN_IN)
  if (eleven) return INTENSITY_ELEVEN
  return clamp(Math.round((angle - ANGLE_FOOT) / NOTCH), INTENSITY_MIN, INTENSITY_MAX)
}

// The specks of 11: a burst thrown from the ring, then a few that keep
// drifting off it. Drawn once from a fixed seed, so a render never moves
// them. `tone`: which of the dial's three speck colours (the hue, its
// neighbour, white).
function specks(count, seed, shape) {
  let state = seed
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  return Array.from({ length: count }, () => {
    const speck = shape(random)
    return {
      '--speck-turn': `${Math.round(random() * 360)}deg`,
      '--speck-reach': `${speck.reach.toFixed(1)}px`,
      '--speck-size': `${speck.size.toFixed(1)}px`,
      '--speck-delay': `${Math.round(speck.delay)}ms`,
      '--speck-time': `${Math.round(speck.time)}ms`,
      tone: [0, 0, 0, 0, 1, 1, 1, 2, 2, 2][Math.floor(random() * 10)],
    }
  })
}

const BURST = specks(46, 11, (random) => ({
  reach: 14 + random() * 46, size: 2 + random() * 4, delay: random() * 180, time: 800 + random() * 700,
}))
const DRIFT = specks(22, 1984, (random) => ({
  reach: 10 + random() * 24, size: 2 + random() * 2.5, delay: 300 + random() * 2500, time: 2000 + random() * 2200,
}))

function Specks({ list, drift = false }) {
  return list.map(({ tone, ...style }, index) => (
    <span key={index} className="palette-dial-speck" data-tone={tone} data-drift={drift ? '' : undefined} style={style} />
  ))
}

// A seven-segment digit of the LCD: every segment faint, the digit's dark.
// `digit` null is a blank cell.
const SEGMENTS = {
  a: '1.6,1.5 2.5,0.6 6.5,0.6 7.4,1.5 6.5,2.4 2.5,2.4',
  b: '7.7,1.8 8.6,2.7 8.6,6.8 7.7,7.7 6.8,6.8 6.8,2.7',
  c: '7.7,8.3 8.6,9.2 8.6,13.3 7.7,14.2 6.8,13.3 6.8,9.2',
  d: '1.6,14.5 2.5,13.6 6.5,13.6 7.4,14.5 6.5,15.4 2.5,15.4',
  e: '1.3,8.3 2.2,9.2 2.2,13.3 1.3,14.2 0.4,13.3 0.4,9.2',
  f: '1.3,1.8 2.2,2.7 2.2,6.8 1.3,7.7 0.4,6.8 0.4,2.7',
  g: '1.6,8 2.5,7.1 6.5,7.1 7.4,8 6.5,8.9 2.5,8.9',
}
const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg']

function LcdDigit({ digit }) {
  const lit = digit === null ? '' : DIGITS[digit]
  return (
    <svg className="palette-dial-digit" viewBox="0 0 9 16" aria-hidden="true">
      {Object.entries(SEGMENTS).map(([name, points]) => (
        <polygon key={name} points={points} data-on={lit.includes(name) ? '' : undefined} />
      ))}
    </svg>
  )
}

// The dial, in a portal so the settings card and its scrolling panel never
// clip it: placed under the pick's swatch (`anchorRef`), above it when
// there is no room, centred on it as far as the window allows. `step` is
// the notch shown; a drag reports each notch it crosses (`onTurn`, the page
// follows) and where it ends (`onCommit`), or that it was taken away
// (`onCancel`); a key commits at once. Escape, Tab, a press outside, a
// scroll or a resize closes it (`onClose`).
function IntensityDial({ anchorRef, hue, step, closing, onTurn, onCommit, onCancel, onClose }) {
  const dialRef = useRef(null)
  const knobRef = useRef(null)
  const faceRef = useRef(null)
  // The drag in flight: the pointer, the knob's centre measured at the
  // start, the knob's angle as the pointer has turned it (unwrapped, so it
  // never jumps the gap), the pointer's last angle and the notch it is on.
  const drag = useRef(null)
  const [position, setPosition] = useState(null)
  const [dragging, setDragging] = useState(false)
  // How many times this dial reached 11: the burst plays for each, not for
  // a dial opened already there.
  const [bursts, setBursts] = useState(0)
  const eleven = step === INTENSITY_ELEVEN

  // Placed before paint, once the dial's size is known.
  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect()
    const dial = dialRef.current
    if (!anchor || !dial) return
    const width = dial.offsetWidth
    const height = dial.offsetHeight
    const centre = anchor.left + anchor.width / 2
    const fitsBelow = anchor.bottom + DIAL_GAP + height <= window.innerHeight - VIEWPORT_EDGE
    const opensAbove = !fitsBelow && anchor.top - DIAL_GAP - height >= VIEWPORT_EDGE
    const left = clamp(centre - width / 2, VIEWPORT_EDGE, Math.max(VIEWPORT_EDGE, window.innerWidth - width - VIEWPORT_EDGE))
    setPosition({
      top: opensAbove ? anchor.top - DIAL_GAP - height : anchor.bottom + DIAL_GAP,
      left,
      origin: `${centre - left}px ${opensAbove ? height : 0}px`,
    })
  }, [anchorRef])

  // Focus moves to the knob once the dial is placed: hidden, it can't take it.
  const placed = position !== null
  useEffect(() => {
    if (placed) faceRef.current?.focus({ preventScroll: true })
  }, [placed])

  useEffect(() => {
    const isInside = (target) => dialRef.current?.contains(target) || anchorRef.current?.contains(target)
    const handlePointerDown = (event) => {
      if (!isInside(event.target)) onClose()
    }
    // The dial is fixed: anything moving under it closes it.
    const handleMove = () => onClose()
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('scroll', handleMove, true)
    window.addEventListener('resize', handleMove)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('scroll', handleMove, true)
      window.removeEventListener('resize', handleMove)
    }
  }, [anchorRef, onClose])

  // The pointer's angle around the knob, null too close to its centre.
  const angleAt = (event) => {
    const x = event.clientX - drag.current.x
    const y = event.clientY - drag.current.y
    return Math.hypot(x, y) < DEAD_CENTRE ? null : (Math.atan2(x, -y) * 180) / Math.PI
  }

  // The knob clicks onto the notch under its angle: a tick under a finger,
  // the burst at 11, and the page follows.
  const turn = () => {
    const state = drag.current
    const next = stepAt(state.angle, state.step)
    if (next === state.step) return
    state.step = next
    if (next === INTENSITY_ELEVEN) setBursts((count) => count + 1)
    if (state.touch) navigator.vibrate?.(next === INTENSITY_ELEVEN ? [8, 30, 16] : 5)
    onTurn(next)
  }

  const handlePointerDown = (event) => {
    if (drag.current || closing || (event.button !== 0 && event.pointerType === 'mouse')) return
    const knob = knobRef.current.getBoundingClientRect()
    drag.current = {
      pointerId: event.pointerId, touch: event.pointerType === 'touch',
      x: knob.left + knob.width / 2, y: knob.top + knob.height / 2,
      angle: angleOf(step), last: null, step, from: step,
    }
    // A press on the scale sends the knob there; anywhere else (the knob's
    // centre, the gap under it, the star) it turns from where it is.
    const pressed = angleAt(event)
    if (pressed !== null && pressed >= ANGLE_FOOT - NOTCH / 2 && pressed <= ANGLE_MAX + NOTCH / 2) drag.current.angle = pressed
    drag.current.last = pressed
    faceRef.current.setPointerCapture(event.pointerId)
    setDragging(true)
    turn()
  }

  const handlePointerMove = (event) => {
    const state = drag.current
    if (state?.pointerId !== event.pointerId) return
    const angle = angleAt(event)
    if (angle === null) return
    if (state.last !== null) {
      // The short way round from the last angle, added to the knob's.
      const delta = angle - state.last
      state.angle = clamp(state.angle + delta - Math.round(delta / 360) * 360, ANGLE_FOOT - OVERTURN, ANGLE_ELEVEN + OVERTURN)
    }
    state.last = angle
    turn()
  }

  const endDrag = (event) => {
    const state = drag.current
    if (state?.pointerId !== event.pointerId) return null
    drag.current = null
    setDragging(false)
    return state
  }

  const handlePointerUp = (event) => {
    const state = endDrag(event)
    if (!state) return
    if (state.step === state.from) onCancel()
    else onCommit(state.step)
  }

  // The browser took the pointer (a system gesture): back to the notch held
  // before the drag.
  const handlePointerCancel = (event) => {
    if (endDrag(event)) onCancel()
  }

  // The arrows turn the knob a notch (up from 10 is 11), Home and End go to
  // the ends of the scale.
  const handleKeyDown = (event) => {
    const moves = {
      ArrowUp: step + 1, ArrowRight: step + 1, ArrowDown: step - 1, ArrowLeft: step - 1,
      Home: INTENSITY_MIN, End: INTENSITY_MAX,
    }
    if (!(event.key in moves) || drag.current) return
    event.preventDefault()
    const next = clamp(moves[event.key], INTENSITY_MIN, INTENSITY_ELEVEN)
    if (next === step) return
    if (next === INTENSITY_ELEVEN) setBursts((count) => count + 1)
    onCommit(next)
  }

  // Escape is the dial's before it is the settings' (marked handled). The
  // knob is all there is to focus: Tab leaves, back to the swatch.
  const handleDialKeyDown = (event) => {
    if (event.key !== 'Escape' && event.key !== 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    onClose({ refocus: true })
  }

  // 0 at 1, 1 at 10, eased: the dial's colours deepen late, as the page's do.
  const level = ((Math.min(step, INTENSITY_MAX) - INTENSITY_MIN) / (INTENSITY_MAX - INTENSITY_MIN)) ** 1.5

  return createPortal(
    <div
      ref={dialRef}
      role="dialog"
      aria-label="Intensité de la couleur"
      className="palette-dial"
      data-state={closing ? 'closing' : 'open'}
      data-eleven={eleven ? '' : undefined}
      data-dragging={dragging ? '' : undefined}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: placed ? undefined : 'hidden',
        '--dial-origin': position?.origin,
        '--dial-hue': hue,
        '--dial-level': level.toFixed(3),
        '--dial-turn': `${angleOf(step)}deg`,
      }}
      onKeyDown={handleDialKeyDown}
    >
      <div
        ref={faceRef}
        role="slider"
        tabIndex={0}
        aria-label="Intensité"
        aria-valuemin={INTENSITY_MIN}
        aria-valuemax={INTENSITY_ELEVEN}
        aria-valuenow={step}
        className="palette-dial-face"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
      >
        <span className="palette-dial-haze" />
        {eleven && bursts > 0 ? <span key={bursts} className="palette-dial-cloud" /> : null}
        {MARKS.map((mark) => (
          <span
            key={mark}
            className="palette-dial-mark"
            data-lit={mark <= step ? '' : undefined}
            data-top={mark === INTENSITY_DEFAULT ? '' : undefined}
            style={{ '--mark-turn': `${angleOf(mark)}deg`, '--mark-index': mark }}
          />
        ))}
        <Icon icon="ph:star-fill" className="palette-dial-star" aria-hidden="true" />
        {eleven ? (
          <span className="palette-dial-specks">
            {bursts > 0 ? <Specks key={bursts} list={BURST} /> : null}
            <Specks list={DRIFT} drift />
          </span>
        ) : null}
        <span ref={knobRef} className="palette-dial-ring" />
        <span className="palette-dial-knob">
          <span className="palette-dial-turn" />
        </span>
      </div>
      <span className="palette-dial-lcd" aria-hidden="true">
        <LcdDigit digit={step >= 10 ? Math.floor(step / 10) : null} />
        <LcdDigit digit={step % 10} />
      </span>
    </div>,
    document.body,
  )
}

function PalettePicker({ value, onChange }) {
  const coloured = value.id !== 'sand'
  // The dial: shut, 'open' or 'closing' (still drawn, on its way out).
  const [dial, setDial] = useState(null)
  // The notch under the knob while it is dragged, before the pick is kept.
  const [draft, setDraft] = useState(null)
  const currentRef = useRef(null)
  const closeTimer = useRef(0)
  const step = draft ?? intensityOf(value)

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // A hue kept from before the swatches, which none of them has, gets its
  // own at the end of the row.
  const stray = coloured && !PALETTES.some((entry) => entry.hue === value.hue)
  const swatches = stray
    ? [...PALETTES, { id: 'custom', label: value.label, hue: value.hue, tint: tintOfIntensity(INTENSITY_DEFAULT) }]
    : PALETTES
  const isCurrent = (entry) => (coloured ? entry.hue === value.hue : entry.id === 'sand')

  const paletteOf = (hue, notch) => paletteAt(hue, tintOfIntensity(notch))

  // Another colour keeps the intensity dialled in; from Sable, the middle.
  const pick = (entry) => {
    if (entry.id === 'sand') onChange(PALETTES[0])
    else onChange(paletteOf(entry.hue, coloured ? intensityOf(value) : INTENSITY_DEFAULT))
  }

  const closeDial = ({ refocus = false } = {}) => {
    if (dial !== 'open') return
    // Shut mid-drag: back to the pick as it was.
    if (draft !== null) {
      setDraft(null)
      applyPalette(value)
    }
    setDial('closing')
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setDial(null), DIAL_OUT_MS)
    if (refocus) currentRef.current?.focus()
  }

  const toggleDial = () => {
    if (dial === 'open') {
      closeDial()
      return
    }
    clearTimeout(closeTimer.current)
    setDial('open')
  }

  return (
    <div className="palette-picker">
      <p className="palette-name">{value.label}</p>
      <div role="radiogroup" aria-label="Couleur" className="palette-swatches">
        {swatches.map((entry, index) => {
          const current = isCurrent(entry)
          const dialled = current && entry.id !== 'sand'
          const colors = paletteColors(entry)
          return (
            <button
              key={entry.id}
              ref={current ? currentRef : undefined}
              type="button"
              role="radio"
              aria-checked={current}
              aria-label={dialled ? `${entry.label}, régler l’intensité` : entry.label}
              aria-haspopup={dialled ? 'dialog' : undefined}
              title={dialled ? 'Régler l’intensité' : entry.label}
              tabIndex={current ? 0 : -1}
              className="palette-swatch"
              data-current={current ? '' : undefined}
              style={{ '--swatch-light': colors.swatch, '--swatch-dark': colors.swatchDark }}
              onClick={() => {
                if (!current) pick(entry)
                else if (dialled) toggleDial()
              }}
              onKeyDown={(event) => {
                const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
                if (!move) return
                event.preventDefault()
                const next = (index + move + swatches.length) % swatches.length
                pick(swatches[next])
                event.currentTarget.parentElement.children[next]?.focus()
              }}
            >
              {dialled ? <Icon icon="ph:pencil-simple-fill" className="palette-swatch-edit" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
      {dial && coloured ? (
        <IntensityDial
          anchorRef={currentRef}
          hue={value.hue}
          step={step}
          closing={dial === 'closing'}
          onTurn={(notch) => {
            setDraft(notch)
            applyPalette(paletteOf(value.hue, notch))
          }}
          onCommit={(notch) => {
            setDraft(null)
            onChange(paletteOf(value.hue, notch))
          }}
          onCancel={() => {
            setDraft(null)
            applyPalette(value)
          }}
          onClose={closeDial}
        />
      ) : null}
    </div>
  )
}

export default PalettePicker
