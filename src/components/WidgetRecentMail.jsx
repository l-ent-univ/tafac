import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { useWidgetLoadReport } from '../analytics'
import { publishBriefingSource } from '../briefingSources'
import { getRecentMail } from '../entApi'
import { addressMenuItems } from '../contextMenuItems'
import { copyToClipboard, useContextMenu } from '../useContextMenu'
import WidgetListStatus from './WidgetListStatus'
import { getSenderBadgeStyle, getSenderDomainCue, getSenderInitial } from './mailSender'
import {
  SHIMMER_CLASSES,
  formatReceivedAt,
  getSenderLabel,
  openInNewTab,
  parseDate,
  readStoredHref,
  storeHref,
} from './widgetListUtils'

const MAX_VISIBLE_MESSAGES = 2
const MAIL_REFRESH_MS = 5 * 60 * 1000
// Last webmail URL the server gave us, so the card stays clickable when a
// later refresh fails (error payloads carry no webmailHref).
const WEBMAIL_HREF_KEY = 'l-ent:webmail-href'

// Phones: 44px rows (touch targets), hence the taller card there.
const CARD_CLASSES = 'recent-mail-widget widget-card shadow-md flex-[0_1_360px] h-[140px] p-4 border border-white card-corners overflow-hidden bg-widget-bg text-base leading-6 min-w-0 max-2xl:flex-[1_1_calc(50%-6px)] max-2xl:min-w-0 max-md:h-[124px] max-md:p-3 max-xs:flex-[1_1_100%] max-xs:h-[140px] relative flex flex-col gap-[6px] text-text'
// As the mail page's rows (MailListItem), on two lines to fit the card: the
// sender's badge spanning both, their name (and domain, from outside the
// university), the replied/forwarded/flag marks and the time; then the
// subject, the thread's size and the unread dot.
const ROW_CLASSES = 'grid grid-cols-[20px_minmax(0,1fr)_auto] content-center items-center gap-x-[8px] gap-y-[3px] h-[40px] px-1.5 corners-[10px] min-w-0 max-md:h-[38px] max-xs:h-11'

const fullDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' })

// Outcome of the first load, for anonymous analytics (widget_loaded).
function getLoadOutcome(state) {
  if (state.status === 'ok') return { status: state.messages.length > 0 ? 'ok' : 'empty' }
  if (state.status === 'error') return { status: 'error', errorKind: state.errorKind }
  if (state.status === 'unauthenticated') return { status: 'error', errorKind: 'other' }
  return null
}

