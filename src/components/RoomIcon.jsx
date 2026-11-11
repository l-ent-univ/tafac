import { useId } from 'react'
import { roomKind, roomLayout } from '../planningDirectory'
import { directoryTintStyle } from '../directoryTint'

// The icon's units: x across, h up, z into the room. Depth runs up and to
// the right, so the open box shows its front and right walls as glass
// (the room's outline) over its floor, back and left walls, and the room's
// furniture inside.
const DEPTH_X = 0.7
const DEPTH_Y = 0.5
const SIZE = 32
// Room left round the drawing.
const PADDING = 1.5

// The room scaled to fill the icon (its width or its height), centred.
function projector(layout) {
  const spanX = layout.width + DEPTH_X * layout.depth
  const spanY = layout.height + DEPTH_Y * layout.depth
  const scale = Math.min((SIZE - 2 * PADDING) / spanX, (SIZE - 2 * PADDING) / spanY)
  const ox = (SIZE - scale * spanX) / 2
  const oy = (SIZE + scale * spanY) / 2
  return (x, h, z) => [ox + scale * (x + DEPTH_X * z), oy - scale * (h + DEPTH_Y * z)]
}

const points = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')

// A block on the floor (or on another, `base`): its front, right and top
// faces, lit from above.
function Block({ p, x, z, w, d, h, base = 0 }) {
  const top = base + h
  return (
    <g>
      <polygon points={points([p(x, base, z), p(x + w, base, z), p(x + w, top, z), p(x, top, z)])} fill="currentColor" fillOpacity="0.55" />
      <polygon points={points([p(x + w, base, z), p(x + w, base, z + d), p(x + w, top, z + d), p(x + w, top, z)])} fill="currentColor" fillOpacity="0.4" />
      <polygon points={points([p(x, top, z), p(x + w, top, z), p(x + w, top, z + d), p(x, top, z + d)])} fill="currentColor" fillOpacity="0.85" />
    </g>
  )
}

// A flat shape on the back wall (a board, a screen, shelves' backs).
function BackPanel({ p, layout, x, w, h0, h1, opacity = 0.6 }) {
  const z = layout.depth
  return <polygon points={points([p(x, h0, z), p(x + w, h0, z), p(x + w, h1, z), p(x, h1, z)])} fill="currentColor" fillOpacity={opacity} />
}

// A door on the left wall.
function Door({ p, layout }) {
  const z0 = layout.depth * 0.35
  const z1 = z0 + 2
  return <polygon points={points([p(0, 0, z0), p(0, 0, z1), p(0, 4.2, z1), p(0, 4.2, z0)])} fill="currentColor" fillOpacity="0.45" />
}

// Desks in rows and columns, between the walls, from the back to the front
// (drawn back first, so the front ones overlap them).
function deskGrid(layout, { rows, cols, depth = 1.2, margin = 1.2 }) {
  const spanX = layout.width - 2 * margin
  const spanZ = layout.depth - 2 * margin - 0.5
  const cellW = spanX / cols
  const cellZ = spanZ / rows
  const desks = []
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = 0; col < cols; col += 1) {
      desks.push({ x: margin + col * cellW + cellW * 0.15, z: margin + row * cellZ, w: cellW * 0.7, d: Math.min(depth, cellZ * 0.7) })
    }
  }
  return desks
}

