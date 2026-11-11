import { Icon } from '@iconify/react'
import Tooltip from './Tooltip'
import { NEW_MARK_DIRECTORY, useNewMark } from '../useNewMark'
import { HAS_PLANNING_DIRECTORY } from '../usePlanningDirectory'

// The header's « Salles et personnels »: a segment of the header's button
// group (.button-group, PlanningHeader), its name in a tooltip on a wide
// screen, tinted while its panel is open. `onOpen` toggles its side panel
// (PlanningDirectoryPanel), or opens a phone's sheet
// (PlanningDirectorySheet); `open` while shown; `className` places it in
// the header row.
function PlanningDirectoryButton({ open = false, onOpen = null, className = '' }) {
  // New in this update: a blue dot until the panel is first opened.
  const [isNew, markSeen] = useNewMark(NEW_MARK_DIRECTORY)
  if (!HAS_PLANNING_DIRECTORY) return null
  return (
    <button
      type="button"
      onClick={() => {
        markSeen()
        onOpen?.()
      }}
      aria-label="Salles et personnels"
      aria-expanded={open}
      className={`button-group-item group ${className}`}
    >
      <Icon icon="ph:user-list" className="size-[18px] shrink-0" aria-hidden="true" />
      {isNew ? (
        <>
          <span className="mail-unread-dot mail-unread-dot--on-pill absolute top-[7px] right-[9px] size-[7px] rounded-full ring-2" aria-hidden="true" />
          <span className="sr-only">, nouveau</span>
        </>
      ) : null}
      <Tooltip title="Salles et personnels" side="bottom-end" className="max-4xl:hidden" />
    </button>
  )
}

export default PlanningDirectoryButton
