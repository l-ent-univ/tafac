import { Icon } from '@iconify/react'
import { directoryTintStyle } from '../directoryTint'
import { roomLabel } from '../planningDirectory'

const KIND_ICONS = { room: 'ph:door', person: 'ph:user', group: 'ph:users-three' }
const KIND_PREFIXES = { room: 'Planning de la salle ', group: 'Planning du groupe ' }

// The name shown, its kind read out before it.
function ViewedName({ viewed }) {
  const name = viewed.kind === 'room' ? roomLabel(viewed.name) : viewed.name
  return (
    <span className="min-w-0 truncate" title={viewed.name}>
      <span className="sr-only">{KIND_PREFIXES[viewed.kind] ?? 'Planning de '}</span>
      {name}
    </span>
  )
}

// A room's or a person's timetable shown in place of the student's (« Salles
// et personnels »): a frame of their colour (directoryTintStyle) round the
// page, between the sidebar and the side panel (shown only with it), and
// their name on a tab hanging from its top edge, « × » back to the
// student's own. Wide screens only, as the panel. `viewed`: { id, name,
// kind }.
function PlanningViewedFrame({ viewed, onStop }) {
  const tint = directoryTintStyle(viewed)
  return (
    <div
      className={`planning-viewed-frame hidden 4xl:block ${tint ? 'room-icon' : 'text-brand'}`}
      style={tint ?? undefined}
    >
      <div className="planning-viewed-tab" role="status">
        <Icon icon={KIND_ICONS[viewed.kind] ?? 'ph:user'} className="size-[15px] shrink-0" aria-hidden="true" />
        <ViewedName viewed={viewed} />
        <button type="button" className="planning-viewed-close" aria-label="Revenir à mon planning" title="Revenir à mon planning" onClick={onStop}>
          <Icon icon="ph:x-bold" className="size-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

// The same on a phone, where a frame would crowd the screen's edges: a bar
// of their colour under the week strip (it stays on top with it), their
// name in it (a tap opens the sheet again, for another one: `onChange`),
// « × » back to the student's own (`onStop`). The page's top band takes a
// wash of the colour too (.planning-top.is-viewing).
export function PlanningViewedBar({ viewed, onChange, onStop }) {
  const tint = directoryTintStyle(viewed)
  return (
    <div
      className={`planning-viewed-bar mt-3 ${tint ? 'room-icon' : 'text-brand'}`}
      style={tint ?? undefined}
      role="status"
    >
      <button type="button" className="planning-viewed-bar-name" aria-haspopup="dialog" onClick={onChange}>
        <Icon icon={KIND_ICONS[viewed.kind] ?? 'ph:user'} className="size-4 shrink-0" aria-hidden="true" />
        <ViewedName viewed={viewed} />
        <Icon icon="ph:caret-down-bold" className="size-3 shrink-0 opacity-80" aria-hidden="true" />
      </button>
      <button type="button" className="planning-viewed-close planning-viewed-close--bar" aria-label="Revenir à mon planning" onClick={onStop}>
        <Icon icon="ph:x-bold" className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

export default PlanningViewedFrame
