import { Icon } from '@iconify/react'
import { SECONDARY_BUTTON } from '../scodocPageUtils'
import { usePlanningExport } from '../usePlanningExport'
import LoadingDots from './LoadingDots'

const NOTICES = {
  empty: { short: 'Aucun cours', long: 'Aucun cours à exporter', role: 'status' },
  error: { short: 'Export indisponible', long: 'Export indisponible pour le moment', role: 'alert' },
}

// The header's export (usePlanningExport): dots while it's asked; a short
// notice under it when there's nothing, or it fails. On a phone a round
// icon button like the view one (its touch area 44px). On a wide screen
// round too, "Exporter" sliding out on hover or focus. None without a
// group; `className` places it in the header row; `from`: where it is, for
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
        aria-label="Exporter le planning (.ics)"
        title="Exporter vers un agenda (.ics)"
        className={`${SECONDARY_BUTTON} group relative h-[42px] cursor-pointer justify-center gap-0! px-3! py-0! disabled:cursor-wait max-md:size-10 max-md:p-0 max-md:shadow-xs max-md:after:absolute max-md:after:-inset-[3px]`}
      >
        {isLoading
          ? <LoadingDots label={null} className="w-4" />
          : <Icon icon="ph:calendar-plus" className="size-4 shrink-0 max-md:size-[18px]" aria-hidden="true" />}
        {/* Round at rest; its word slides out beside the icon under the
            pointer or the keyboard's focus (a phone keeps the icon). */}
        <span className="planning-export-label max-md:hidden" aria-hidden="true">Exporter</span>
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
