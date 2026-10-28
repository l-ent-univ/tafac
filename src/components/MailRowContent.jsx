import { Icon } from '@iconify/react'
import { getSenderBadgeStyle, getSenderInitial } from './mailSender'
import { getSenderLabel } from './widgetListUtils'

// A mail's row in the mail page's list (MailPage's MailListItem), and in the
// landing's preview of it (LandingShowcasePreviews): the sender's badge and
// name (`sender`, from `person`: the sender, or a sent mail's recipient),
// their domain when it isn't the university's (`senderDomain`), the
// replied/forwarded/flag marks and the time (`timeLabel`); then the subject,
// the thread's size and the unread dot; then the first lines.
function MailRowContent({ message, person, sender, senderDomain = null, timeLabel = '' }) {
  const email = person?.email?.trim() || null
  const subject = message.subject?.trim() || '(Sans objet)'
  const snippet = message.snippet?.trim() || ''
  const unread = Boolean(message.unread)
  const badgeStyle = getSenderBadgeStyle((email || sender).toLowerCase())

  return (
    <>
      <span className="flex items-center justify-between gap-3 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[13px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
            style={badgeStyle ?? undefined}
            aria-hidden="true"
          >
            {getSenderInitial(getSenderLabel(person))}
          </span>
          <span className={`min-w-0 truncate text-[13px] leading-[1.3] font-semibold ${unread ? 'text-text-70' : 'text-text-muted'}`}>{sender}</span>
          {senderDomain ? (
            <span className="-ml-[3px] max-w-[55%] shrink-0 truncate text-[12px] leading-[1.3] font-medium text-text-muted" aria-hidden="true">{senderDomain}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-[6px]">
          {/* Answered or forwarded from here, small and quiet (Zimbra's flags). */}
          {message.forwarded ? <Icon icon="carbon:reply" className="size-3 text-text-muted [transform:scaleX(-1)]" aria-label="Transféré" /> : message.replied ? <Icon icon="carbon:reply" className="size-3 text-text-muted" aria-label="Répondu" /> : null}
          {message.flagged ? <Icon icon="carbon:flag-filled" className="size-3 text-[#f0932b]" aria-label="Drapeau" /> : null}
          <span className={`text-[12px] leading-none tabular-nums font-medium ${unread ? 'text-text-70' : 'text-text-muted'}`}>{timeLabel}</span>
        </span>
      </span>
      <span className="flex items-center gap-[7px] min-w-0">
        <span className={`min-w-0 truncate text-[14px] leading-[1.3] ${unread ? 'font-semibold text-text' : 'font-medium text-text-70'}`}>{subject}</span>
        {/* A thread's size, as Apple Mail's. */}
        {message.count > 1 ? (
          <span className="shrink-0 rounded-full bg-bg-muted px-[6px] text-[11.5px] font-semibold leading-[17px] text-text-muted tabular-nums" aria-label={`${message.count} mails`}>{message.count}</span>
        ) : null}
        {unread ? <span className="mail-unread-dot size-[6px] shrink-0 rounded-full" aria-hidden="true" /> : null}
      </span>
      {snippet ? (
        <span className="line-clamp-2 break-words text-[13px] leading-[1.4] font-normal text-text-muted">{snippet}</span>
      ) : null}
    </>
  )
}

export default MailRowContent
