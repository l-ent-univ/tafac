// The security section's icons (SecurityShowcase), drawn as cartoon
// stickers: a chunky round ink line, flat fills in the actor's colour, a
// shade where a shadow would fall, a face or a dot where it adds charm. All
// decorative (aria-hidden): the stops and points say it in words.
//
// One box for all (48 × 48, the drawing within 4 px of its edges), so they
// line up at any size. The colour is the element's `currentColor`: the
// fills are tints of it, the ink is `--security-ink` (overrides.css: the
// page's text colour on the big icons, the badge's own colour on a badge),
// so they theme with the page. `strokeWidth`: thicker on the small ones,
// so the line weighs the same on screen.
const INK = 'var(--security-ink, currentColor)'
const TINT = 'color-mix(in srgb, currentColor 30%, transparent)'
const SHADE = 'color-mix(in srgb, currentColor 58%, transparent)'

function Glyph({ className = '', strokeWidth = 3, children }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke={INK}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/* ── The diagram's stops ── */

// The student's phone, a little face on its screen (its eyes blink,
// overrides.css: .security-device-eyes).
export function PhoneIcon(props) {
  return (
    <Glyph {...props}>
      <g transform="rotate(-5 24 24)">
        <rect x="13.5" y="4" width="21" height="40" rx="5.5" fill={TINT} />
        <rect x="17" y="9.5" width="14" height="26" rx="2.5" fill={SHADE} strokeWidth="2" />
        {/* The face: two eyes, a smile. */}
        <g className="security-device-eyes" fill={INK} stroke="none">
          <circle cx="21" cy="19.5" r="1.7" />
          <circle cx="27" cy="19.5" r="1.7" />
        </g>
        <path d="M20.5 25.2c1.8 2 5.2 2 7 0" strokeWidth="2" />
        {/* The home button. */}
        <circle cx="24" cy="40" r="1.4" fill={INK} stroke="none" />
      </g>
    </Glyph>
  )
}

// Tafac's relay: a small server box on legs, an antenna on top, a light on
// each shelf (they glow as something comes through, overrides.css:
// .security-relay-led).
export function RelayIcon(props) {
  return (
    <Glyph {...props}>
      {/* The antenna. */}
      <path d="M33 14v-5.5" />
      <circle cx="33" cy="6" r="2.4" fill="currentColor" />
      {/* The legs. */}
      <path d="M15 42v2.5M33 42v2.5" />
      <rect x="8.5" y="14" width="31" height="28" rx="5" fill={TINT} />
      {/* The shelves' edge: a shade along the bottom. */}
      <path d="M12.5 40.5h23" stroke={SHADE} strokeWidth="2.5" />
      <path d="M8.5 28h31" />
      {/* A light and a slot on each shelf. */}
      <g className="security-relay-led" fill="currentColor" stroke="none">
        <circle cx="16" cy="21" r="2.4" />
        <circle cx="16" cy="35" r="2.4" />
      </g>
      <path d="M23 21h9.5M23 35h9.5" />
    </Glyph>
  )
}

// The university: a pediment on two columns, a door in the middle, a round
// window up top.
export function UniversityIcon(props) {
  return (
    <Glyph {...props}>
      {/* The steps at the bottom. */}
      <rect x="5" y="36" width="38" height="7" rx="2.5" fill={TINT} />
      {/* The columns and the door. */}
      <path d="M12 22v14M36 22v14" strokeWidth="3.5" />
      <path d="M19 36V29a5 5 0 0 1 10 0v7" fill="currentColor" />
      {/* The pediment, a round window in it, and the beam under it. */}
      <path d="M24 4.5 5 17.5h38z" fill={TINT} />
      <rect x="8" y="17.5" width="32" height="4.5" rx="1.5" fill={SHADE} />
      <circle cx="24" cy="12.5" r="2.2" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/* ── What travels: the key, the session card, the padlock, the cookie ── */

// The password, a key.
export function KeyIcon(props) {
  return (
    <Glyph {...props}>
      <g transform="rotate(-28 24 24)">
        <path d="M21 24h20" />
        <path d="M34.5 24v6M40 24v5" />
        <circle cx="13.5" cy="24" r="8" fill={TINT} />
        <circle cx="13.5" cy="24" r="2.3" fill={INK} stroke="none" />
      </g>
    </Glyph>
  )
}

// The session, an ID card: a portrait and two lines.
export function IdCardIcon(props) {
  return (
    <Glyph {...props}>
      <g transform="rotate(-5 24 24)">
        <rect x="5" y="10.5" width="38" height="28" rx="5" fill={TINT} />
        {/* The portrait: a head and shoulders. */}
        <path d="M9.5 33a6 6 0 0 1 12 0" fill={SHADE} />
        <circle cx="15.5" cy="22" r="4" fill={SHADE} />
        <path d="M27 20h10M27 27h7" />
      </g>
    </Glyph>
  )
}

// A padlock, closed.
export function LockIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M17 21v-6a7 7 0 0 1 14 0v6" />
      <rect x="10.5" y="21" width="27" height="21" rx="5.5" fill={TINT} />
      <circle cx="24" cy="30" r="2.4" fill={INK} stroke="none" />
      <path d="M24 32v4" />
    </Glyph>
  )
}

// A padlock, open: its shackle lifted off one side.
export function UnlockedIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M31 21v-7a7 7 0 0 0-14 0v3" />
      <rect x="10.5" y="21" width="27" height="21" rx="5.5" fill={TINT} />
      <circle cx="24" cy="30" r="2.4" fill={INK} stroke="none" />
      <path d="M24 32v4" />
    </Glyph>
  )
}

