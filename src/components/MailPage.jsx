import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { getCachedAppIcons } from '../appIcons'
import { getRecentMail } from '../entApi'
import LoadingDots from './LoadingDots'
import PageEmptyState from './PageEmptyState'
import {
  SHIMMER_CLASSES,
  formatReceivedAt,
  getSenderLabel,
  parseDate,
  readStoredHref,
  storeHref,
} from './widgetListUtils'

const MAIL_REFRESH_MS = 5 * 60 * 1000
// How far below the screen the end of the list starts loading the next page.
const LOAD_MORE_MARGIN = '600px 0px'
// Shared with the "Mails récents" card: the last webmail URL the server gave.
const WEBMAIL_HREF_KEY = 'l-ent:webmail-href'

const fullDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' })

// A plain list: no card, a hairline under each row but the last.
const ROW_CLASSES = 'min-w-0 border-b border-border last:border-b-0'
const ITEM_CLASSES = 'mail-list-item flex flex-col gap-[3px] min-w-0 py-3'

// `more` after `list`, minus the messages already in it (a mail arriving
// between two pages shifts the offsets by one).
function appendMessages(list, more) {
  const ids = new Set(list.map((message) => message.id))
  return [...list, ...more.filter((message) => !ids.has(message.id))]
}

// The sender's first letter, for the square badge before the name.
function getSenderInitial(label) {
  return label.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? '?'
}

