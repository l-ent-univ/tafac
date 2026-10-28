import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import {
  fetchThread,
  initiallyOpen,
  loadMessage,
  messageCache,
  readyThread,
  remember,
  settledValue,
  threadCache,
  threadKey,
} from '../mailReadCache'
import { SHIMMER_CLASSES, calendarDayDiff, formatClockTime, getSenderLabel } from './widgetListUtils'
import { getSenderBadgeStyle, getSenderDomainCue, getSenderInitial } from './mailSender'
import { GROUP_CARD_CLASSES, GroupRow } from './GroupCard'
import FileName from './FileName'
import { formatAttachmentSize as formatSize, getAttachmentIcon, getAttachmentKind } from '../mailAttachments'

const fullDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' })
const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const dayMonthYearFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
// Recipients shown before « +N » (a promo-wide mail lists hundreds).
const RECIPIENTS_SHOWN = 2

const SECONDARY_BUTTON_CLASSES = 'inline-flex shrink-0 items-center gap-[6px] px-3 py-2 border border-white dark:border-[rgba(255,255,255,0.08)] rounded-full bg-widget-bg text-text-secondary text-[13px] font-medium leading-none no-underline cursor-pointer transition-[background-color] duration-120 ease-in-out hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-text'

// The mail is cleaned on the server (server/mailMessage.js) and shown here in
// a sandboxed iframe as a second wall: no scripts, no forms, no top
// navigation, links in a new tab without referrer. allow-same-origin only
// lets this page read the frame's height (nothing can run inside). The CSP
// lets in the mail's inline styles, data: images and the part proxy's
// (inline cid: images); remote images only once the student asks. Not 'self'
// for images: same-origin, the frame's requests carry the student's cookies,
// and a path such as /__ent_proxy/… (forwarded to the ENT with the session)
// must not be reachable from a mail's CSS or markup. A path in a source
// matches that path exactly, whatever its query.
const MAIL_PART_PATH = '/__ent_auth/mail/part'
function buildFrameCsp(showRemoteImages) {
  return `default-src 'none'; style-src 'unsafe-inline'; img-src data: ${window.location.origin}${MAIL_PART_PATH}${showRemoteImages ? ' https: http:' : ''}; media-src 'none'; form-action 'none'`
}

// The mail's text sits straight in the reader, without a frame of its own:
// no padding, no background. Except an HTML mail in the dark theme, written
// for white: there it keeps a white sheet (padded, rounded by the iframe).
// A plain text one takes the app's colours.
function buildFrameStyle(format, colors) {
  const base = 'html{-webkit-text-size-adjust:100%;overflow:hidden}body{display:flow-root;box-sizing:border-box;margin:0;padding:0;font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere;transform-origin:0 0}img,video{max-width:100%!important;height:auto!important}table,[style*="width"]{max-width:100%!important}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #ccc}hr.tafac-mail-part-break{border:0;border-top:1px dashed #ccc;margin:24px 0}.tafac-quote-hidden .tafac-quoted{display:none!important}a{color:#0b57d0}'
  if (format === 'html') return `:root{color-scheme:light}${base}body{background:${colors.dark ? '#fff;padding:16px' : 'transparent'};color:#1a1a1a}`
  return `:root{color-scheme:${colors.dark ? 'dark' : 'light'}}${base}body{background:transparent;color:${colors.text}}a{color:${colors.dark ? '#8ab4f8' : '#0b57d0'}}.tafac-mail-text{white-space:pre-wrap}`
}

// Once shown, https: lets in any remote URL, the app's own origin included
// (its requests carry the student's cookies): a mail's absolute URL to this
// site stays held back. By host, as cookies go: any port or scheme, a
// trailing dot.
function isAppOriginUrl(value) {
  try {
    return new URL(value, window.location.href).hostname.replace(/\.$/, '') === window.location.hostname
  } catch {
    return true
  }
}

// The CSS the server held back (data-remote-style, data-remote-css): each of
// its URLs is written url("…") with CSS escapes (server/mailMessage.js).
function revealRemoteCss(css) {
  return css.replace(/url\("((?:[^"\\]|\\[0-9a-f]{1,6} )*)"\)/gi, (whole, escaped) => {
    let value
    try {
      value = escaped.replace(/\\([0-9a-f]{1,6}) /gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    } catch {
      return 'none'
    }
    return /^https?:/i.test(value) && isAppOriginUrl(value) ? 'none' : whole
  })
}