// What's in the room, by its kind; how much of it by its layout's variant.
function Furniture({ kind, p, layout }) {
  const { width: W, depth: D, height: H, variant } = layout
  switch (kind) {
    case 'amphi': {
      const rows = 3 + (variant % 2)
      const rowDepth = (D - 2) / rows
      return (
        <>
          {Array.from({ length: rows }, (_, index) => rows - 1 - index).map((row) => (
            <Block key={row} p={p} x={1} z={1.6 + row * rowDepth} w={W - 2} d={rowDepth * 0.8} h={0.9 + row * 1.1} />
          ))}
          <Block p={p} x={W / 2 - 1} z={0.3} w={2} d={0.9} h={1.4} />
        </>
      )
    }
    case 'computer':
      return (
        <>
          <BackPanel p={p} layout={layout} x={W * 0.3} w={W * 0.4} h0={H * 0.45} h1={H * 0.8} opacity={0.35} />
          {deskGrid(layout, { rows: 2, cols: 2 + variant }).map((desk, index) => (
            <g key={index}>
              <Block p={p} {...desk} h={1.5} />
              <Block p={p} x={desk.x + desk.w * 0.2} z={desk.z + desk.d * 0.55} w={desk.w * 0.6} d={0.25} h={1.8} base={1.5} />
            </g>
          ))}
        </>
      )
    case 'meeting':
      return (
        <>
          <BackPanel p={p} layout={layout} x={W * 0.3} w={W * 0.4} h0={H * 0.4} h1={H * 0.75} opacity={0.4} />
          <Block p={p} x={W * 0.22} z={D * 0.3} w={W * 0.56} d={D * (variant === 2 ? 0.45 : 0.35)} h={1.3} />
        </>
      )
    case 'library': {
      const shelves = 3 + (variant % 2)
      const shelfW = (W - 2) / shelves
      return (
        <>
          {Array.from({ length: shelves }, (_, index) => (
            <Block key={index} p={p} x={1 + index * shelfW + 0.2} z={D - 1.4} w={shelfW - 0.4} d={1} h={H * 0.72} />
          ))}
          <Block p={p} x={W * 0.3} z={1.2} w={W * 0.4} d={1.8} h={1.2} />
        </>
      )
    }
    case 'study':
      return (
        <>
          <Block p={p} x={W * 0.55} z={D * 0.5} w={2.6} d={2.2} h={1.2} />
          <Block p={p} x={W * 0.18} z={D * 0.3} w={2.6} d={2.2} h={1.2} />
          {variant > 0 ? <Block p={p} x={W * 0.6} z={1} w={2.2} d={1.6} h={1.2} /> : null}
        </>
      )
    case 'lab':
      return (
        <>
          <Block p={p} x={1.2} z={D * 0.5} w={W - 2.4} d={1.6} h={1.6} />
          <Block p={p} x={1.2} z={1.2} w={variant === 0 ? W - 2.4 : W * 0.45} d={1.6} h={1.6} />
        </>
      )
    case 'studio':
      return (
        <>
          <BackPanel p={p} layout={layout} x={1} w={W - 2} h0={0} h1={H * 0.85} opacity={0.18} />
          <Block p={p} x={W * 0.45} z={D * 0.35} w={1.4} d={1.4} h={3.2} />
        </>
      )
    case 'hall':
      return (
        <>
          <polygon points={points([p(W / 2 - 0.15, 0, 0.6), p(W / 2 + 0.15, 0, 0.6), p(W / 2 + 0.15, 0, D - 0.6), p(W / 2 - 0.15, 0, D - 0.6)])} fill="currentColor" fillOpacity="0.45" />
          <Door p={p} layout={layout} />
        </>
      )
    case 'class':
      return (
        <>
          <BackPanel p={p} layout={layout} x={W * 0.22} w={W * 0.56} h0={H * 0.42} h1={H * 0.8} opacity={0.5} />
          {deskGrid(layout, { rows: 2 + (variant === 2 ? 1 : 0), cols: 3 + (variant === 1 ? 1 : 0) }).map((desk, index) => (
            <Block key={index} p={p} {...desk} h={1.1} />
          ))}
        </>
      )
    default:
      return <Door p={p} layout={layout} />
  }
}

// « Salles et personnels »' room icon: the room as a small glass box (its
// front and right walls outlined, as an architect's model), the inside of
// its kind (roomKind: an amphi's tiers, a classroom's desks and board, a
// computer room's screens…), its own proportions and desks (roomLayout,
// by its id), drawn in a colour of its own from the mail badges' palette
// (mailSender.js; .room-icon), no tile behind it. `entry`: a directory
// room ({ id, name, path }).
function RoomIcon({ entry, className = '' }) {
  const gradientId = useId()
  const layout = roomLayout(entry.id)
  const kind = roomKind(entry)
  const p = projector(layout)
  const { width: W, depth: D, height: H } = layout
  const badgeStyle = directoryTintStyle({ ...entry, kind: 'room' })
  return (
    <span
      className={`inline-flex size-9 shrink-0 items-center justify-center ${badgeStyle ? 'room-icon' : 'text-text-muted'} ${className}`}
      style={badgeStyle ?? undefined}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-9" fill="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.02" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.14" />
          </linearGradient>
        </defs>
        {/* Inside: the floor, the left and back walls. */}
        <polygon points={points([p(0, 0, 0), p(W, 0, 0), p(W, 0, D), p(0, 0, D)])} fill="currentColor" fillOpacity="0.16" />
        <polygon points={points([p(0, 0, 0), p(0, 0, D), p(0, H, D), p(0, H, 0)])} fill="currentColor" fillOpacity="0.08" />
        <polygon points={points([p(0, 0, D), p(W, 0, D), p(W, H, D), p(0, H, D)])} fill="currentColor" fillOpacity="0.12" />
        <Furniture kind={kind} p={p} layout={layout} />
        {/* The glass: the front and right walls, their edges. */}
        <polygon points={points([p(0, 0, 0), p(W, 0, 0), p(W, H, 0), p(0, H, 0)])} fill={`url(#${gradientId})`} />
        <polygon points={points([p(W, 0, 0), p(W, 0, D), p(W, H, D), p(W, H, 0)])} fill={`url(#${gradientId})`} />
        <polyline points={points([p(0, H, D), p(W, H, D), p(W, H, 0)])} stroke="currentColor" strokeOpacity="0.3" strokeWidth="0.6" strokeLinejoin="round" />
        <polyline points={points([p(0, H, 0), p(0, H, D)])} stroke="currentColor" strokeOpacity="0.3" strokeWidth="0.6" />
        <polygon points={points([p(0, 0, 0), p(W, 0, 0), p(W, H, 0), p(0, H, 0)])} stroke="currentColor" strokeOpacity="0.75" strokeWidth="0.9" strokeLinejoin="round" />
        <polygon points={points([p(W, 0, 0), p(W, 0, D), p(W, H, D), p(W, H, 0)])} stroke="currentColor" strokeOpacity="0.75" strokeWidth="0.9" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export default RoomIcon
