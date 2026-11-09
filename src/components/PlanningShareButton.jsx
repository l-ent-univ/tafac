import { Icon } from '@iconify/react'
import { SECONDARY_BUTTON } from '../scodocPageUtils'
import Tooltip from './Tooltip'

// The header's « Partager » (PlanningShareSheet): a round icon button as
// the export beside it, its name in a tooltip on a wide screen (on a phone
// its touch area 44px). None without a group; `className` places it in
// the header row.
function PlanningShareButton({ selection, onShare, className = '' }) {
  if (!selection || !onShare) return null
  return (
    <button
      type="button"
      onClick={onShare}
      aria-label="Partager le planning de la semaine"
      className={`${SECONDARY_BUTTON} group relative size-[42px] shrink-0 cursor-pointer justify-center p-0! max-md:size-10 max-md:shadow-xs max-md:after:absolute max-md:after:-inset-[3px] ${className}`}
    >
      <Icon icon="ph:export" className="size-4 shrink-0 max-md:size-[18px]" aria-hidden="true" />
      <Tooltip title="Partager la semaine" side="bottom-end" className="max-4xl:hidden" />
    </button>
  )
}

export default PlanningShareButton