// The held-back remote images, put back (data-remote-* set by the server).
// DOMParser builds an inert document: nothing loads or runs while editing it.
function revealRemoteImages(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const image of doc.querySelectorAll('img[data-remote-src]')) {
    const src = image.getAttribute('data-remote-src')
    if (!isAppOriginUrl(src)) image.setAttribute('src', src)
    image.removeAttribute('data-remote-src')
  }
  for (const element of doc.querySelectorAll('[data-remote-background]')) {
    const background = element.getAttribute('data-remote-background')
    if (!isAppOriginUrl(background)) element.setAttribute('background', background)
    element.removeAttribute('data-remote-background')
  }
  for (const element of doc.querySelectorAll('[data-remote-style]')) {
    element.setAttribute('style', revealRemoteCss(element.getAttribute('data-remote-style')))
    element.removeAttribute('data-remote-style')
  }
  for (const style of doc.querySelectorAll('style[data-remote-css]')) {
    style.textContent = revealRemoteCss(style.getAttribute('data-remote-css'))
    style.removeAttribute('data-remote-css')
  }
  return doc.body.innerHTML
}

function buildFrameDocument(message, { showRemoteImages, colors }) {
  const body = showRemoteImages ? revealRemoteImages(message.html) : message.html
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${buildFrameCsp(showRemoteImages)}">`
    + '<meta name="referrer" content="no-referrer"><base target="_blank">'
    + `<style>${buildFrameStyle(message.format, colors)}</style></head><body>${body}</body></html>`
}

// The page's own colours, for a plain text mail (followed when the theme
// changes).
function readThemeColors() {
  const root = document.documentElement
  const styles = getComputedStyle(root)
  return {
    dark: root.dataset.theme === 'dark',
    text: styles.getPropertyValue('--color-text').trim() || (root.dataset.theme === 'dark' ? '#f2f2f2' : '#1a1a1a'),
  }
}

function useThemeColors() {
  const [colors, setColors] = useState(readThemeColors)
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readThemeColors()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    return () => observer.disconnect()
  }, [])
  return colors
}

// As Apple Mail's header: "15h15" today, "hier à 15h15", "lun. à 15h15"
// this week, "12 sept. à 15h15" older (the year when not this one).
function formatHeaderDate(date, now = new Date()) {
  const dayDiff = -calendarDayDiff(date, now)
  const time = formatClockTime(date)
  if (dayDiff <= 0) return time
  if (dayDiff === 1) return `hier à ${time}`
  if (dayDiff < 7) return `${weekdayFormatter.format(date)} à ${time}`
  const day = date.getFullYear() === now.getFullYear() ? dayMonthFormatter.format(date) : dayMonthYearFormatter.format(date)
  return `${day} à ${time}`
}

// An address with break chances after the @ and before each dot, so a long
// one wraps at its parts rather than mid-word.
function withBreaks(email) {
  return email.split(/(?<=@)|(?=\.)/).flatMap((part, index) => (index ? [<wbr key={index} />, part] : [part]))
}

function addressParts(address) {
  const email = address?.email?.trim() || ''
  const name = address?.name?.trim() || ''
  return { email, name: name && name !== email ? name : '' }
}

// A person's card, opened from their name (the sender, a recipient chip):
// their badge, name and full address, and a button copying it. Closed by a
// click outside or Escape (which then doesn't close the reader). Kept inside
// the reader: shifted left when it would pass its right edge.
function AddressCard({ address, onClose, anchorRef }) {
  const { email, name } = addressParts(address)
  const cardRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [shift, setShift] = useState(0)
  const badgeStyle = getSenderBadgeStyle((email || name).toLowerCase())

  useLayoutEffect(() => {
    const card = cardRef.current
    const boundary = card?.closest('article')
    if (!card || !boundary) return
    const overflow = card.getBoundingClientRect().right - boundary.getBoundingClientRect().right
    if (overflow > 0) setShift(-overflow)
  }, [])

  useEffect(() => {
    function handlePointerDown(event) {
      if (!cardRef.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) onClose()
    }
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
      anchorRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [anchorRef, onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
    } catch {
      // Clipboard refused: the address stays selectable.
    }
  }

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={name || email}
      className="absolute left-0 top-[calc(100%+8px)] z-20 grid w-[340px] max-w-[calc(100vw-32px)] gap-4 p-4 rounded-[22px] border border-border bg-widget-bg text-left shadow-[0_16px_40px_-8px_rgba(52,18,0,0.18)] animate-modal-card-in"
      style={shift ? { translate: `${shift}px 0` } : undefined}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] text-[17px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
          style={badgeStyle ?? undefined}
          aria-hidden="true"
        >
          {getSenderInitial(name || email)}
        </span>
        <div className="grid gap-[2px] min-w-0">
          {name ? <p className="m-0 text-[15px] font-semibold leading-[1.3] text-text break-words">{name}</p> : null}
          <p className="m-0 text-[13px] leading-[1.4] text-text-muted [overflow-wrap:anywhere] select-text">{withBreaks(email)}</p>
        </div>
      </div>
      <button type="button" className="material inline-flex h-9 w-full items-center justify-center gap-2 rounded-full px-4 cursor-pointer" onClick={copy}>
        <Icon icon={copied ? 'carbon:checkmark' : 'carbon:copy'} className="size-[14px] shrink-0" aria-hidden="true" />
        <span className="text-[13px] font-semibold leading-none">{copied ? 'Adresse copiée' : 'Copier l’adresse'}</span>
      </button>
    </div>
  )
}

