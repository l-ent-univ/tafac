import { Icon } from '@iconify/react'
import { ABSENCE_STATUS_LABELS } from '../absenceMail'
import { STATUS_STYLES } from '../assiduityDisplay'

// An absence's status as a small tag (« Non justifiée », « Justifiée »,
// « Retard »), in the colours of the « Assiduité » page's pills: on the
// planning's classes, when « Absences » is shown.
function AbsenceTag({ status, className = '' }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.justified
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-body text-[12px] font-semibold leading-none ${style.pill} ${className}`}>
      <Icon icon={style.icon} className="size-[13px]" aria-hidden="true" />
      {ABSENCE_STATUS_LABELS[status]}
    </span>
  )
}

export default AbsenceTag