function MailHeader({ unreadCount = 0 }) {
  return (
    <div className="flex items-center gap-[5px] min-w-0 pr-5">
      <span className="m-0 min-w-0 leading-[1.06] text-base font-medium text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[15px]">Mails récents</span>
      {unreadCount > 0 ? (
        <span className="mail-unread-pill ml-[3px] inline-flex items-center justify-center min-w-[18px] h-[18px] px-[6px] rounded-full text-[11px] font-semibold leading-none tabular-nums shrink-0" aria-label={`${unreadCount} non lu${unreadCount > 1 ? 's' : ''}`}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </div>
  )
}

function MailRowsPlaceholder() {
  return (
    <div className="flex-1 flex flex-col gap-1 -mx-1.5" role="status" aria-label="Chargement des mails">
      {[['w-[38%]', 'w-[78%]'], ['w-[30%]', 'w-[64%]']].map(([senderWidth, subjectWidth]) => (
        <div key={senderWidth} className={ROW_CLASSES} aria-hidden="true">
          <span className={`text-placeholder-shimmer row-span-2 block size-5 rounded-[6px] ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer block h-2.5 rounded-full ${senderWidth} ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer block h-2.5 w-8 rounded-full ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer block h-2 rounded-full col-span-2 ${subjectWidth} ${SHIMMER_CLASSES}`} />
        </div>
      ))}
    </div>
  )
}

// `onOpen(id)`: the mail opened in the app's mail page; without it (no
// in-app page), the row links to the webmail.
function MailRow({ message, fallbackHref, now, onOpen = null }) {
  const href = message.href || fallbackHref
  const sender = getSenderLabel(message.from)
  const email = message.from?.email?.trim() || null
  // A sender outside the university's domains: their domain after the name
  // (mailSender.js), as the mail page shows it.
  const senderDomain = getSenderDomainCue(message.from)
  const subject = message.subject?.trim() || '(Sans objet)'
  const receivedAt = parseDate(message.receivedAt)
  const timeLabel = formatReceivedAt(receivedAt, now)
  const unread = Boolean(message.unread)
  const badgeStyle = getSenderBadgeStyle((email || sender).toLowerCase())
  const ariaLabel = `${unread ? 'Non lu, ' : ''}${sender}${senderDomain ? ` ${senderDomain}` : ''} : ${subject}${timeLabel ? `, ${timeLabel}` : ''}`
  const content = (
    <>
      <span
        className={`row-span-2 inline-flex size-5 items-center justify-center rounded-[6px] text-[11.5px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
        style={badgeStyle ?? undefined}
        aria-hidden="true"
      >
        {getSenderInitial(sender)}
      </span>
      <span className="flex min-w-0 items-baseline gap-[5px]">
        <span className={`min-w-0 truncate text-[13px] leading-[1.15] font-semibold ${unread ? 'text-text-70' : 'text-text-muted'}`}>{sender}</span>
        {senderDomain ? <span className="max-w-[55%] shrink-0 truncate text-[11.5px] leading-[1.15] font-medium text-text-muted" aria-hidden="true">{senderDomain}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-[5px]">
        {message.forwarded ? <Icon icon="carbon:reply" className="size-3 text-text-muted [transform:scaleX(-1)]" aria-label="Transféré" /> : message.replied ? <Icon icon="carbon:reply" className="size-3 text-text-muted" aria-label="Répondu" /> : null}
        {message.flagged ? <Icon icon="carbon:flag-filled" className="size-3 text-[#f0932b]" aria-label="Drapeau" /> : null}
        <span className={`text-[12px] leading-none tabular-nums font-medium whitespace-nowrap ${unread ? 'text-text-70' : 'text-text-muted'}`}>{timeLabel}</span>
      </span>
      <span className="col-start-2 col-span-2 flex min-w-0 items-center gap-[6px]">
        <span className={`min-w-0 truncate text-[14px] leading-[1.15] max-md:text-[13.5px] ${unread ? 'font-semibold text-text' : 'font-medium text-text-70'}`}>{subject}</span>
        {message.count > 1 ? (
          <span className="shrink-0 rounded-full bg-bg-muted px-[5px] text-[10.5px] font-semibold leading-[15px] text-text-muted tabular-nums" aria-label={`${message.count} mails`}>{message.count}</span>
        ) : null}
        {unread ? <span className="mail-unread-dot size-[6px] shrink-0 rounded-full" aria-hidden="true" /> : null}
      </span>
    </>
  )
  const rowClasses = `mail-row ${ROW_CLASSES} w-full border-0 bg-transparent p-0 px-1.5 text-left no-underline text-inherit cursor-pointer transition-[background-color] duration-[120ms] ease-in-out hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text`
  const title = receivedAt ? `${sender} — ${subject}\n${fullDateFormatter.format(receivedAt)}` : `${sender} — ${subject}`
  // Its right-click menu (a long press): the mail opened, its sender's
  // address copied.
  const menuProps = useContextMenu(() => [
    onOpen && message.id
      ? { id: 'open', label: 'Ouvrir', icon: 'carbon:email', onSelect: () => onOpen(message.id) }
      : href ? { id: 'open', label: 'Ouvrir', icon: 'carbon:launch', onSelect: () => openInNewTab(href) } : null,
    'separator',
    ...addressMenuItems(message.from, { copy: copyToClipboard }),
  ])

  if (onOpen && message.id) {
    return (
      <li className="min-w-0">
        <button
          type="button"
          className={rowClasses}
          aria-label={ariaLabel}
          title={title}
          onClick={(event) => {
            event.stopPropagation()
            onOpen(message.id)
          }}
          {...menuProps()}
        >
          {content}
        </button>
      </li>
    )
  }

  if (!href) {
    return <li className={ROW_CLASSES} aria-label={ariaLabel} {...menuProps()}>{content}</li>
  }

  return (
    <li className="min-w-0">
      <a
        className={rowClasses}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        title={title}
        onClick={(event) => event.stopPropagation()}
        {...menuProps()}
      >
        {content}
      </a>
    </li>
  )
}

// `preview`: a getRecentMail() result to show as is (the landing page, which
// changes it): nothing loaded or reported, no link to the webmail.
// `onOpenMail(id)`: the app's mail page, on that mail (`id` null: the page
// itself). Without it (no in-app mail page), the card leads to the webmail
// as before.
function WidgetRecentMail({ visible = false, preview = null, onOpenMail = null }) {
  const [loadedState, setState] = useState({ status: 'loading', unreadCount: null, webmailHref: null, messages: [] })
  const state = preview ?? loadedState
  const [storedWebmailHref, setStoredWebmailHref] = useState(() => readStoredHref(WEBMAIL_HREF_KEY))
  const [now, setNow] = useState(() => new Date())
  const lastLoadAtRef = useRef(0)
  const loadingRef = useRef(false)
  useWidgetLoadReport('mail', preview ? null : getLoadOutcome(state))

  const loadMail = useCallback(async ({ background = false } = {}) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (!background) {
      setState((current) => ({ ...current, status: 'loading' }))
    }

    try {
      const result = await getRecentMail()
      lastLoadAtRef.current = Date.now()
      setNow(new Date())
      if (result.webmailHref) {
        storeHref(WEBMAIL_HREF_KEY, result.webmailHref)
        setStoredWebmailHref(result.webmailHref)
      }
      // Keep the last good list on a failed background refresh.
      setState((current) => (background && result.status === 'error' && current.status === 'ok' ? current : result))
    } finally {
      loadingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!preview) void loadMail()
  }, [loadMail, preview])

  useEffect(() => {
    if (preview || (state.status !== 'ok' && state.status !== 'error')) return undefined

    function refreshIfStale() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastLoadAtRef.current >= MAIL_REFRESH_MS) {
        void loadMail({ background: true })
      }
    }

    const intervalId = window.setInterval(refreshIfStale, MAIL_REFRESH_MS)
    document.addEventListener('visibilitychange', refreshIfStale)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshIfStale)
    }
  }, [loadMail, preview, state.status])

  // Unread count, so the busier of mail and deadlines can go first.
  useEffect(() => {
    publishBriefingSource('mailCount', state.status === 'ok'
      ? (state.unreadCount ?? state.messages.filter((message) => message.unread).length)
      : null)
  }, [state])

  useEffect(() => () => publishBriefingSource('mailCount', null), [])

  // Hidden when the mailbox can't be loaded; the background refresh brings
  // the card back once the webmail answers again.
  if (state.status === 'disabled' || state.status === 'unauthenticated' || state.status === 'error') {
    return null
  }

  const webmailHref = preview ? null : state.webmailHref || storedWebmailHref
  const messages = state.messages.slice(0, MAX_VISIBLE_MESSAGES)
  const unreadCount = state.status === 'ok'
    ? (state.unreadCount ?? state.messages.filter((message) => message.unread).length)
    : 0
  const inApp = !preview && Boolean(onOpenMail)
  const openCard = inApp ? () => onOpenMail(null) : webmailHref ? () => openInNewTab(webmailHref) : null

  return (
    <article
      className={`${CARD_CLASSES} ${openCard ? 'cursor-pointer' : ''} ${visible ? 'widget-card-visible' : ''}`}
      aria-label={unreadCount > 0 ? `Mails récents, ${unreadCount} non lu${unreadCount > 1 ? 's' : ''}` : 'Mails récents'}
      aria-busy={state.status === 'loading' || undefined}
      onClick={openCard ?? undefined}
    >
      {/* In the app the card itself opens the mail page; otherwise its
          corner arrow opens the webmail, in a new tab. */}
      {inApp ? null : webmailHref ? (
        <a
          className="mail-corner-link absolute top-[10px] right-[10px] inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-text no-underline focus-visible:outline-2 focus-visible:outline-text max-md:top-2 max-md:right-2"
          href={webmailHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ouvrir la messagerie"
          title="Ouvrir la messagerie"
          onClick={(event) => event.stopPropagation()}
        >
          <Icon icon="carbon:arrow-up-right" className="w-[14px] h-[14px] shrink-0" aria-hidden="true" />
        </a>
      ) : null}

      <MailHeader unreadCount={unreadCount} />

      {state.status === 'loading' ? <MailRowsPlaceholder /> : null}

      {state.status === 'ok' && messages.length > 0 ? (
        <ul className="flex-1 flex flex-col gap-1 min-h-0 m-0 p-0 list-none -mx-1.5" aria-label="Derniers mails reçus">
          {messages.map((message, index) => (
            <MailRow key={message.id ?? index} message={message} fallbackHref={webmailHref} now={now} onOpen={inApp ? onOpenMail : null} />
          ))}
        </ul>
      ) : null}

      {state.status === 'ok' && messages.length === 0 ? (
        <WidgetListStatus icon="carbon:checkmark-outline" title="Aucun nouveau mail" body="Ta boîte de réception est à jour" />
      ) : null}

    </article>
  )
}

export default WidgetRecentMail
