// A surface in the app's material, the one of Mes notes' "Simuler" button
// (.material in overrides.css): white like the cards, lifted by a shadow,
// pressed in on a tap. Buttons styled by a class string get it from
// SECONDARY_BUTTON instead.
// `rainbow`: true for the brand's colours, or a list of colours (Simuler:
// the semester's UEs; an empty one falls back to the brand's), washed softly
// up from the bottom edge and drifting. With a mouse, the wash leans towards
// the pointer: its offset from the middle, -1 to 1, as --material-shift (set
// on the element, no re-render). None by default.
// `as`: the element, a button by default.

function followPointer(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const shift = ((event.clientX - rect.left) / rect.width) * 2 - 1
  event.currentTarget.style.setProperty('--material-shift', Math.max(-1, Math.min(1, shift)).toFixed(3))
}

function releasePointer(event) {
  event.currentTarget.style.removeProperty('--material-shift')
}

export default function Material({
  as: Element = 'button',
  rainbow = false,
  className = '',
  style,
  onPointerMove,
  onPointerLeave,
  children,
  ...props
}) {
  const colors = Array.isArray(rainbow) ? rainbow : []
  const wash = colors.length > 0
    ? `linear-gradient(100deg, ${[...colors, colors[0]].join(', ')})`
    : null
  const buttonType = Element === 'button' ? { type: 'button' } : null

  if (!rainbow) {
    return (
      <Element {...buttonType} {...props} className={`material ${className}`} style={style} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
        {children}
      </Element>
    )
  }

  return (
    <Element
      {...buttonType}
      {...props}
      className={`material relative isolate ${className}`}
      style={wash ? { ...style, '--material-wash': wash } : style}
      onPointerMove={(event) => {
        followPointer(event)
        onPointerMove?.(event)
      }}
      onPointerLeave={(event) => {
        releasePointer(event)
        onPointerLeave?.(event)
      }}
    >
      <span className="material-wash-frame rounded-[inherit]" aria-hidden="true">
        <span className="material-wash" />
      </span>
      {children}
    </Element>
  )
}
