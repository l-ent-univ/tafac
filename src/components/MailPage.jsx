import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { flagMailMessage, getMailMessage, getMailMessages, markMailAsRead, trashMailMessage } from '../entApi'
import { getOfflineCache, setOfflineCache } from '../offlineStorage'
import { MAIL_HREF } from '../navItems'
import { CARD_CLASSES } from '../scodocPageUtils'
import { APP_NAME } from '../seo'
import { AppPage, ICON_ONLY, PageButton } from './AppPage'
import PageGuidedTour from './PageGuidedTour'
import { LoadingDots, SegmentedControl, StatusMessage } from './ScodocUi'
import { takeRequestedMailMessage } from '../mailSelection'
import LinkPreviewCard from './mail/LinkPreviewCard'
import MailComposeModal from './mail/MailComposeModal'
import MailContextMenu from './mail/MailContextMenu'
import MailDirectoryModal from './mail/MailDirectoryModal'
import MailPreferencesModal from './mail/MailPreferencesModal'
import {
  SHIMMER_CLASSES,
  calendarDayDiff,
  formatClockTime,
  parseDate,
} from './widgetListUtils'

const MAIL_TOUR_STEPS = [
  {
    id: 'intro',
    title: 'Bienvenue sur ta messagerie',
    body: 'Consulte tes e-mails universitaires en direct, lis tes messages récents et accède directement à Partage.',
    icon: 'carbon:email',
  },
  {
    id: 'compose',
    target: 'mail-compose-button',
    title: 'Nouveau message',
    body: 'Rédige des e-mails soignés avec un éditeur de texte complet, des styles personnalisés et des modèles prêts à l’emploi.',
    icon: 'carbon:edit',
  },
  {
    id: 'directory',
    target: 'mail-directory-button',
    title: 'Annuaire universitaire',
    body: 'Recherche facilement les adresses de tes enseignants, de la scolarité et des services universitaires.',
    icon: 'carbon:user-multiple',
  },
  {
    id: 'search',
    target: 'mail-search',
    title: 'Recherche et filtres',
    body: 'Recherche par mot-clé, enseignant ou objet, et bascule entre tous les messages et les non lus.',
    icon: 'carbon:search',
  },
  {
    id: 'list',
    target: 'mail-list',
    title: 'Boîte de réception',
    body: 'Parcours tes e-mails avec aperçu du contenu, statut de lecture et date de réception.',
    icon: 'carbon:list-boxes',
  },
  {
    id: 'detail',
    target: 'mail-preview',
    title: 'Panneau de lecture',
    body: 'Lis le corps du message complet, réponds directement, marque-le comme lu/non lu ou ouvre-le dans Partage.',
    icon: 'carbon:view',
  },
]

const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const fullDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full',
  timeStyle: 'short',
})

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