// A name opening its AddressCard: the sender's in the header, each
// recipient's chip.
function AddressButton({ address, className, children }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const { email, name } = addressParts(address)
  const close = useCallback(() => setOpen(false), [])
  return (
    <span className="relative inline-flex min-w-0 max-w-full">
      <button
        ref={anchorRef}
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={name ? `${name}, ${email}` : email}
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </button>
      {open ? <AddressCard address={address} anchorRef={anchorRef} onClose={close} /> : null}
    </span>
  )
}

// A recipient: their small badge and name, bare (no fill, no edge), the
// name darker on hover and while their card is open. Their text is styled
// on an inner span: a <button> takes its font from index.css's
// `button { font: inherit }`, outside Tailwind's layers, so over its
// utilities.
const CHIP_CLASSES = 'group inline-flex h-7 min-w-0 max-w-full items-center gap-[7px] rounded-[6px] border-0 bg-transparent p-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text'
const CHIP_TEXT_CLASSES = 'text-[13px] font-medium leading-none text-text-muted transition-colors duration-120 group-hover:text-text group-aria-expanded:text-text'

// A recipient as a chip: a small badge and their name (the address when
// it's all the mail gives), opening their card.
function RecipientChip({ address }) {
  const { email, name } = addressParts(address)
  const label = name || email
  const badgeStyle = getSenderBadgeStyle((email || name).toLowerCase())
  return (
    <AddressButton address={address} className={CHIP_CLASSES}>
      <span
        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
        style={badgeStyle ?? undefined}
        aria-hidden="true"
      >
        {getSenderInitial(label)}
      </span>
      <span className={`min-w-0 truncate ${CHIP_TEXT_CLASSES}`}>{label}</span>
    </AddressButton>
  )
}

// One line of the recipients (À, Cc, Répondre à): the label in its column,
// the first chips, then « +N » for the rest.
function RecipientsRow({ label, list }) {
  const [expanded, setExpanded] = useState(false)
  if (!list?.length) return null
  const shown = expanded ? list : list.slice(0, RECIPIENTS_SHOWN)
  const hidden = list.length - shown.length
  return (
    <>
      <dt className="text-[13px] font-medium leading-7 text-text-muted">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-wrap gap-x-4 gap-y-[2px]">
        {shown.map((address, index) => (
          <RecipientChip key={`${address?.email ?? ''}-${index}`} address={address} />
        ))}
        {hidden > 0 ? (
          <button
            type="button"
            className="group inline-flex h-7 items-center rounded-[6px] border-0 bg-transparent p-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
            aria-label={`${hidden} autre${hidden > 1 ? 's' : ''} destinataire${hidden > 1 ? 's' : ''}`}
            onClick={() => setExpanded(true)}
          >
            <span className={`${CHIP_TEXT_CLASSES} tabular-nums`}>+{hidden}</span>
          </button>
        ) : null}
      </dd>
    </>
  )
}

// Shown only past a short wait (.mail-skeleton-delayed), faded in: a quick
// load shows none.
function MailReaderPlaceholder() {
  return (
    <div className="mail-skeleton-delayed grid gap-4" role="status" aria-label="Chargement du mail">
      <div className="flex items-start gap-3">
        <span className={`text-placeholder-shimmer size-10 shrink-0 rounded-[10px] ${SHIMMER_CLASSES}`} />
        <div className="grid flex-1 gap-2 pt-1">
          <span className={`text-placeholder-shimmer h-3.5 w-[40%] rounded-full ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer h-3 w-[70%] rounded-full ${SHIMMER_CLASSES}`} />
          <span className={`text-placeholder-shimmer h-2.5 w-[30%] rounded-full ${SHIMMER_CLASSES}`} />
        </div>
      </div>
      <span className={`text-placeholder-shimmer h-48 w-full rounded-[12px] ${SHIMMER_CLASSES}`} />
    </div>
  )
}

// On a phone, text below this (a mail in 10pt, as most clients send them)
// is hard to read: its sizes are raised so its main text reaches it.
const READABLE_TEXT_PX = 15
const MAX_TEXT_BOOST = 1.4
const PHONE_QUERY = '(max-width: 640px)'

