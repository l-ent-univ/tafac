import { Icon } from '@iconify/react'
import Tooltip from './Tooltip'

// The header's « Partager » (PlanningShareSheet): a segment of the
// header's button group (.button-group, PlanningHeader), its name in a
// tooltip on a wide screen. None without a group; `className` places it
// in the header row.
function PlanningShareButton({ selection, onShare, className = '' }) {
  if (!selection || !onShare) return null
  return (
    <button
      type="button"
      onClick={onShare}
      aria-label="Partager le planning de la semaine"
      className={`button-group-item group ${className}`}
    >
      <Icon icon="ph:export" className="size-[18px] shrink-0" aria-hidden="true" />
      <Tooltip title="Partager la semaine" side="bottom-end" className="max-4xl:hidden" />
    </button>
  )
}

export default PlanningShareButton