// FNV-1a, like the server's pick of the app tiles' colours.
function hashString(value) {
  let hash = 0x811c9dc5
  for (const char of String(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

// The badge takes a hue of the app tiles' palette (the university's colour
// mode, light and dark), the same one for every mail of a sender. No palette
// cached yet (apps never loaded): a neutral badge.
function getSenderBadgeStyle(key) {
  const { palette } = getCachedAppIcons()
  const hues = Object.keys(palette)
  const colors = hues.length ? palette[hues[hashString(key) % hues.length]] : null
  if (!colors?.light || !colors?.dark) return null
  return {
    '--app-tile-bg': colors.light.bg,
    '--app-tile-fg': colors.light.fg,
    '--app-tile-bg-dark': colors.dark.bg,
    '--app-tile-fg-dark': colors.dark.fg,
  }
}

function MailListPlaceholder() {
  return (
    <ul className="m-0 p-0 list-none grid" role="status" aria-label="Chargement des mails">
      {['w-[34%]', 'w-[26%]', 'w-[40%]', 'w-[30%]'].map((senderWidth) => (
        <li key={senderWidth} className={`${ROW_CLASSES} ${ITEM_CLASSES}`} aria-hidden="true">
          <span className="flex items-center gap-2 h-6">
            <span className={`text-placeholder-shimmer size-6 rounded-[6px] ${SHIMMER_CLASSES}`} />
            <span className={`text-placeholder-shimmer h-2.5 rounded-full ${senderWidth} ${SHIMMER_CLASSES}`} />
          </span>
          <span className={`text-placeholder-shimmer mt-1 h-2.5 w-[58%] rounded-full ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer mt-1 h-2 w-[86%] rounded-full ${SHIMMER_CLASSES}`} />
        </li>
      ))}
    </ul>
  )
}

// One message, after the Ping list item: sender badge, name, address and
// time; the subject with the unread dot; two lines of preview.
function MailListItem({ message, fallbackHref, now }) {
  const href = message.href || fallbackHref
  const sender = getSenderLabel(message.from)
  const email = message.from?.email?.trim() || null
  const subject = message.subject?.trim() || '(Sans objet)'
  const snippet = message.snippet?.trim() || ''
  const receivedAt = parseDate(message.receivedAt)
  const timeLabel = formatReceivedAt(receivedAt, now)
  const unread = Boolean(message.unread)
  const ariaLabel = `${unread ? 'Non lu, ' : ''}${sender} : ${subject}${timeLabel ? `, ${timeLabel}` : ''}`
  const badgeStyle = getSenderBadgeStyle((email || sender).toLowerCase())

  const content = (
    <>
      <span className="flex items-center justify-between gap-3 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[13px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
            style={badgeStyle ?? undefined}
            aria-hidden="true"
          >
            {getSenderInitial(sender)}
          </span>
          <span className="flex items-baseline gap-[5px] min-w-0">
            <span className={`shrink-0 max-w-[70%] truncate text-[13px] leading-[1.3] font-semibold ${unread ? 'text-text-70' : 'text-text-muted'}`}>{sender}</span>
            {email && email !== sender ? (
              <span className="min-w-0 truncate text-[13px] leading-[1.3] font-medium text-text-30 max-xs:hidden">{email}</span>
            ) : null}
          </span>
        </span>
        <span className={`shrink-0 text-[12px] leading-none tabular-nums font-medium ${unread ? 'text-text-70' : 'text-text-muted'}`}>{timeLabel}</span>
      </span>
      <span className="flex items-center gap-[7px] min-w-0">
        <span className={`min-w-0 truncate text-[14px] leading-[1.3] ${unread ? 'font-semibold text-text' : 'font-medium text-text-70'}`}>{subject}</span>
        {unread ? <span className="mail-unread-dot size-[6px] shrink-0 rounded-full" aria-hidden="true" /> : null}
      </span>
      {snippet ? (
        <span className="line-clamp-2 break-words text-[13px] leading-[1.4] font-normal text-text-muted">{snippet}</span>
      ) : null}
    </>
  )

  if (!href) {
    return <li className={`${ROW_CLASSES} ${ITEM_CLASSES}`} aria-label={ariaLabel}>{content}</li>
  }

  return (
    <li className={ROW_CLASSES}>
      {/* The hover tint bleeds into the page's side padding. */}
      <a
        className={`${ITEM_CLASSES} -mx-3 px-3 no-underline text-inherit transition-[background-color] duration-[120ms] ease-in-out hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        title={receivedAt ? `${sender} — ${subject}\n${fullDateFormatter.format(receivedAt)}` : `${sender} — ${subject}`}
      >
        {content}
      </a>
    </li>
  )
}

// The in-app mail page (the « Messagerie » tab, « Mail » in the tab bar): the
// inbox as an endless list, newest first, each message opening the webmail.
// Older pages load as the end of the list nears the screen.
function MailPage() {
  // nextOffset: where the next page starts on the server.
  const [state, setState] = useState({ status: 'loading', unreadCount: null, webmailHref: null, messages: [], hasMore: false, nextOffset: 0 })
  const [moreStatus, setMoreStatus] = useState('idle')
  const [storedWebmailHref, setStoredWebmailHref] = useState(() => readStoredHref(WEBMAIL_HREF_KEY))
  const [now, setNow] = useState(() => new Date())
  const lastLoadAtRef = useRef(0)
  const loadingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const listEndRef = useRef(null)

  const loadMail = useCallback(async ({ background = false } = {}) => {
    if (loadingRef.current) return
    loadingRef.current = true

    try {
      const result = await getRecentMail()
      lastLoadAtRef.current = Date.now()
      setNow(new Date())
      if (result.webmailHref) {
        storeHref(WEBMAIL_HREF_KEY, result.webmailHref)
        setStoredWebmailHref(result.webmailHref)
      }
      setState((current) => {
        if (!background || current.status !== 'ok') return { ...result, nextOffset: result.messages.length }
        // Keep the last good list on a failed background refresh.
        if (result.status === 'error') return current
        // The fresh first page, then the older pages already loaded.
        if (result.status === 'ok' && current.nextOffset > result.messages.length) {
          return { ...result, messages: appendMessages(result.messages, current.messages), hasMore: current.hasMore, nextOffset: current.nextOffset }
        }
        return { ...result, nextOffset: result.messages.length }
      })
    } finally {
      loadingRef.current = false
    }
  }, [])

  const { status, hasMore, nextOffset } = state
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || status !== 'ok' || !hasMore) return
    loadingMoreRef.current = true
    setMoreStatus('loading')

    try {
      const result = await getRecentMail({ offset: nextOffset })
      if (result.status !== 'ok') {
        setMoreStatus('error')
        return
      }
      setState((current) => (current.status === 'ok' && current.nextOffset === nextOffset
        ? {
            ...current,
            messages: appendMessages(current.messages, result.messages),
            // An empty page ends the list, whatever the server says.
            hasMore: result.hasMore && result.messages.length > 0,
            nextOffset: nextOffset + result.messages.length,
          }
        : current))
      setMoreStatus('idle')
    } finally {
      loadingMoreRef.current = false
    }
  }, [status, hasMore, nextOffset])

  // Watched again after each page: if the end of the list is still in
  // reach (a tall screen), the next page follows right away.
  useEffect(() => {
    const listEnd = listEndRef.current
    if (!listEnd || moreStatus !== 'idle') return undefined

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore()
    }, { rootMargin: LOAD_MORE_MARGIN })
    observer.observe(listEnd)
    return () => observer.disconnect()
  }, [loadMore, moreStatus])

  useEffect(() => {
    void loadMail()
  }, [loadMail])

  useEffect(() => {
    if (state.status === 'loading') return undefined

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
  }, [loadMail, state.status])

  const webmailHref = state.webmailHref || storedWebmailHref
  const unreadCount = state.status === 'ok'
    ? (state.unreadCount ?? state.messages.filter((message) => message.unread).length)
    : 0

  return (
    <section className="w-full grid gap-4 pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-5 max-md:pb-5" aria-labelledby="mail-page-title" aria-busy={state.status === 'loading' || undefined}>
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 id="mail-page-title" className="m-0 leading-[1.15] text-2xl font-bold max-md:flex max-md:min-h-10 max-md:items-center max-md:text-[26px] max-md:tracking-[-0.01em]">Messagerie</h1>
          {unreadCount > 0 ? (
            <span className="mail-unread-pill mail-unread-pill--raised inline-flex items-center justify-center min-w-[22px] h-[22px] px-[6px] rounded-full text-[12px] font-semibold leading-none tabular-nums shrink-0" aria-label={`${unreadCount} non lu${unreadCount > 1 ? 's' : ''}`}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </div>
        {webmailHref ? (
          <a
            className="inline-flex shrink-0 items-center gap-[6px] px-3 py-2 border border-white dark:border-[rgba(255,255,255,0.08)] rounded-full bg-widget-bg text-text-secondary text-[14px] font-medium leading-none no-underline transition-[background-color] duration-120 ease-in-out hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-text"
            href={webmailHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ouvrir le webmail
            <Icon icon="carbon:arrow-up-right" className="size-[14px] shrink-0" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {state.status === 'loading' ? <MailListPlaceholder /> : null}

      {state.status === 'ok' && state.messages.length > 0 ? (
        <div className="grid min-w-0">
          <ul className="m-0 p-0 list-none grid" aria-label="Boîte de réception">
            {state.messages.map((message, index) => (
              <MailListItem key={message.id ?? index} message={message} fallbackHref={webmailHref} now={now} />
            ))}
          </ul>
          {state.hasMore ? (
            <div ref={listEndRef} className="flex min-h-14 items-center justify-center gap-3 border-t border-border py-4 text-text-muted">
              {moreStatus === 'error' ? (
                <>
                  <span className="text-[13px] font-medium">Les mails plus anciens n’ont pas chargé</span>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center px-3 py-2 border border-white dark:border-[rgba(255,255,255,0.08)] rounded-full bg-widget-bg text-text-secondary text-[13px] font-medium leading-none cursor-pointer transition-[background-color] duration-120 ease-in-out hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-text"
                    onClick={() => setMoreStatus('idle')}
                  >
                    Réessayer
                  </button>
                </>
              ) : (
                <LoadingDots label="Chargement des mails plus anciens" />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {state.status === 'ok' && state.messages.length === 0 ? (
        <PageEmptyState icon="carbon:checkmark-outline" title="Aucun mail">Ta boîte de réception est vide</PageEmptyState>
      ) : null}

      {state.status === 'error' || state.status === 'unauthenticated' || state.status === 'disabled' ? (
        <PageEmptyState icon="carbon:email" title="Mails indisponibles">La messagerie ne répond pas, réessaie dans un moment</PageEmptyState>
      ) : null}
    </section>
  )
}

export default MailPage