// The size most of the mail's text is in, by its length.
function mainTextSize(doc) {
  const lengths = new Map()
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent.trim().length
    if (!length || !node.parentElement) continue
    const size = parseFloat(doc.defaultView.getComputedStyle(node.parentElement).fontSize)
    if (size) lengths.set(size, (lengths.get(size) ?? 0) + length)
  }
  let main = 0
  let longest = 0
  for (const [size, length] of lengths) {
    if (length > longest) {
      main = size
      longest = length
    }
  }
  return main
}

// Every text size (and line height set in pixels) times the same factor, so
// a signature stays smaller than the text above it. Read before written:
// sizes in em would otherwise grow twice.
function raiseTextSizes(doc) {
  const main = mainTextSize(doc)
  if (!main || main >= READABLE_TEXT_PX) return
  const factor = Math.min(READABLE_TEXT_PX / main, MAX_TEXT_BOOST)
  const elements = [doc.body, ...doc.body.querySelectorAll('*')]
  const sizes = elements.map((element) => {
    const style = doc.defaultView.getComputedStyle(element)
    return [element, parseFloat(style.fontSize), style.lineHeight]
  })
  for (const [element, size, lineHeight] of sizes) {
    if (size) element.style.setProperty('font-size', `${size * factor}px`, 'important')
    if (lineHeight.endsWith('px')) element.style.setProperty('line-height', `${parseFloat(lineHeight) * factor}px`, 'important')
  }
}

// The earlier mails a reply quotes, after its own text: the clients' quote
// blocks (Apple's and Thunderbird's blockquote, Gmail's, Outlook's, Zimbra's
// « zwchr » line), with the « Le …, X a écrit : » line just above; in a
// plain text mail, from that line, an « original message » rule or the
// first « > » line.
const QUOTE_SELECTOR = 'blockquote, .gmail_quote, .gmail_extra, #zwchr, #divRplyFwdMsg, #appendonsend, .moz-cite-prefix, [name="messageReplySection"], .yahoo_quoted'
const QUOTE_ATTRIBUTION = /(a écrit|wrote|schrieb|escribió)\s*:?$/i
const TEXT_QUOTE_START = /(^|\n)((?:Le|On) [^\n]{4,200}(?:a écrit|wrote)\s*:?[ \t]*(?=\n|$)|-{2,}\s*(?:Mail|Message) (?:original|d'origine)\s*-{2,}|>)/i

function findQuoteStart(doc) {
  const root = doc.body.querySelector(QUOTE_SELECTOR)
  if (root) {
    let previous = root.previousSibling
    while (previous && ((previous.nodeType === Node.TEXT_NODE && !previous.textContent.trim()) || previous.nodeName === 'BR')) {
      previous = previous.previousSibling
    }
    const attribution = previous?.textContent.trim() ?? ''
    return attribution && attribution.length < 400 && QUOTE_ATTRIBUTION.test(attribution) ? previous : root
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const match = TEXT_QUOTE_START.exec(node.data)
    if (!match) continue
    const index = match.index + match[1].length
    return index > 0 ? node.splitText(index) : node
  }
  return null
}

// Marks the quoted part (.tafac-quoted: it and all that follows, up to the
// body; bare text wrapped in a span), so the frame's style can hide it.
// Not when nothing would show before it (a forward, all quote). Whether
// there was one.
function markQuotedPart(doc) {
  if (!doc?.body) return false
  if (doc.body.querySelector('.tafac-quoted')) return true
  const start = findQuoteStart(doc)
  if (!start) return false
  const before = doc.createRange()
  before.setStart(doc.body, 0)
  before.setEndBefore(start)
  if (!before.toString().trim()) return false

  const mark = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      node.classList.add('tafac-quoted')
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      const wrapper = doc.createElement('span')
      wrapper.className = 'tafac-quoted'
      node.replaceWith(wrapper)
      wrapper.append(node)
    }
  }
  let node = start
  let sibling = start
  while (node && node !== doc.body) {
    while (sibling) {
      const next = sibling.nextSibling
      mark(sibling)
      sibling = next
    }
    node = node.parentNode
    sibling = node?.nextSibling ?? null
  }
  return true
}

