import { Icon } from '@iconify/react'
import { STATUS_STYLES } from '../assiduityDisplay'

// What the planning's classes say of an absence, so it reads at a glance:
// « Absent » (red when not justified, soft once it is), « En retard ».
const LABELS = { unjustified: 'Absent', justified: 'Absent', late: 'En retard' }

// An absence's status as a small tag, in the colours of the « Assiduité »
// page's pills: on the planning's classes, when « Absences » is shown.
function AbsenceTag({ status, className = '' }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.justified
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-body text-[12px] font-semibold leading-none ${style.pill} ${className}`}>
      <Icon icon={style.icon} className="size-[13px]" aria-hidden="true" />
      {LABELS[status] ?? LABELS.justified}
    </span>
  )
}

export default AbsenceTag
