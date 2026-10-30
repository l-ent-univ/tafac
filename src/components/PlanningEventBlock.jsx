import { Icon } from '@iconify/react'
import { accentStyle } from '../eventAccents'
import { layoutEventBlock } from '../eventBlockLayout'
import { durationText, formatTime } from '../planningDates'

// Text widths, measured on a canvas in the cards' body font (Inter: the
// title semibold, the room and the teacher medium, as the block draws
// them), for the block's layout (eventBlockLayout).
const TITLE_WEIGHT = 600
const META_WEIGHT = 500
let context = null
function measureText(text, size, weight) {
  if (typeof document === 'undefined') return text.length * size * 0.55
  if (!context) context = document.createElement('canvas').getContext('2d')
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-body') || 'sans-serif'
  context.font = `${weight} ${size}px ${family}`
  return context.measureText(text).width
}

// Lines the title wraps to at `width`, word by word.
function countLines(text, size, width) {
  if (width <= 0) return 1
  let lines = 1
  let line = 0
  const space = measureText(' ', size, TITLE_WEIGHT)
  for (const word of text.split(/\s+/)) {
    const wordWidth = measureText(word, size, TITLE_WEIGHT)
    if (line && line + space + wordWidth > width) {
      lines += 1
      line = wordWidth
    } else {
      line += (line ? space : 0) + wordWidth
    }
  }
  return lines
}

function MetaLabel({ icon, text, design, style }) {
  return (
    <span className="planning-block-label" style={{ height: design.symbolBox, ...style }}>
      <span className="planning-block-symbol" style={{ width: design.symbolBox, height: design.symbolBox }} aria-hidden="true">
        <Icon icon={icon} style={{ width: design.symbolSize, height: design.symbolSize }} />
      </span>
      <span className="planning-block-label-text" style={{ fontSize: design.metaSize }}>{text}</span>
    </span>
  )
}

// A class on the grid, laid out as the iOS EventBlock and drawn as the
// site's cards: a widget card under the course's wash (as the "Dernières
// notes" cards wear their UEs' colours), its accent bar, the title, and the
// room and the teacher as they fit. No time: the grid tells it. A button
// opening the class's sheet, or the card alone without `onOpen`.
function PlanningEventBlock({ event, accent, variant, stackFirst = false, width, height, style, onOpen, menuProps = null }) {
  const layout = layoutEventBlock({
    width,
    height,
    variant,
    stackFirst,
    titleLines: (infoWidth) => countLines(event.title, variant === 'regular' ? 17 : 15, infoWidth),
    roomWidth: event.location ? measureText(event.location, variant === 'regular' ? 14 : 13, META_WEIGHT) : 0,
    teacherWidth: event.teacher ? measureText(event.teacher, variant === 'regular' ? 14 : 13, META_WEIGHT) : 0,
  })
  const { design } = layout
  const content = (
    <>
      <span className="latest-grade-wash planning-accent-fill" aria-hidden="true" />
      <span
        className="planning-bar planning-accent-fill"
        style={{ left: layout.bar.x, top: layout.bar.y, width: layout.bar.width, height: layout.bar.height }}
        aria-hidden="true"
      />
      <span className="planning-block-info" style={{ left: layout.infoX, top: layout.paddingTop, width: layout.infoWidth }}>
        <span className="planning-block-title" style={{ fontSize: design.titleSize, lineHeight: `${design.titleLine}px`, WebkitLineClamp: layout.titleLines }}>
          {event.title}
        </span>
        {layout.meta ? (
          <span className={`planning-block-meta planning-block-meta--${layout.meta === 'stacked' ? 'stacked' : 'row'}`} style={{ marginTop: design.titleToMeta }}>
            {layout.showRoom ? (
              <MetaLabel icon="ph:map-pin-simple" text={event.location} design={design} style={layout.roomGroupWidth ? { width: layout.roomGroupWidth, flex: 'none' } : null} />
            ) : null}
            {layout.meta === 'row' && layout.showRoom && layout.showTeacher ? (
              <span className="planning-block-divider" style={{ height: design.symbolBox, marginInline: design.metaToDivider }} aria-hidden="true" />
            ) : null}
            {layout.showTeacher ? <MetaLabel icon="ph:user-square" text={event.teacher} design={design} /> : null}
          </span>
        ) : null}
      </span>
    </>
  )
  const card = {
    className: 'planning-block widget-card widget-card-visible isolate border bg-widget-bg text-text',
    style: { width, height, borderRadius: layout.radius, ...accentStyle(accent), ...style },
  }

  // At the top of its sheet: the card alone.
  if (!onOpen) return <div {...card}>{content}</div>

  return (
    <button
      type="button"
      {...card}
      onClick={() => onOpen(event)}
      {...menuProps?.(event.id)}
      aria-label={`${formatTime(event.start)} à ${formatTime(event.end)}, ${event.title}${[event.location, event.teacher].filter(Boolean).map((part) => `, ${part}`).join('')}, ${durationText(event.start, event.end)}`}
    >
      {content}
    </button>
  )
}

export default PlanningEventBlock