// The mail's body, as tall as its content (followed as images load). Fixed
// widths give way to the frame (buildFrameStyle), so most mails wrap to it.
function MailBodyFrame({ message, showRemoteImages, title }) {
  const colors = useThemeColors()
  const frameRef = useRef(null)
  const observerRef = useRef(null)
  const [height, setHeight] = useState(120)
  // A reply's quoted part (markQuotedPart): folded until asked for, the
  // choice kept when the frame reloads (remote images shown).
  const [hasQuote, setHasQuote] = useState(false)
  const [quoteShown, setQuoteShown] = useState(false)
  const quoteShownRef = useRef(false)

  // A mail still wider than the frame (a newsletter's table that can't
  // wrap) is scaled down to its width, as Apple Mail does, rather than
  // scrolled sideways:
  // the body laid out at the mail's own width, then shrunk (a transform,
  // which leaves the layout and so these measures alone). The frame then
  // takes the body's height (a flow root: floats and margins inside), not
  // the <html>'s, which never gets shorter than the frame.
  const fit = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    const body = doc?.body
    if (!body) return
    body.style.width = ''
    body.style.transform = ''
    const available = doc.documentElement.clientWidth
    const overflow = Math.max(body.scrollWidth, doc.documentElement.scrollWidth)
    let scale = 1
    if (available > 0 && overflow > available + 1) {
      // The overflow stops at the content's edge: the right padding back.
      const natural = overflow + (parseFloat(doc.defaultView.getComputedStyle(body).paddingRight) || 0)
      scale = available / natural
      body.style.width = `${natural}px`
      body.style.transform = `scale(${scale})`
    }
    const next = Math.ceil(body.offsetHeight * scale)
    if (next) setHeight(next)
  }, [])

  const handleLoad = useCallback(() => {
    observerRef.current?.disconnect()
    const doc = frameRef.current?.contentDocument
    if (!doc?.body) return
    if (window.matchMedia(PHONE_QUERY).matches) raiseTextSizes(doc)
    const quoted = markQuotedPart(doc)
    setHasQuote(quoted)
    doc.body.classList.toggle('tafac-quote-hidden', quoted && !quoteShownRef.current)
    fit()
    observerRef.current = new ResizeObserver(fit)
    observerRef.current.observe(doc.body)
    // The frame narrowed or widened (the panel resized) while the body,
    // scaled, keeps the mail's width.
    observerRef.current.observe(frameRef.current)
    // Images loading late (cid, remote) grow the body without a resize of
    // the frame itself.
    for (const image of doc.images) image.addEventListener('load', fit, { once: true })
  }, [fit])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  const toggleQuote = () => {
    const shown = !quoteShown
    quoteShownRef.current = shown
    setQuoteShown(shown)
    frameRef.current?.contentDocument?.body?.classList.toggle('tafac-quote-hidden', !shown)
    fit()
  }

  return (
    <>
      <iframe
        ref={frameRef}
        title={title}
        className={`block w-full ${message.format === 'html' && colors.dark ? 'rounded-[12px] bg-white' : ''}`}
        style={{ height }}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={buildFrameDocument(message, { showRemoteImages, colors })}
        onLoad={handleLoad}
      />
      {hasQuote ? (
        <button
          type="button"
          className="material -mt-1 inline-flex h-8 items-center gap-2 justify-self-start rounded-full px-3 cursor-pointer"
          aria-expanded={quoteShown}
          onClick={toggleQuote}
        >
          <Icon icon={quoteShown ? 'carbon:chevron-up' : 'carbon:overflow-menu-horizontal'} className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
          <span className="text-[13px] font-semibold leading-none text-text">{quoteShown ? 'Masquer le message cité' : 'Afficher le message cité'}</span>
        </button>
      ) : null}
    </>
  )
}

// In place of the list only (in the side panel, from 4xl, the list stays
// beside it, its open row closing it again): back to it, as iOS's back
// button — a pill of the tab bar's glass (.mobile-tab-bar, as the search
// and the reader's toolbar), named after the folder left, held at the top
// as a long mail scrolls under it. Its text on a span: a <button> takes its
// font from index.css's `button { font: inherit }`.
function ReaderBackRow({ onBack, label = 'Réception' }) {
  return (
    <div className="sticky top-[calc(env(safe-area-inset-top)+12px)] z-20 flex 4xl:hidden">
      <button
        type="button"
        className="mobile-tab-bar mobile-tab-bar-item inline-flex h-11 items-center gap-[6px] rounded-full pl-3 pr-4 text-text cursor-pointer transition-[background-color,transform] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text/30"
        aria-label={`Retour : ${label}`}
        onClick={onBack}
      >
        <Icon icon="carbon:chevron-left" className="size-[18px] shrink-0" aria-hidden="true" />
        <span className="text-[15px] font-semibold leading-none">{label}</span>
      </button>
    </div>
  )
}

