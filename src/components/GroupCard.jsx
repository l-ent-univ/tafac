import { Icon } from '@iconify/react'

// A card of rows, as the iOS GroupCard: a class's sheet (PlanningEventSheet:
// its details, its occurrences), a mail's attachments (MailReader). Rows
// parted by a hairline from the text's edge (.planning-row in overrides.css).
export const GROUP_CARD_CLASSES = 'widget-card widget-card-visible m-0 list-none overflow-hidden border bg-widget-bg p-1 [--modal-nested-inset:4px] modal-inner-corners'

// A row (in the look of the evaluation rows of Mes notes): an icon box (none
// for the occurrences), a line and a second one. A button with a chevron
// when it leads somewhere, a link (`href`, a launch icon) or a download
// (`download`: the file's name, a download icon); its hover a rounded fill
// inside the card, concentric with it (.modal-nested-corners). `trailing`:
// a word in the chevron's place (« Afficher »). `wrap`: a title that may run
// over several lines (a note, a file's long name). `hint`: the hover's
// tooltip (a shortened title in full). `compact`: tighter, the icon bare
// (no box), as a mail's attachments. `menuProps`: its right-click menu's
// (useContextMenu), on the link or the button. `onClick` on a link
// or a download is only told of the click (the link still goes).
export function GroupRow({ icon, title, detail, onClick, href, download, trailing = null, wrap = false, hint, compact = false, menuProps = null }) {
  const trailingIcon = href ? (download ? 'carbon:download' : 'carbon:launch') : onClick ? 'carbon:chevron-right' : null
  const content = (
    <>
      {icon && compact ? <Icon icon={icon} className="size-[18px] shrink-0 text-text-muted" aria-hidden="true" /> : null}
      {icon && !compact ? (
        <span className="inline-flex size-7 shrink-0 items-center justify-center corners-[8px] bg-brand-subtle text-text-secondary" aria-hidden="true">
          <Icon icon={icon} className="size-[15px]" />
        </span>
      ) : null}
      {/* One column no wider than the row: a long unbroken name wraps. */}
      <span className={`planning-row-text grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-center self-stretch mr-3 ${compact ? 'gap-[3px] py-[9px]' : 'gap-[4px] py-[12px]'}`}>
        <span className={`${wrap ? 'whitespace-pre-line [overflow-wrap:anywhere]' : 'truncate'} font-body ${compact ? 'text-[13.5px]' : 'text-[14px]'} font-semibold leading-[1.2] text-text`}>{title}</span>
        {detail ? <span className={`truncate font-body ${compact ? 'text-[12px]' : 'text-[12.5px]'} font-medium leading-none text-text-muted`}>{detail}</span> : null}
      </span>
      {trailing ? (
        <span className="-ml-1 mr-3 shrink-0 font-body text-[13px] font-semibold leading-none text-text-secondary">{trailing}</span>
      ) : trailingIcon ? (
        <Icon icon={trailingIcon} className="-ml-1 mr-3 size-[14px] shrink-0 text-text-30" aria-hidden="true" />
      ) : null}
    </>
  )
  const className = `planning-row modal-nested-corners flex w-full min-w-0 items-center pl-3 text-left text-text ${compact ? 'min-h-10 gap-[10px]' : 'min-h-11 gap-3'}`
  if (href) {
    return (
      <li>
        <a
          className={`${className} is-link no-underline`}
          href={href}
          title={hint}
          onClick={onClick}
          {...(download ? { download } : { target: '_blank', rel: 'noopener noreferrer' })}
          {...menuProps}
        >
          {content}
        </a>
      </li>
    )
  }
  return onClick
    ? <li><button type="button" className={`${className} is-link cursor-pointer border-0 bg-transparent p-0 pl-3`} title={hint} onClick={onClick} {...menuProps}>{content}</button></li>
    : <li className={className} title={hint}>{content}</li>
}
