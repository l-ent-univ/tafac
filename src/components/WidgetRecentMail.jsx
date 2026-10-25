import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { useWidgetLoadReport } from '../analytics'
import { publishBriefingSource } from '../briefingSources'
import { getRecentMail } from '../entApi'
import WidgetListStatus from './WidgetListStatus'
import {
  SHIMMER_CLASSES,
  calendarDayDiff,
  formatClockTime,
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
const ROW_CLASSES = 'grid grid-cols-[6px_minmax(0,1fr)_auto] content-center items-center gap-x-[7px] gap-y-[3px] h-[38px] px-1.5 rounded-[10px] min-w-0 max-md:h-[36px] max-xs:h-11'

const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const fullDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' })

// Outcome of the first load, for anonymous analytics (widget_loaded).
function getLoadOutcome(state) {
  if (state.status === 'ok') return { status: state.messages.length > 0 ? 'ok' : 'empty' }
  if (state.status === 'error') return { status: 'error', errorKind: state.errorKind }
  if (state.status === 'unauthenticated') return { status: 'error', errorKind: 'other' }
  return null
}

// Mail-client style timestamp, matching the "15h15" notation used by the
// next-class card: "14h32" today, "hier", "lun." this week, "12 sept." older.
function formatReceivedAt(date, now = new Date()) {
  if (!date) return ''
  const dayDiff = -calendarDayDiff(date, now)
  if (dayDiff <= 0) return formatClockTime(date)
  if (dayDiff === 1) return 'hier'
  if (dayDiff < 7) return weekdayFormatter.format(date)
  return dayMonthFormatter.format(date)
}

function getSenderLabel(from) {
  return from?.name?.trim() || from?.email?.trim() || 'Expéditeur inconnu'
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
          <span />
          <span className={`text-placeholder-shimmer block h-2.5 rounded-full ${senderWidth} ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer block h-2.5 w-8 rounded-full ${SHIMMER_CLASSES}`} />
          <span />
          <span className={`text-placeholder-shimmer block h-2 rounded-full col-span-2 ${subjectWidth} ${SHIMMER_CLASSES}`} />
        </div>
      ))}
    </div>
  )
}

function MailRow({ message, fallbackHref, now }) {
  const href = message.href || fallbackHref
  const sender = getSenderLabel(message.from)
  const subject = message.subject?.trim() || '(Sans objet)'
  const receivedAt = parseDate(message.receivedAt)
  const timeLabel = formatReceivedAt(receivedAt, now)
  const unread = Boolean(message.unread)
  const ariaLabel = `${unread ? 'Non lu, ' : ''}${sender} : ${subject}${timeLabel ? `, ${timeLabel}` : ''}`
  const content = (
    <>
      <span className={`mail-unread-dot w-[6px] h-[6px] rounded-full ${unread ? '' : 'invisible'}`} aria-hidden="true" />
      <span className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] leading-[1.06] max-md:text-[14px] ${unread ? 'font-semibold text-text' : 'font-medium text-text-70'}`}>{sender}</span>
      <span className={`text-[12px] leading-none tabular-nums whitespace-nowrap ${unread ? 'font-semibold text-text-70' : 'font-medium text-text-muted'}`}>{timeLabel}</span>
      <span className={`col-start-2 col-span-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[1.06] ${unread ? 'text-text-70' : 'text-text-muted'}`}>{subject}</span>
    </>
  )

  if (!href) {
    return <li className={ROW_CLASSES} aria-label={ariaLabel}>{content}</li>
  }

  return (
    <li className="min-w-0">
      <a
        className={`mail-row ${ROW_CLASSES} no-underline text-inherit transition-[background-color] duration-[120ms] ease-in-out hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        title={receivedAt ? `${sender} — ${subject}\n${fullDateFormatter.format(receivedAt)}` : `${sender} — ${subject}`}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </a>
    </li>
  )
}

// `preview`: a getRecentMail() result to show as is (the landing page, which
// changes it): nothing loaded or reported, no link to the webmail.
function WidgetRecentMail({ visible = false, preview = null }) {
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
  const openWebmail = () => openInNewTab(webmailHref)

  return (
    <article
      className={`${CARD_CLASSES} ${webmailHref ? 'cursor-pointer' : ''} ${visible ? 'widget-card-visible' : ''}`}
      aria-label={unreadCount > 0 ? `Mails récents, ${unreadCount} non lu${unreadCount > 1 ? 's' : ''}` : 'Mails récents'}
      aria-busy={state.status === 'loading' || undefined}
      onClick={webmailHref ? openWebmail : undefined}
    >
      {webmailHref ? (
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
            <MailRow key={message.id ?? index} message={message} fallbackHref={webmailHref} now={now} />
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