// One mail, read in the app: header, attachments, body. `webmailHref` for
// what the reader can't show (a cut mail, a failure). `embedded`: one of a
// thread's (MailThread), which has the back button and Escape itself;
// `autoFocus` then on its newest only.
function MailReader({ id, webmailHref, onBack, onLoaded, embedded = false, autoFocus = !embedded, backLabel }) {
  const [state, setState] = useState(() => {
    const cached = settledValue(messageCache, id)
    return cached ? { status: 'ok', message: cached, notFound: false } : { status: 'loading', message: null, notFound: false }
  })
  const [showRemoteImages, setShowRemoteImages] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const headingRef = useRef(null)
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    onLoadedRef.current = onLoaded
  })

  useEffect(() => {
    let cancelled = false
    const cached = settledValue(messageCache, id)
    setState(cached ? { status: 'ok', message: cached, notFound: false } : { status: 'loading', message: null, notFound: false })
    setShowRemoteImages(false)
    loadMessage(id)
      .then((message) => {
        if (cancelled) return
        setState({ status: 'ok', message, notFound: false })
        onLoadedRef.current?.(message)
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', message: null, notFound: error?.status === 404 })
      })
    return () => {
      cancelled = true
    }
  }, [id, attempt])

  useEffect(() => {
    if (state.status === 'ok' && autoFocus) headingRef.current?.focus({ preventScroll: true })
  }, [state.status, autoFocus])

  useEffect(() => {
    if (embedded) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) onBack()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onBack, embedded])

  const { message } = state
  const receivedAt = message?.receivedAt ? new Date(message.receivedAt) : null
  const subject = message?.subject?.trim() || '(Sans objet)'
  const sender = getSenderLabel(message?.from)
  const senderEmail = message?.from?.email?.trim() || null
  const senderDomain = message ? getSenderDomainCue(message.from, { always: true }) : null
  const senderBadgeStyle = message ? getSenderBadgeStyle((senderEmail || sender).toLowerCase()) : null

  return (
    <article className="mail-reader-enter grid gap-4 min-w-0" aria-busy={state.status === 'loading' || undefined}>
      {embedded ? null : <ReaderBackRow onBack={onBack} label={backLabel} />}

      {state.status === 'loading' ? <MailReaderPlaceholder /> : null}

      {state.status === 'error' ? (
        <div className="grid justify-items-start gap-3">
          <p className="m-0 text-[14px] text-text-muted">{state.notFound ? 'Ce mail n’existe plus' : 'Ce mail n’a pas chargé'}</p>
          <div className="flex flex-wrap gap-2">
            {state.notFound ? null : (
              <button type="button" className={SECONDARY_BUTTON_CLASSES} onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>
            )}
            {webmailHref ? (
              <a className={SECONDARY_BUTTON_CLASSES} href={webmailHref} target="_blank" rel="noopener noreferrer">
                Ouvrir le webmail
                <Icon icon="carbon:arrow-up-right" className="size-[14px] shrink-0" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {message ? (
        <>
          {/* As Apple Mail's: the sender's badge, their name and the date,
              the subject, then the recipients. The address on the name's
              hover, the full date on the date's. */}
          <header className="flex items-start gap-3 min-w-0">
            <span
              className={`inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] text-[17px] font-semibold leading-none ${senderBadgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
              style={senderBadgeStyle ?? undefined}
              aria-hidden="true"
            >
              {getSenderInitial(sender)}
            </span>
            <div className="grid flex-1 gap-[3px] min-w-0">
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                {senderEmail ? (
                  // The domain the mail came from after the name, whoever
                  // sent it (mailSender.js): a name is the sender's to
                  // choose, the domain isn't. Kept in view when the name is
                  // cut; the button's label already reads the whole address.
                  <span className="flex min-w-0 items-baseline gap-[6px]">
                    <AddressButton
                      address={message.from}
                      className="min-w-0 max-w-full p-0 border-0 bg-transparent text-left text-text cursor-pointer rounded-[4px] decoration-text-30 underline-offset-[3px] hover:underline aria-expanded:underline focus-visible:outline-2 focus-visible:outline-text"
                    >
                      <span className="block truncate text-[16px] font-semibold leading-[1.3]">{sender}</span>
                    </AddressButton>
                    {senderDomain ? (
                      <span className="max-w-[50%] shrink-0 truncate text-[13px] font-medium text-text-muted" aria-hidden="true">{senderDomain}</span>
                    ) : null}
                  </span>
                ) : (
                  <p className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.3] text-text">{sender}</p>
                )}
                {receivedAt ? (
                  <time className="shrink-0 text-[13px] font-medium text-text-muted tabular-nums" dateTime={receivedAt.toISOString()} title={fullDateFormatter.format(receivedAt)}>
                    {formatHeaderDate(receivedAt)}
                  </time>
                ) : null}
              </div>
              <h2 ref={headingRef} tabIndex={-1} className="m-0 text-[14px] font-medium leading-[1.35] text-text break-words outline-none">{subject}</h2>
              <dl className="m-0 mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2">
                <RecipientsRow label="À" list={message.to} />
                <RecipientsRow label="Cc" list={message.cc} />
                {message.replyTo && message.replyTo.email !== message.from?.email ? (
                  <RecipientsRow label="Répondre à" list={[message.replyTo]} />
                ) : null}
              </dl>
            </div>
          </header>

          {/* Titled and carded as a class's occurrences (PlanningEventSheet),
              on a tint so the white card stands out of the white panel; its
              corners the card's plus the tint's 8px. */}
          {message.attachments.length ? (
            <section className="grid gap-[10px] rounded-[28px] bg-bg-subtle p-2 dark:bg-bg-muted" aria-labelledby="mail-attachments-title">
              <div className="flex items-center gap-[5px] px-2 pt-[6px] text-brand">
                <Icon icon="carbon:attachment" className="size-[17px] shrink-0" aria-hidden="true" />
                <h3 id="mail-attachments-title" className="m-0 font-body text-base font-medium leading-[1.06]">Pièces jointes</h3>
                <span className="ml-auto font-body text-[13px] font-medium leading-none text-text-muted tabular-nums">{message.attachments.length}</span>
              </div>
              <ul className={GROUP_CARD_CLASSES}>
                {message.attachments.map((attachment) => (
                  <GroupRow
                    key={attachment.part}
                    icon={getAttachmentIcon(attachment.type)}
                    title={<FileName name={attachment.name} />}
                    hint={attachment.name}
                    compact
                    detail={[getAttachmentKind(attachment), formatSize(attachment.size)].filter(Boolean).join(' · ')}
                    href={attachment.href}
                    download={attachment.name}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {message.remoteImages > 0 && !showRemoteImages ? (
            <ul className={GROUP_CARD_CLASSES}>
              <GroupRow
                icon="carbon:image"
                title="Images externes masquées"
                compact
                trailing="Afficher"
                onClick={() => setShowRemoteImages(true)}
              />
            </ul>
          ) : null}

          {message.html ? (
            <MailBodyFrame message={message} showRemoteImages={showRemoteImages} title={`Contenu du mail : ${subject}`} />
          ) : (
            <p className="m-0 text-[14px] text-text-muted">Ce mail n’a pas de texte</p>
          )}

          {message.truncated ? (
            <p className="m-0 text-[13px] text-text-muted">
              Mail trop long, la suite est dans le webmail
              {webmailHref ? (
                <>
                  {' · '}
                  <a className="text-text-70 font-medium underline" href={webmailHref} target="_blank" rel="noopener noreferrer">Ouvrir le webmail</a>
                </>
              ) : null}
            </p>
          ) : null}
        </>
      ) : null}
    </article>
  )
}

// An older mail of a thread, folded: its sender, date and preview on one
// row, opening it in full.
function ThreadFoldedMail({ message, onExpand }) {
  const sender = getSenderLabel(message.from)
  const email = message.from?.email?.trim() || null
  const senderDomain = getSenderDomainCue(message.from)
  const badgeStyle = getSenderBadgeStyle((email || sender).toLowerCase())
  const receivedAt = message.receivedAt ? new Date(message.receivedAt) : null
  return (
    <button
      type="button"
      className="mail-reader-enter flex w-full min-w-0 items-center gap-3 -mx-2 px-2 py-3 rounded-[12px] border-0 bg-transparent text-left cursor-pointer transition-[background-color] duration-120 hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-text"
      aria-expanded="false"
      onClick={onExpand}
    >
      <span
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[14px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
        style={badgeStyle ?? undefined}
        aria-hidden="true"
      >
        {getSenderInitial(sender)}
      </span>
      <span className="grid min-w-0 flex-1 gap-[3px]">
        <span className="flex min-w-0 items-baseline justify-between gap-3">
          {/* As the list's rows: the domain only when it isn't the university's. */}
          <span className="flex min-w-0 items-baseline gap-[5px]">
            <span className={`min-w-0 truncate text-[14px] leading-tight ${message.unread ? 'font-bold text-text' : 'font-semibold text-text-70'}`}>{sender}</span>
            {senderDomain ? <span className="max-w-[55%] shrink-0 truncate text-[12px] leading-tight font-medium text-text-muted">{senderDomain}</span> : null}
          </span>
          {receivedAt ? <span className="shrink-0 text-[12px] font-medium text-text-muted tabular-nums">{formatHeaderDate(receivedAt)}</span> : null}
        </span>
        {message.snippet ? <span className="truncate text-[13px] leading-tight text-text-muted">{message.snippet}</span> : null}
      </span>
    </button>
  )
}

// A thread in the reader, as Apple Mail shows one: its mails oldest first,
// the newest and the unread ones open, the others folded to a row that
// opens them. Hairlines between them. One mail alone reads as before.
// `folder`: the one it's read from (its trash or junk mails only there).
// `onLoaded(messages)` once its mails are known (to mark them read), and
// again with the fresh list when it opened from the cache.
// `backLabel`: the folder the back button returns to.
export function MailThread({ id, folder, webmailHref, onBack, onLoaded, backLabel }) {
  // A thread already seen opens at once (refreshed behind); a new one waits
  // for the mails it opens with too, so its one skeleton gives way to the
  // whole thread rather than to each mail's own.
  const [state, setState] = useState(() => {
    const cached = readyThread(id, folder)
    return cached ? { status: 'ok', messages: cached } : { status: 'loading', messages: [] }
  })
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(() => new Set(state.messages.length ? initiallyOpen(state.messages) : []))
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    onLoadedRef.current = onLoaded
  })
  // The mails already handed to onLoaded as unread while this thread is
  // shown. A thread opened from the cache reports twice (the cached copy at
  // once, the fresh one behind it): the second time those count as read, so
  // only mails new since then (arrived in the thread meanwhile) are marked.
  const reportedUnreadRef = useRef(new Set())

  useEffect(() => {
    let cancelled = false
    const report = (messages) => {
      const reported = reportedUnreadRef.current
      const fresh = messages.map((message) => (message.unread && reported.has(message.id) ? { ...message, unread: false } : message))
      for (const message of messages) if (message.unread) reported.add(message.id)
      onLoadedRef.current?.(fresh)
    }
    const cached = readyThread(id, folder)
    if (cached) {
      setState({ status: 'ok', messages: cached })
      report(cached)
    } else {
      setState({ status: 'loading', messages: [] })
    }
    // A list just fetched by the row's hover (or still on its way) is used
    // as is, its bodies are what's missing; a thread shown from the cache is
    // refreshed behind.
    const listed = cached ? null : threadCache.get(threadKey(id, folder))
    const thread = listed ? Promise.resolve(listed) : fetchThread(id, folder)
    thread
      .then(async (messages) => {
        // Unseen: its open mails' bodies first (a failed one shows its own
        // error once there).
        if (!cached) await Promise.allSettled(initiallyOpen(messages).map((messageId) => loadMessage(messageId)))
        if (cancelled) return
        setExpanded((current) => new Set([...(cached ? current : []), ...initiallyOpen(messages)]))
        setState({ status: messages.length ? 'ok' : 'error', messages })
        // From the cache too: the fresh list may hold mails the cached one
        // didn't (they'd never be marked read otherwise).
        if (messages.length) report(messages)
        // Read now or soon (onLoaded marks them so, a mail the page opened
        // itself after a short wait): a later opening shows them read.
        remember(threadCache, threadKey(id, folder), messages.map((message) => ({ ...message, unread: false })))
      })
      .catch(() => {
        if (!cancelled && !cached) setState({ status: 'error', messages: [] })
      })
    return () => {
      cancelled = true
    }
  }, [id, folder, attempt])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) onBack()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

  const { messages } = state
  return (
    <div className="mail-push-in grid gap-4 min-w-0" aria-busy={state.status === 'loading' || undefined}>
      <ReaderBackRow onBack={onBack} label={backLabel} />
      {state.status === 'loading' ? <MailReaderPlaceholder /> : null}
      {state.status === 'error' ? (
        <div className="grid justify-items-start gap-3">
          <p className="m-0 text-[14px] text-text-muted">Ce fil n’a pas chargé</p>
          <button type="button" className={SECONDARY_BUTTON_CLASSES} onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>
        </div>
      ) : null}
      {state.status === 'ok' && messages.length > 1 ? (
        <p className="m-0 -mb-1 text-[12.5px] font-semibold text-text-muted">{messages.length} mails dans ce fil</p>
      ) : null}
      {state.status === 'ok' ? messages.map((message, index) => (
        <div key={message.id} className={`min-w-0 ${index > 0 ? 'border-t border-border pt-4' : ''}`}>
          {expanded.has(message.id) ? (
            <MailReader
              id={message.id}
              webmailHref={webmailHref}
              onBack={onBack}
              embedded
              autoFocus={index === messages.length - 1}
            />
          ) : (
            <ThreadFoldedMail message={message} onExpand={() => setExpanded((current) => new Set(current).add(message.id))} />
          )}
        </div>
      )) : null}
    </div>
  )
}

export default MailReader
