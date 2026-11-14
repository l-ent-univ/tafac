import { Icon } from '@iconify/react'
import { pickInkOn, shadeHex } from '../colorContrast'
import { formatUeCode } from '../gradesSubjects'
import { useUeColor } from '../useUeColor'

// A UE as a link ("Compte aussi dans", "Compte pour"): the UE as a little
// ribbon (its colour, the ribbon's ink, a shadow tinted with its dark shade,
// as on UeBadge), what it says about the subject there (an average, a
// coefficient), then an arrow. Without onClick, the same tag, not a button.
// Text styles sit on spans: index.css gives buttons `font: inherit`.
function UeLink({ code, color, onClick = null, label, title, children }) {
  const fill = useUeColor()(color ?? '#341200')
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick, 'aria-label': label } : {})}
      title={title}
      className={`glass-solid ue-also-link inline-flex max-w-full min-w-0 items-center gap-[7px] rounded-full border p-[3px] text-text ${onClick ? 'pr-[9px] cursor-pointer' : 'pr-[10px]'}`}
    >
      <span
        className="ue-also-tag shrink-0 rounded-full px-[9px] py-[5px] font-display text-[12px] font-semibold leading-none tracking-[0.2px]"
        style={{ background: fill, color: pickInkOn(fill), '--ue-shade': shadeHex(fill, 0.55) }}
      >
        {formatUeCode(code)}
      </span>
      {children}
      {onClick ? <Icon icon="ph:arrow-right" className="ue-also-arrow size-[13px] shrink-0 text-text-muted" aria-hidden="true" /> : null}
    </Tag>
  )
}

export default UeLink
