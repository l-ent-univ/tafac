import { Icon } from '@iconify/react'
import { SECONDARY_BUTTON } from '../scodocPageUtils'
import { usePlanningExport } from '../usePlanningExport'
import LoadingDots from './LoadingDots'
import Tooltip from './Tooltip'

const NOTICES = {
  empty: { short: 'Aucun cours', long: 'Aucun cours à exporter', role: 'status' },
  error: { short: 'Export indisponible', long: 'Export indisponible pour le moment', role: 'alert' },
}

// The header's export (usePlanningExport): dots while it's asked; a short
// notice under it when there's nothing, or it fails. A round icon button
// as the app's others, its name in a tooltip on a wide screen (on a phone
// its touch area 44px). None without a group; `className` places it in the header row; `from`: where it is, for
// the analytics (usePlanningExport).
function PlanningExportButton({ selection, from = 'header', className = '' }) {
  const { state, run } = usePlanningExport(selection, { from })

  if (!selection) return null

  const notice = NOTICES[state]
  const isLoading = state === 'loading'
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={isLoading}
        aria-busy={isLoading || undefined}
        aria-label="Exporter vers un agenda (.ics)"
        className={`${SECONDARY_BUTTON} group relative size-[42px] cursor-pointer justify-center p-0! disabled:cursor-wait max-md:size-10 max-md:shadow-xs max-md:after:absolute max-md:after:-inset-[3px]`}
      >
        {isLoading
          ? <LoadingDots label={null} className="w-4" />
          : <Icon icon="ph:calendar-plus" className="size-4 shrink-0 max-md:size-[18px]" aria-hidden="true" />}
        {notice ? null : <Tooltip title="Exporter vers un agenda (.ics)" side="bottom-end" className="max-4xl:hidden" />}
      </button>
      {/* Under the button, not beside it: nothing in the row moves. */}
      {notice ? (
        <span
          className="absolute top-full right-0 z-10 mt-2 whitespace-nowrap rounded-full border border-border bg-widget-bg px-3 py-2 font-body text-[13px] font-medium leading-none text-text-secondary shadow-md"
          role={notice.role}
        >
          <span className="md:hidden">{notice.short}</span>
          <span className="max-md:hidden">{notice.long}</span>
        </span>
      ) : null}
    </span>
  )
}

export default PlanningExportButton