// A cookie, a bite out of it, chocolate chips (in ink: chocolate).
export function CookieIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M29.5 10A16 16 0 1 0 39 19.5a7 7 0 0 1-9.5-9.5z" fill={TINT} />
      <g fill={INK} stroke="none">
        <circle cx="16.5" cy="20.5" r="2.4" />
        <circle cx="26" cy="31" r="2.4" />
        <circle cx="17.5" cy="32" r="1.9" />
        <circle cx="29" cy="21" r="1.9" />
      </g>
    </Glyph>
  )
}

/* ── The points ── */

// A database, a cylinder.
export function DatabaseIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M9 12v24a15 5.5 0 0 0 30 0V12" fill={TINT} />
      <path d="M9 24a15 5.5 0 0 0 30 0" />
      <ellipse cx="24" cy="12" rx="15" ry="5.5" fill={SHADE} />
    </Glyph>
  )
}

// A bar chart, three bars.
export function ChartIcon(props) {
  return (
    <Glyph {...props}>
      <rect x="6" y="26" width="9" height="17" rx="3" fill={TINT} />
      <rect x="19.5" y="15" width="9" height="28" rx="3" fill={SHADE} />
      <rect x="33" y="6" width="9" height="37" rx="3" fill={TINT} />
    </Glyph>
  )
}

// Code: a window, three dots on its bar, </> inside.
export function CodeIcon(props) {
  return (
    <Glyph {...props}>
      <rect x="4" y="7" width="40" height="34" rx="6" fill={TINT} />
      <path d="M4 17h40" />
      <g fill={INK} stroke="none">
        <circle cx="10.5" cy="12" r="1.6" />
        <circle cx="15.5" cy="12" r="1.6" />
        <circle cx="20.5" cy="12" r="1.6" />
      </g>
      <path d="m16.5 23.5-5.5 5.5 5.5 5.5M31.5 23.5l5.5 5.5-5.5 5.5M26.5 22l-5 14" />
    </Glyph>
  )
}

/* ── The badges' marks ── */

// A check.
export function CheckIcon(props) {
  return (
    <Glyph {...props}>
      <path d="m10 25.5 9 9L38 14" />
    </Glyph>
  )
}

// A cross: not stored.
export function CrossIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M13 13l22 22M35 13 13 35" />
    </Glyph>
  )
}

// An eye, struck through: not watched.
export function EyeOffIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M4.5 24C11 13.5 37 13.5 43.5 24 37 34.5 11 34.5 4.5 24z" fill={TINT} />
      <circle cx="24" cy="24" r="5.5" fill={INK} stroke="none" />
      <path d="M9.5 38.5 38.5 9.5" />
    </Glyph>
  )
}

// A magnifying glass: to look into the code.
export function SearchIcon(props) {
  return (
    <Glyph {...props}>
      <circle cx="19.5" cy="19.5" r="12" fill={TINT} />
      <path d="m29 29 12.5 12.5" />
    </Glyph>
  )
}