function getInitials(name) {
  if (!name) return '?'
  const clean = name.replace(/[^\p{L}\s]/gu, '').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function getAvatarColor(name) {
  let hash = 0
  for (let i = 0; i < (name || '').length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  // Warm hues, the UE colours' family: senders apart without leaving the DA.
  const hues = [8, 22, 34, 345, 150, 190, 270, 48]
  const hue = hues[Math.abs(hash) % hues.length]
  return `hsl(${hue}, 48%, 42%)`
}

function formatBytes(bytes) {
  if (!bytes || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function useIsDark() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false
    return (
      document.documentElement.dataset.theme === 'dark' ||
      document.documentElement.classList.contains('dark') ||
      (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    )
  })

  useEffect(() => {
    const update = () => {
      setIsDark(
        document.documentElement.dataset.theme === 'dark' ||
        document.documentElement.classList.contains('dark') ||
        (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      )
    }
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })
    const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
    media?.addEventListener?.('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener?.('change', update)
    }
  }, [])

  return isDark
}

function EmailBodyViewer({ html, text }) {
  const iframeRef = useRef(null)
  const [iframeHeight, setIframeHeight] = useState(250)
  const isDark = useIsDark()
  // The hovered (or focused) link's preview: { url, anchor }.
  const [hoveredLink, setHoveredLink] = useState(null)
  const showTimerRef = useRef(null)
  const hideTimerRef = useRef(null)

  const keepPreview = useCallback(() => window.clearTimeout(hideTimerRef.current), [])
  const hidePreview = useCallback(() => {
    window.clearTimeout(showTimerRef.current)
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => setHoveredLink(null), 200)
  }, [])

  // The body's links (in the sandboxed frame: same origin, no scripts): a
  // moment on one shows its preview (LinkPreviewCard).
  const bindLinkPreviews = (doc) => {
    if (doc.tafacLinkPreviews) return
    doc.tafacLinkPreviews = true
    const linkOf = (target) => target?.closest?.('a[href]')
    const show = (link) => {
      window.clearTimeout(hideTimerRef.current)
      window.clearTimeout(showTimerRef.current)
      if (!/^https?:/i.test(link.href)) return
      showTimerRef.current = window.setTimeout(() => {
        const frame = iframeRef.current?.getBoundingClientRect()
        if (!frame) return
        const rect = link.getBoundingClientRect()
        setHoveredLink({ url: link.href, anchor: { left: frame.left + rect.left, top: frame.top + rect.top, bottom: frame.top + rect.bottom } })
      }, 400)
    }
    doc.addEventListener('mouseover', (event) => {
      const link = linkOf(event.target)
      if (link) show(link)
    })
    doc.addEventListener('mouseout', (event) => {
      const link = linkOf(event.target)
      if (link && !link.contains(event.relatedTarget)) hidePreview()
    })
    doc.addEventListener('focusin', (event) => {
      const link = linkOf(event.target)
      if (link) show(link)
    })
    doc.addEventListener('focusout', hidePreview)
  }

  // A moved page leaves the card behind: it goes.
  useEffect(() => {
    if (!hoveredLink) return undefined
    const close = () => setHoveredLink(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [hoveredLink])
  useEffect(() => () => {
    window.clearTimeout(showTimerRef.current)
    window.clearTimeout(hideTimerRef.current)
  }, [])

  const srcDoc = useMemo(() => {
    if (!html) return ''

    const textColor = isDark ? '#f4f4f5' : '#18181b'
    const linkColor = '#f97316'
    const bgColor = isDark ? '#1c1c1c' : '#ffffff'
    const mutedColor = isDark ? '#a1a1aa' : '#52525b'
    const borderColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)'

    const injectedCss = `
      *, *::before, *::after {
        box-sizing: border-box;
      }
      :root {
        color-scheme: ${isDark ? 'dark' : 'light'};
      }
      html, body {
        margin: 0;
        padding: 4px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14.5px;
        line-height: 1.6;
        color: ${textColor} !important;
        background-color: ${bgColor} !important;
        word-break: break-word;
        overflow-wrap: anywhere;
      }

      /* Force 100% visibility for all text regardless of inline styles (signatures, headers, fonts) */
      body, body *:not(a):not(a *):not(code):not(pre) {
        color: ${textColor} !important;
        text-shadow: none !important;
        opacity: 1 !important;
      }

      /* Neutralize any element backgrounds that would obscure text or create blinding blocks */
      body *:not(a):not(button):not(pre):not(code) {
        background-color: transparent !important;
        background: transparent !important;
      }

      /* Clean link styling */
      a, a * {
        color: ${linkColor} !important;
        text-decoration: underline !important;
      }

      /* Buttons (Teams invites, action links) */
      a[style*="background"], a.button, a[class*="btn"], a[class*="button"] {
        display: inline-block !important;
        padding: 6px 14px !important;
        border-radius: 8px !important;
        background-color: ${isDark ? 'rgba(249, 115, 22, 0.15)' : 'rgba(249, 115, 22, 0.1)'} !important;
        border: 1px solid rgba(249, 115, 22, 0.35) !important;
        color: #f97316 !important;
        text-decoration: none !important;
        font-weight: 600 !important;
      }

      /* Images: keep responsive and clean */
      img {
        max-width: 100% !important;
        height: auto !important;
        border-radius: 6px;
      }

      /* Tables: ensure structured, readable borders */
      table {
        max-width: 100% !important;
        border-collapse: collapse !important;
        margin: 8px 0 !important;
      }
      th, td {
        border: 1px solid ${borderColor} !important;
        padding: 6px 10px !important;
      }

      /* Quotes & replies */
      blockquote {
        margin: 12px 0 !important;
        padding-left: 12px !important;
        border-left: 3px solid ${isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.25)'} !important;
      }
      blockquote, blockquote *:not(a):not(a *) {
        color: ${mutedColor} !important;
      }

      /* Horizontal dividers */
      hr {
        border: 0 !important;
        border-top: 1px solid ${borderColor} !important;
        margin: 16px 0 !important;
      }

      /* Code snippets */
      pre, code {
        white-space: pre-wrap !important;
        word-break: break-all !important;
        background-color: ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)'} !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      }
    `

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="${isDark ? 'dark' : 'light'}">
  <base target="_blank">
  <style>${injectedCss}</style>
</head>
<body>
  ${html}
</body>
</html>`
  }, [html, isDark])

  const adjustHeight = () => {
    if (!iframeRef.current) return
    try {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document
      if (doc) {
        bindLinkPreviews(doc)
        const images = doc.querySelectorAll('img')
        images.forEach((img) => {
          img.onerror = () => { img.style.display = 'none'; }
        })
        // Strip legacy presentational attributes that could clash
        doc.querySelectorAll('font[color]').forEach((font) => font.removeAttribute('color'))
        doc.querySelectorAll('[bgcolor]').forEach((el) => el.removeAttribute('bgcolor'))

        const newHeight = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0)
        if (newHeight > 0) {
          setIframeHeight(newHeight + 24)
        }
      }
    } catch {
      // Ignored cross-origin iframe security restrictions
    }
  }

  useEffect(() => {
    adjustHeight()
    const timer = setTimeout(adjustHeight, 350)
    return () => clearTimeout(timer)
  }, [srcDoc])

  if (!html) {
    return (
      <div className="whitespace-pre-wrap break-words font-body text-[14.5px] leading-relaxed text-text">
        {text || '(Aucun contenu texte)'}
      </div>
    )
  }

  return (
    <>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        onLoad={adjustHeight}
        title="Contenu de l'e-mail"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        className="w-full border-0 transition-[height] duration-150 rounded-xl"
        style={{
          height: `${iframeHeight}px`,
          minHeight: '120px',
          backgroundColor: isDark ? '#1c1c1c' : '#ffffff',
          colorScheme: isDark ? 'dark' : 'light',
        }}
      />
      {hoveredLink ? (
        <LinkPreviewCard url={hoveredLink.url} anchor={hoveredLink.anchor} onPointerEnter={keepPreview} onPointerLeave={hidePreview} />
      ) : null}
    </>
  )
}

export default function MailPage() {
  const [tourTrigger, setTourTrigger] = useState(0)
  const [messages, setMessages] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [webmailHref, setWebmailHref] = useState(MAIL_HREF)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  // The webmail's own address when it refused Tafac (403): opened there.
  const [errorServiceHref, setErrorServiceHref] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'unread'
  // Opened on the message another page asked for (mailSelection), if any.
  const [selectedId, setSelectedId] = useState(takeRequestedMailMessage)
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const searchTimeoutRef = useRef(null)

  // Document title
  useEffect(() => {
    const prev = document.title
    document.title = `Messagerie · ${APP_NAME}`
    return () => {
      document.title = prev
    }
  }, [])

  // Load message list - DOES NOT depend on selectedId to avoid full-page reloads on click!
  const loadMessages = useCallback(async (query = '', isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    setErrorServiceHref(null)

    try {
      const result = await getMailMessages({ limit: 40, query })
      if (result.status === 'ok') {
        const list = result.messages || []
        setMessages(list)
        setUnreadCount(result.unreadCount ?? list.filter((m) => m.unread).length)
        if (result.webmailHref) setWebmailHref(result.webmailHref)
        setNow(new Date())

        // Auto-select first message on desktop only if none selected yet
        setSelectedId((current) => {
          if (!current && list.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768) {
            return list[0].id
          }
          return current
        })

        void setOfflineCache('mail:inbox', {
          messages: list,
          unreadCount: result.unreadCount ?? list.filter((m) => m.unread).length,
          webmailHref: result.webmailHref,
        })
      } else if (result.status === 'disabled') {
        setError('La messagerie n’est pas configurée pour cet établissement.')
      } else if (result.status === 'unauthenticated') {
        setError('Session expirée. Veuillez vous reconnecter.')
      } else {
        setError(result.error || 'Erreur lors du chargement des e-mails.')
        setErrorServiceHref(result.serviceHref ?? null)
      }
    } catch (err) {
      const offline = await getOfflineCache('mail:inbox')
      if (offline?.data?.messages?.length) {
        setMessages(offline.data.messages)
        setUnreadCount(offline.data.unreadCount ?? 0)
        if (offline.data.webmailHref) setWebmailHref(offline.data.webmailHref)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  // Debounced search
  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearchQuery(val)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      void loadMessages(val)
    }, 350)
  }

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Load message detail when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setSelectedMessage(null)
      return
    }

    let isMounted = true
    setLoadingDetail(true)

    const listItem = messagesRef.current.find((m) => String(m.id) === String(selectedId))
    if (listItem) {
      // Pre-populate with list data immediately so title/sender don't flicker or show unknown
      setSelectedMessage((prev) => {
        if (prev && String(prev.id) === String(selectedId)) return prev
        return {
          ...listItem,
          bodyText: listItem.snippet || '',
        }
      })
    }

    getMailMessage(selectedId)
      .then((msg) => {
        if (!isMounted) return
        const currentListItem = messagesRef.current.find((m) => String(m.id) === String(selectedId)) || listItem
        const merged = {
          ...currentListItem,
          ...msg,
          from: msg?.from?.name || msg?.from?.email ? msg.from : currentListItem?.from || { name: 'Expéditeur inconnu', email: null },
          subject: msg?.subject || currentListItem?.subject || '(Sans objet)',
          receivedAt: msg?.receivedAt || currentListItem?.receivedAt || null,
          bodyText: msg?.bodyText || msg?.bodyHtml || currentListItem?.snippet || '(Aucun contenu texte)',
        }
        setSelectedMessage(merged)

        // Mark as read in state & server
        if (msg?.unread) {
          void markMailAsRead(selectedId, true)
          setMessages((current) =>
            current.map((m) => (String(m.id) === String(selectedId) ? { ...m, unread: false } : m))
          )
          setUnreadCount((count) => Math.max(0, count - 1))
        }
      })
      .catch(() => {
        if (!isMounted) return
        // Fallback to list message info if full detail call fails
        if (listItem) {
          setSelectedMessage({
            ...listItem,
            bodyText: listItem.snippet || '(Contenu indisponible)',
          })
        }
      })
      .finally(() => {
        if (isMounted) setLoadingDetail(false)
      })

    return () => {
      isMounted = false
    }
  }, [selectedId])

  // Filter messages
  const filteredMessages = useMemo(() => {
    let list = messages
    if (filterMode === 'unread') {
      list = list.filter((m) => m.unread)
    } else if (filterMode === 'flagged') {
      list = list.filter((m) => m.flagged)
    }
    return list
  }, [messages, filterMode])

  // A message's state in the list and, open, in the reading pane.
  const updateMessage = useCallback((id, patch) => {
    setMessages((cur) => cur.map((m) => (String(m.id) === String(id) ? { ...m, ...patch } : m)))
    setSelectedMessage((cur) => (cur && String(cur.id) === String(id) ? { ...cur, ...patch } : cur))
  }, [])

  // Shown at once, put back if the webmail refuses.
  const setMessageRead = async (message, read) => {
    if (!message || message.unread === !read) return
    updateMessage(message.id, { unread: !read })
    setUnreadCount((count) => (read ? Math.max(0, count - 1) : count + 1))
    if (!(await markMailAsRead(message.id, read))) {
      updateMessage(message.id, { unread: read })
      setUnreadCount((count) => (read ? count + 1 : Math.max(0, count - 1)))
    }
  }

  const setMessageFlagged = async (message, flagged) => {
    if (!message) return
    updateMessage(message.id, { flagged })
    if (!(await flagMailMessage(message.id, flagged))) updateMessage(message.id, { flagged: !flagged })
  }

  const trashMessage = async (message) => {
    if (!message) return
    if (String(message.id) === String(selectedId)) setSelectedId(null)
    setMessages((prev) => prev.filter((m) => m.id !== message.id))
    if (message.unread) setUnreadCount((count) => Math.max(0, count - 1))
    await trashMailMessage(message.id)
  }

  const handleToggleRead = (e) => {
    e?.stopPropagation()
    void setMessageRead(selectedMessage, Boolean(selectedMessage?.unread))
  }

  const handleToggleFlag = (e) => {
    e?.stopPropagation()
    void setMessageFlagged(selectedMessage, !selectedMessage?.flagged)
  }

  const handleTrashMessage = (e) => {
    e?.stopPropagation()
    void trashMessage(selectedMessage)
  }

  const copyAddress = (email) => {
    if (!email) return
    navigator.clipboard.writeText(email).then(() => {
      setCopiedAddress(true)
      setTimeout(() => setCopiedAddress(false), 2000)
    }).catch(() => {})
  }

  const handleCopySender = () => copyAddress(selectedMessage?.from?.email)

  // The list's right-click menu: { x, y, message }.
  const [contextMenu, setContextMenu] = useState(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const handleMessageContextMenu = (event, message) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, message })
  }

  // Compose / Send modal state
  const [composeState, setComposeState] = useState({
    isOpen: false,
    to: '',
    cc: '',
    subject: '',
    body: '',
    origId: null,
    replyType: null,
  })

  const handleNewMessage = () => {
    setComposeState({
      isOpen: true,
      to: '',
      cc: '',
      subject: '',
      body: '',
      origId: null,
      replyType: null,
    })
  }

  // A reply to `message` (the open one, or one picked in the list: then
  // quoting its preview).
  const replyTo = (message) => {
    if (!message) return
    const senderEmail = message.from?.email || ''
    const senderName = message.from?.name || senderEmail || ''
    const rawSubject = message.subject || ''
    const replySubject = /^re\s*:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`
    const dateFormatted = message.receivedAt
      ? fullDateFormatter.format(new Date(message.receivedAt))
      : ''

    const quotedBody = `
      <p><br/></p>
      <hr/>
      <p><strong>De :</strong> ${senderName} &lt;${senderEmail}&gt;<br/>
      <strong>Date :</strong> ${dateFormatted}<br/>
      <strong>Objet :</strong> ${rawSubject}</p>
      <blockquote>${message.bodyHtml || message.bodyText || ''}</blockquote>
    `

    setComposeState({
      isOpen: true,
      to: senderEmail,
      cc: '',
      subject: replySubject,
      body: quotedBody,
      origId: message.id,
      replyType: 'r',
    })
  }

  const handleReplyMessage = () => replyTo(selectedMessage)

  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)

  const handleSelectDirectoryContact = (contact) => {
    setComposeState({
      isOpen: true,
      to: contact.email,
      cc: '',
      subject: '',
      body: '',
      origId: null,
      replyType: null,
    })
  }

  const effectiveWebmailHref = webmailHref || MAIL_HREF || 'https://partage.univ-rennes.fr/'

  return (
    <AppPage
      titleId="mail-page-title"
      title="Messagerie"
      controls={unreadCount > 0 ? (
        <span className="font-body text-[15px] font-semibold leading-none text-text-secondary max-md:hidden">
          {unreadCount > 99 ? '99+' : unreadCount} non lu{unreadCount > 1 ? 's' : ''}
        </span>
      ) : null}
      actions={(
        <>
          <PageButton accent data-tour="mail-compose-button" icon="carbon:edit" label="Nouveau message" onClick={handleNewMessage} />
          <PageButton data-tour="mail-directory-button" icon="carbon:user-multiple" label="Annuaire" onClick={() => setDirectoryOpen(true)} />
          <PageButton
            icon="carbon:renew"
            label="Rafraîchir"
            onClick={() => void loadMessages(searchQuery, true)}
            disabled={refreshing || loading}
            className={`${ICON_ONLY} max-md:hidden ${refreshing ? '[&_svg]:animate-spin' : ''}`}
          />
          <PageButton data-tour="mail-preferences-button" icon="carbon:settings-adjust" label="Préférences d’envoi et signature" onClick={() => setPreferencesOpen(true)} className={`${ICON_ONLY} max-md:hidden`} />
          {effectiveWebmailHref ? <PageButton icon="carbon:arrow-up-right" label="Partage" href={effectiveWebmailHref} /> : null}
          <PageButton icon="carbon:help" label="Visite guidée" onClick={() => setTourTrigger((c) => c + 1)} className={`${ICON_ONLY} max-md:hidden`} />
        </>
      )}
      overview={(
        <div data-tour="mail-search" className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 max-w-xl flex-1 max-md:basis-full">
            <span className="sr-only">Rechercher un e-mail</span>
            <Icon icon="carbon:search" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Rechercher par expéditeur, sujet…"
              className="h-10 w-full rounded-full border border-white bg-widget-bg pl-9 pr-9 font-body text-[14px] text-text shadow-[0_1px_3px_rgba(0,0,0,0.06)] placeholder:text-text-muted focus:border-brand focus:outline-none dark:border-border"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  void loadMessages('')
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-full border-0 bg-transparent p-0.5 text-text-muted hover:text-text"
                aria-label="Effacer la recherche"
              >
                <Icon icon="carbon:close" className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <SegmentedControl
            label="Filtrer les messages"
            value={filterMode}
            onChange={setFilterMode}
            options={[
              { value: 'all', label: 'Tous', count: messages.length },
              { value: 'unread', label: 'Non lus', count: messages.filter((m) => m.unread).length },
              { value: 'flagged', label: 'Importants', count: messages.filter((m) => m.flagged).length },
            ]}
          />
        </div>
      )}
    >
        {/* Error message */}
        {error && (
          <StatusMessage
            icon="carbon:warning"
            title="Impossible de charger les e-mails"
            detail={error}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {errorServiceHref ? (
                  <a
                    href={errorServiceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-[14px] font-semibold text-bg no-underline hover:opacity-90 transition-opacity"
                  >
                    Ouvrir la messagerie
                    <Icon icon="carbon:arrow-up-right" className="size-4" aria-hidden="true" />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => void loadMessages(searchQuery, true)}
                  className={errorServiceHref
                    ? 'rounded-full border border-border bg-widget-bg px-4 py-2 text-[14px] font-semibold text-text hover:bg-bg-subtle transition-colors'
                    : 'rounded-full bg-brand px-4 py-2 text-[14px] font-semibold text-bg hover:opacity-90 transition-opacity'}
                >
                  Réessayer
                </button>
              </div>
            }
          />
        )}

        {/* Loading state */}
        {loading && !refreshing && (
          <div className="flex justify-center py-16">
            <LoadingDots label="Chargement de tes e-mails…" />
          </div>
        )}

        {/* Main Content Layout (Two-pane desktop, drill-down mobile) */}
        {!loading && !error && (
          <div className="flex gap-5 min-h-[560px] relative items-start">
            {/* Left Pane: Message List */}
            <div
              data-tour="mail-list"
              className={`w-full md:w-[380px] lg:w-[420px] shrink-0 flex flex-col gap-2 max-md:max-h-none md:max-h-[calc(100dvh-200px)] overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin] ${
                selectedId ? 'max-md:hidden' : 'block'
              }`}
            >
              {filteredMessages.length === 0 ? (
                <div className={`${CARD_CLASSES} p-8 text-center flex flex-col items-center justify-center gap-3 text-text-muted`}>
                  <Icon icon="carbon:email" className="size-10 opacity-30" />
                  <p className="m-0 font-body text-[15px] font-medium text-text">
                    {searchQuery ? 'Aucun e-mail ne correspond à ta recherche' : 'Aucun e-mail dans cette boîte'}
                  </p>
                  <p className="m-0 font-body text-[13px]">
                    {searchQuery ? 'Essaie avec d’autres mots-clés.' : 'Tous tes messages ont été traités.'}
                  </p>
                </div>
              ) : (
                <ul className="m-0 p-0 list-none flex flex-col gap-2" aria-label="Liste des e-mails">
                  {filteredMessages.map((message) => {
                    const isSelected = String(message.id) === String(selectedId)
                    const sender = getSenderLabel(message.from)
                    const receivedDate = parseDate(message.receivedAt)
                    const timeLabel = formatReceivedAt(receivedDate, now)

                    return (
                      <li key={message.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(message.id)}
                          onContextMenu={(event) => handleMessageContextMenu(event, message)}
                          className={`w-full text-left p-3.5 rounded-[18px] border bg-widget-bg transition-[background-color,box-shadow] duration-150 flex flex-col gap-1.5 cursor-pointer relative ${
                            isSelected
                              ? 'border-accent-border shadow-md ring-2 ring-accent-border'
                              : 'border-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:bg-row-hover dark:border-border'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`size-2 rounded-full shrink-0 ${
                                  message.unread ? 'bg-brand' : 'opacity-0'
                                }`}
                                aria-label={message.unread ? 'Non lu' : undefined}
                              />
                              <span
                                className={`truncate text-[14px] leading-tight font-body ${
                                  message.unread ? 'font-bold text-text' : 'font-semibold text-text-secondary'
                                }`}
                              >
                                {sender}
                              </span>
                            </div>
                            <div className="shrink-0 flex items-center gap-1.5 text-[12px] text-text-muted tabular-nums">
                              {message.flagged ? (
                                <Icon icon="carbon:flag-filled" className="size-3.5 text-[#e8590c]" aria-label="Important" />
                              ) : null}
                              {isSelected && loadingDetail && (
                                <Icon icon="carbon:renew" className="size-3.5 animate-spin text-brand" aria-label="Chargement du message" />
                              )}
                              <span>{timeLabel}</span>
                            </div>
                          </div>

                          <div
                            className={`truncate text-[13.5px] leading-snug font-body ${
                              message.unread ? 'font-semibold text-text' : 'text-text-secondary'
                            }`}
                          >
                            {message.subject || '(Sans objet)'}
                          </div>

                          {message.snippet && (
                            <div className="line-clamp-2 text-[12px] leading-relaxed text-text-muted font-body">
                              {message.snippet}
                            </div>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Right Pane: Reading Pane */}
            <div
              data-tour="mail-preview"
              className={`flex-1 min-w-0 max-md:max-h-none md:max-h-[calc(100dvh-200px)] overflow-y-auto overscroll-contain [scrollbar-width:thin] ${
                selectedId ? 'block' : 'max-md:hidden'
              }`}
            >
              {selectedId ? (
                <article
                  className={`${CARD_CLASSES} p-6 max-md:p-4 flex flex-col gap-6 shadow-sm min-h-[500px] relative overflow-hidden`}
                  aria-label="Contenu de l'e-mail"
                >
                  {/* Top sleek loading bar when fetching detail */}
                  {loadingDetail && (
                    <div className="absolute top-0 left-0 right-0 h-[3px] bg-brand/10 overflow-hidden z-10">
                      <div className={`h-full w-full ${SHIMMER_CLASSES}`} />
                    </div>
                  )}
                  {/* Mobile Back Button */}
                  <div className="md:hidden pb-3 border-b border-border">
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand hover:underline"
                    >
                      <Icon icon="carbon:chevron-left" className="size-4" />
                      <span>Retour aux messages</span>
                    </button>
                  </div>

                  {selectedMessage ? (
                    <>
                      {/* Message Header */}
                      <header className="flex flex-col gap-4 pb-5 border-b border-border">
                        <div className="flex items-start justify-between gap-4">
                          <h2 className="m-0 text-[22px] leading-snug max-md:text-[18px] font-bold text-text break-words">
                            {selectedMessage.subject || '(Sans objet)'}
                          </h2>

                          {/* Top actions */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={handleReplyMessage}
                              className="accent-button inline-flex items-center gap-1.5 h-8 px-3 rounded-full border font-body text-[13px] font-semibold cursor-pointer transition-colors"
                              title="Répondre à cet e-mail"
                            >
                              <Icon icon="carbon:reply" className="size-3.5" />
                              <span className="max-xs:hidden">Répondre</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleToggleFlag}
                              aria-pressed={Boolean(selectedMessage.flagged)}
                              className={`size-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                                selectedMessage.flagged ? 'text-[#e8590c] bg-[#e8590c]/10' : 'text-text-muted hover:text-text hover:bg-bg-subtle'
                              }`}
                              title={selectedMessage.flagged ? 'Retirer l’importance' : 'Marquer comme important'}
                            >
                              <Icon icon={selectedMessage.flagged ? 'carbon:flag-filled' : 'carbon:flag'} className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={handleToggleRead}
                              className="size-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-subtle transition-colors"
                              title={selectedMessage.unread ? 'Marquer comme lu' : 'Marquer comme non lu'}
                            >
                              <Icon
                                icon={selectedMessage.unread ? 'carbon:email' : 'carbon:email-new'}
                                className="size-4"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={handleTrashMessage}
                              className="size-8 rounded-full flex items-center justify-center text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                              title="Déplacer vers la corbeille"
                            >
                              <Icon icon="carbon:trash-can" className="size-4" />
                            </button>
                            {effectiveWebmailHref && (
                              <a
                                href={effectiveWebmailHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="size-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-subtle transition-colors"
                                title="Ouvrir dans Partage / Zimbra"
                              >
                                <Icon icon="carbon:launch" className="size-4" />
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Sender & Recipient Bar */}
                        <div className="flex items-center gap-3">
                          <div
                            className="size-10 rounded-full flex items-center justify-center text-white font-bold text-[14px] shrink-0 shadow-2xs"
                            style={{ backgroundColor: getAvatarColor(getSenderLabel(selectedMessage.from)) }}
                          >
                            {getInitials(getSenderLabel(selectedMessage.from))}
                          </div>

                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-body text-[14px] font-bold text-text truncate">
                                {getSenderLabel(selectedMessage.from)}
                              </span>
                              {selectedMessage.from?.email && (
                                <button
                                  type="button"
                                  onClick={handleCopySender}
                                  className="font-body text-[12px] text-text-muted hover:text-text transition-colors flex items-center gap-1 group truncate"
                                  title="Copier l'adresse e-mail"
                                >
                                  <span>&lt;{selectedMessage.from.email}&gt;</span>
                                  <Icon
                                    icon={copiedAddress ? 'carbon:checkmark' : 'carbon:copy'}
                                    className="size-3 opacity-60 group-hover:opacity-100"
                                  />
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-[12px] text-text-muted font-body">
                              <span>À : moi</span>
                              <span>·</span>
                              <span>
                                {selectedMessage.receivedAt
                                  ? fullDateFormatter.format(new Date(selectedMessage.receivedAt))
                                  : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                      </header>

                      {/* Attachments (if any) - exclude signature images and inline graphics */}
                      {(() => {
                        const rawAtts = Array.isArray(selectedMessage.attachments) ? selectedMessage.attachments : []
                        const bodyContent = selectedMessage.bodyHtml || ''
                        const realAtts = rawAtts.filter((att) => {
                          if (!att || !att.filename) return false
                          const fn = att.filename.toLowerCase()
                          const ct = (att.contentType || '').toLowerCase()
                          if (/signature/i.test(fn)) return false
                          if (fn === 'téléchargement.png' || fn === 'logo.png') return false
                          if (/^image00\d\.(jpe?g|png|gif)$/i.test(fn) && (att.size || 0) < 60000) return false
                          if (ct.startsWith('image/') && att.contentId) return false
                          if (att.contentId && bodyContent.includes(att.contentId)) return false
                          return true
                        })

                        if (realAtts.length === 0) return null

                        return (
                          <div className="flex flex-col gap-2 p-3 rounded-xl border border-border bg-bg-subtle/50">
                            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text-secondary">
                              <Icon icon="carbon:attachment" className="size-3.5" />
                              <span>{realAtts.length} pièce{realAtts.length > 1 ? 's' : ''} jointe{realAtts.length > 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {realAtts.map((att, idx) => (
                                <a
                                  key={att.part || idx}
                                  href={att.url || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  download={att.filename}
                                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-widget-bg hover:bg-bg-subtle text-[12px] font-medium text-text transition-colors no-underline shadow-2xs hover:border-brand/40"
                                  title={`Télécharger ${att.filename}`}
                                >
                                  <Icon icon="carbon:document" className="size-4 text-brand shrink-0" />
                                  <span className="truncate max-w-[200px]">{att.filename}</span>
                                  {att.size && <span className="text-text-muted tabular-nums">({formatBytes(att.size)})</span>}
                                  <Icon icon="carbon:download" className="size-3.5 text-text-muted ml-0.5 opacity-60 shrink-0" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )
                      })()}

                      {/* Message Body */}
                      <div className="flex-1 min-h-[160px]">
                        {loadingDetail ? (
                          <div className="flex flex-col gap-5 py-4">
                            <div className="flex items-center gap-3 text-text-muted">
                              <LoadingDots label="Chargement du contenu complet…" />
                            </div>
                            <div className="flex flex-col gap-3 max-w-xl opacity-70">
                              <div className={`h-3.5 w-full rounded-md ${SHIMMER_CLASSES}`} />
                              <div className={`h-3.5 w-11/12 rounded-md ${SHIMMER_CLASSES}`} />
                              <div className={`h-3.5 w-4/5 rounded-md ${SHIMMER_CLASSES}`} />
                              <div className={`h-3.5 w-3/5 rounded-md ${SHIMMER_CLASSES}`} />
                              <div className={`h-3.5 w-2/3 rounded-md ${SHIMMER_CLASSES}`} />
                            </div>
                          </div>
                        ) : (
                          <>
                            <EmailBodyViewer html={selectedMessage.bodyHtml} text={selectedMessage.bodyText} />

                            {/* Quick reply action bar at the bottom */}
                            <div className="pt-6 mt-6 border-t border-border flex items-center justify-between flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={handleReplyMessage}
                                className="inline-flex items-center gap-2 rounded-full border-0 bg-brand px-4 py-2 font-body text-[14px] font-semibold text-bg cursor-pointer transition-colors hover:bg-brand-hover"
                              >
                                <Icon icon="carbon:reply" className="size-4" />
                                <span>Répondre à ce message</span>
                              </button>

                              {effectiveWebmailHref && (
                                <a
                                  href={effectiveWebmailHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 text-[12px] font-medium text-text-muted hover:text-brand transition-colors"
                                >
                                  <span>Ouvrir dans Partage</span>
                                  <Icon icon="carbon:launch" className="size-3.5" />
                                </a>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  ) : loadingDetail ? (
                    <div className="flex flex-col gap-6 py-6 animate-pulse">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-full bg-bg-muted" />
                        <div className="flex flex-col gap-2 flex-1">
                          <div className="h-4 w-44 rounded bg-bg-muted" />
                          <div className="h-3 w-28 rounded bg-bg-subtle" />
                        </div>
                      </div>
                      <div className="flex flex-col items-center justify-center py-16 text-text-muted">
                        <LoadingDots label="Ouverture du message…" />
                      </div>
                    </div>
                  ) : null}
                </article>
              ) : (
                /* Desktop Placeholder when no message is selected */
                <div className={`${CARD_CLASSES} p-12 text-center flex flex-col items-center justify-center gap-3 text-text-muted min-h-[460px]`}>
                  <div className="size-16 rounded-full bg-brand/10 text-brand flex items-center justify-center mb-1">
                    <Icon icon="carbon:email" className="size-8" />
                  </div>
                  <h3 className="m-0 font-body text-[17px] font-semibold text-text">
                    Sélectionne un e-mail
                  </h3>
                  <p className="m-0 font-body text-[13.5px] max-w-sm leading-relaxed">
                    Clique sur un message dans la liste à gauche pour afficher son contenu complet et ses pièces jointes.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

      {contextMenu ? (() => {
        const { message } = contextMenu
        return (
          <MailContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            label={`Actions pour « ${message.subject || '(Sans objet)'} »`}
            onClose={closeContextMenu}
            items={[
              { icon: 'carbon:email', label: 'Ouvrir', onSelect: () => setSelectedId(message.id) },
              { icon: 'carbon:reply', label: 'Répondre', onSelect: () => replyTo({ ...message, bodyText: message.bodyText || message.snippet }) },
              'separator',
              message.unread
                ? { icon: 'carbon:email', label: 'Marquer comme lu', onSelect: () => void setMessageRead(message, true) }
                : { icon: 'carbon:email-new', label: 'Marquer comme non lu', onSelect: () => void setMessageRead(message, false) },
              message.flagged
                ? { icon: 'carbon:flag', label: 'Retirer l’importance', onSelect: () => void setMessageFlagged(message, false) }
                : { icon: 'carbon:flag-filled', label: 'Marquer comme important', onSelect: () => void setMessageFlagged(message, true) },
              ...(message.from?.email ? [{ icon: 'carbon:copy', label: 'Copier l’adresse de l’expéditeur', onSelect: () => copyAddress(message.from.email) }] : []),
              { icon: 'carbon:launch', label: 'Ouvrir dans le webmail', onSelect: () => window.open(effectiveWebmailHref, '_blank', 'noopener,noreferrer') },
              'separator',
              { icon: 'carbon:trash-can', label: 'Mettre à la corbeille', danger: true, onSelect: () => void trashMessage(message) },
            ]}
          />
        )
      })() : null}

      {/* Mail Composer Modal */}
      <MailComposeModal
        isOpen={composeState.isOpen}
        onClose={() => setComposeState((prev) => ({ ...prev, isOpen: false }))}
        initialTo={composeState.to}
        initialCc={composeState.cc}
        initialSubject={composeState.subject}
        initialBody={composeState.body}
        origId={composeState.origId}
        replyType={composeState.replyType}
        onSent={() => void loadMessages(searchQuery, true)}
      />

      {/* University Directory Modal */}
      <MailDirectoryModal
        isOpen={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
        onSelectContact={handleSelectDirectoryContact}
      />

      {/* Email Preferences Modal */}
      <MailPreferencesModal
        isOpen={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
      />

      <PageGuidedTour
        storageKey="l-ent:tour:mail"
        steps={MAIL_TOUR_STEPS}
        manualTrigger={tourTrigger}
      />
    </AppPage>
  )
}
