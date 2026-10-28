import { Fragment, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Selection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { Indent } from '../tiptapIndent'
import { withViewTransition } from '../viewTransition'
import { MailSignature } from '../mailSignatureNode'
import { MailSignatureContext } from '../mailSignatureContext'
import { useComposerSignature, useSignatureNodeSync } from '../useComposerSignature'
import CloseButton from './CloseButton'
import ConfirmDialog from './ConfirmDialog'
import ContextMenu from './ContextMenu'
import Tooltip from './Tooltip'
import Switch from './Switch'
import MailDropSheets from './MailDropSheets'
import { TOOLBAR_BUTTON_CLASSES } from './MailToolbar'
import { getSenderBadgeStyle, getSenderInitial } from './mailSender'
import FileName from './FileName'
import { getMailRecipientSuggestions, uploadMailAttachment } from '../entApi'
import {
  FILESENDER_URL,
  checkNewAttachments,
  formatAttachmentLimit,
  formatAttachmentSize,
  getAttachmentIcon,
  getAttachmentKind,
  isRefusedAttachment,
  messageAttachmentItems,
  normalizeAttachmentType,
  readAttachmentLimits,
  sanitizeAttachmentName,
} from '../mailAttachments'
import {
  MAX_ADDRESS_LENGTH,
  MAX_RECIPIENTS,
  RECIPIENT_QUERY_MIN_LENGTH,
  buildDraftFields,
  cleanRecipientSuggestions,
  formatRecipient,
  highlightRecipientMatch,
  isValidAddress,
  matchesRecipientQuery,
  mergeAddresses,
  normalizeRecipientQuery,
  parseRecipientText,
  parseTypedRecipients,
  quoteHeader,
  recipientKey,
  tidyQuotedText,
} from '../mailCompose'
import { composeOrigin, pickDefaultIdentity, sendFailureText } from '../mailSendPayload'

// The window a new mail is written in, in the spirit of Apple Mail's: a
// toolbar of glass pills (the kind of reply, attachments, then the round
// send button), the fields (À, then Cc and Cci behind « + », Objet, De),
// the format bar (always shown), then the text. The recipients' fields
// suggest from the webmail's contacts and directory (RecipientInput).
//
// « Envoyer » hands the mail to MailPage (src/useMailSend.js), which closes
// the window at once and sends it after a few seconds' « Annuler »; a
// failure reopens it as it was, the reason said. The attachments
// (AttachmentChip, useAttachments): a forwarded mail's stay in the mailbox
// (a reference to each), a file picked, dropped or pasted goes to the
// webmail as soon as it's added, while the mail is written, and is then
// held by its id there. The draft is saved to the webmail's Drafts folder
// a few seconds after each change (its `saver`, src/mailDraftSaver.js),
// never in the browser's storage: the app is used on shared computers.
// Closing one that was changed asks: save it, or delete it.
//
// From 1024 px a window floating over the bottom right of the page, which
// stays usable around it (non-modal: the mail answered can still be read);
// below, a sheet over the whole screen, as iOS Mail's, its focus held inside.

const KIND_TITLES = { new: 'Nouveau message', reply: 'Répondre', 'reply-all': 'Répondre à tous', forward: 'Transférer' }
const KIND_ICONS = { new: 'carbon:reply', reply: 'carbon:reply', 'reply-all': 'carbon:reply-all', forward: 'carbon:reply' }
const PHONE_QUERY = '(max-width: 1023px)'
const NOTICE_MS = 3200
// A token dragged from one recipients' field to another (RecipientInput).
const RECIPIENT_DRAG_TYPE = 'application/x-tafac-recipient'
const RECIPIENT_FIELDS = ['to', 'cc', 'bcc']
// A handful, for a rough first version: no search, no categories.
const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

// The format bar's choices. Sizes in pixels, the text's own being 16 (no
// mark then); « Inter » is the text's own font (none set either).
const BLOCK_OPTIONS = [
  { value: 'p', label: 'Corps' },
  { value: 'h2', label: 'Titre' },
  { value: 'h3', label: 'Sous-titre' },
  { value: 'blockquote', label: 'Citation' },
]
const FONT_OPTIONS = [
  { value: 'inter', label: 'Inter', family: 'Inter Variable, system-ui, sans-serif' },
  { value: 'georgia', label: 'Georgia', family: 'Georgia, serif' },
  { value: 'mono', label: 'Menlo', family: 'ui-monospace, Menlo, monospace' },
]
const SIZE_OPTIONS = [
  { value: '10px', label: '10' },
  { value: '13px', label: '13' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '24px', label: '24' },
  { value: '32px', label: '32' },
]
const DEFAULT_SIZE = '16px'
// A short palette each, as a mail needs: the first takes the colour off.
const TEXT_COLORS = [
  { value: '', label: 'Automatique' },
  { value: '#d1342f', label: 'Rouge' },
  { value: '#e8710a', label: 'Orange' },
  { value: '#1e8e3e', label: 'Vert' },
  { value: '#1a73e8', label: 'Bleu' },
  { value: '#8430ce', label: 'Violet' },
  { value: '#6b625b', label: 'Gris' },
]
const HIGHLIGHT_COLORS = [
  { value: '', label: 'Aucun' },
  { value: '#fff3a3', label: 'Jaune' },
  { value: '#c8f2c2', label: 'Vert' },
  { value: '#cfe5ff', label: 'Bleu' },
  { value: '#ffd5df', label: 'Rose' },
  { value: '#ffe2bd', label: 'Orange' },
]
const EMPTY_FORMAT = { bold: false, italic: false, underline: false, strikeThrough: false, unorderedList: false, orderedList: false, size: DEFAULT_SIZE, block: 'p', font: 'inter', color: '', highlight: '', inList: false, canIndent: false, canOutdent: false }

// The editor (Tiptap, on ProseMirror): what the text may hold, no more than
// the format bar offers. Links typed or pasted become links, never opened by
// a click while writing. No code, code blocks or rules: nothing for them.
const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    code: false,
    codeBlock: false,
    horizontalRule: false,
    heading: { levels: [2, 3] },
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
  }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  // Ranked above TextStyle (101): the highlight wraps a coloured text
  // (<mark><span style="color">), so the dark text it sets (overrides.css,
  // and the sent mail's) leaves a chosen colour as it is.
  Highlight.extend({ priority: 110 }).configure({ multicolor: true }),
  Indent,
  MailSignature,
]

// The switch's label, by the signature's kind (Réglages › Messagerie).
const SIGNATURE_LABELS = { auto: 'Signature automatique', partage: 'Signature Partage', custom: 'Signature personnalisée' }

function subscribePhone(callback) {
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

const isPhoneNow = () => window.matchMedia(PHONE_QUERY).matches

// The text of a mail, for the quote under a reply: never its html, which
// came from anyone and must not run in the app's own page (the reader keeps
// it in a sandboxed frame). A DOMParser document is inert: no script runs,
// no image loads. Blocks and line breaks become new lines, the source's own
// line breaks spaces (as a browser shows them), but not in a plain-text
// mail, whose lines are its own (the server wraps it in .tafac-mail-text).
function htmlToQuotedText(html) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return ''
  body.querySelectorAll('script, style, template, title, head').forEach((node) => node.remove())
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('pre, .tafac-mail-text')) node.data = node.data.replace(/\s+/g, ' ')
  }
  body.querySelectorAll('br').forEach((node) => node.replaceWith('\n'))
  body.querySelectorAll('li').forEach((node) => node.prepend('• '))
  body.querySelectorAll('td, th').forEach((node) => node.append(' '))
  body.querySelectorAll('div, li, tr, pre, hr, table, ul, ol').forEach((node) => node.append('\n'))
  // A paragraph or a heading ends with an empty line, as it reads.
  body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote').forEach((node) => node.append('\n\n'))
  return tidyQuotedText(body.textContent.split('\n').map((line) => line.trim()).join('\n'))
}

// Plain text as the editor's nodes, a paragraph a line: what's pasted or
// dropped, a quote. Text nodes only, never parsed as html (a « <b> » typed
// in the source stays those characters).
function textToParagraphs(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
}

// Several lines in one paragraph, broken (the quote's header line: one
// paragraph, so a switch of the reply's kind finds and rewrites it whole).
function linesToParagraph(text) {
  const content = String(text ?? '').split('\n').flatMap((line, index) => [
    ...(index ? [{ type: 'hardBreak' }] : []),
    ...(line ? [{ type: 'text', text: line }] : []),
  ])
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

// A resumed draft's HTML with the signature's placeholder (`include`) where
// the composer puts it (syncSignatureNode): before a reply's quote and its
// header line (and the empty line above them), else at the end. Zimbra
// keeps the draft's HTML but not the placeholder's data attribute.
function withSignaturePlaceholder(html, include) {
  if (!include || /data-mail-signature/.test(html) || typeof DOMParser === 'undefined') return html
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  const blocks = [...body.children]
  const quoteIndex = blocks.findIndex((block) => block.tagName === 'BLOCKQUOTE')
  let before = null
  if (quoteIndex >= 1) {
    let headerIndex = quoteIndex - 1
    if (headerIndex >= 1 && blocks[headerIndex - 1].tagName === 'P' && !blocks[headerIndex - 1].textContent.trim()) headerIndex -= 1
    before = blocks[headerIndex]
  }
  const placeholder = body.ownerDocument.createElement('div')
  placeholder.setAttribute('data-mail-signature', '')
  body.insertBefore(placeholder, before)
  return body.innerHTML
}

// The text a draft opens with: an empty line to write on, the signature
// (`withSignature`), then for a reply or a forward the line naming the mail
// and its text, quoted.
function buildInitialContent(message, kind, withSignature = false) {
  const content = [{ type: 'paragraph' }]
  if (withSignature) content.push({ type: 'mailSignature' })
  if (message && kind !== 'new') {
    const quoted = textToParagraphs(htmlToQuotedText(message.html))
    content.push({ type: 'paragraph' }, linesToParagraph(quoteHeader(message, kind)), { type: 'blockquote', content: quoted.length ? quoted : [{ type: 'paragraph' }] })
  }
  return { type: 'doc', content }
}

// What the selection in the text is, for the format bar to show (bold
// pressed, the size picked…), from the editor's own state.
function readFormatState(editor) {
  // Not ready yet (no schema until it's set up) or already gone.
  if (!editor || editor.isDestroyed || !editor.schema) return EMPTY_FORMAT
  const style = editor.getAttributes('textStyle')
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strikeThrough: editor.isActive('strike'),
    unorderedList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    size: SIZE_OPTIONS.some((option) => option.value === style.fontSize) ? style.fontSize : DEFAULT_SIZE,
    block: editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : editor.isActive('blockquote') ? 'blockquote' : 'p',
    font: FONT_OPTIONS.find((option) => option.family === style.fontFamily)?.value ?? 'inter',
    color: style.color ?? '',
    highlight: editor.getAttributes('highlight').color ?? '',
    // In a list its items nest; elsewhere the paragraphs indent (tiptapIndent).
    inList: editor.isActive('listItem'),
    canIndent: editor.isActive('listItem') ? editor.can().sinkListItem('listItem') : editor.can().indent(),
    canOutdent: editor.isActive('listItem') ? editor.can().liftListItem('listItem') : editor.can().outdent(),
  }
}

// A token of À, Cc or Cci: a small badge and the name (the address when
// that's all there is), bare as the reader's chips (RecipientChip), with a
// × taking it out; its full address in a tooltip. An address that isn't
// one stays as a token too, in red, to be fixed (a double click puts it
// back into the field). Clicked, it's selected (focused): Backspace or
// Delete takes it out, Enter edits it, the arrows move along the tokens.
// Not in the Tab order (the field is): the arrows reach it from there.
// Dragged, it moves to another field (MailComposer's moveRecipient).
function RecipientToken({ address, field, hintId, onRemove, onEdit, onKeyDown }) {
  const label = address.name || address.email
  const badgeStyle = address.invalid ? null : getSenderBadgeStyle(address.email.toLowerCase())
  const spoken = address.invalid
    ? `${address.email}, ${address.refused ? 'adresse refusée' : 'adresse non valide'}`
    : address.name ? `${address.name}, ${address.email}` : address.email
  return (
    <span
      className="group relative inline-flex h-7 min-w-0 max-w-full items-center max-4xl:h-8"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copyMove'
        event.dataTransfer.setData(RECIPIENT_DRAG_TYPE, JSON.stringify({ field, key: recipientKey(address) }))
        event.dataTransfer.setData('text/plain', formatRecipient(address))
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        data-recipient-token=""
        className="mail-recipient-token group/token -ml-[4px] inline-flex h-full min-w-0 items-center gap-[7px] rounded-full border-0 bg-transparent py-0 pl-[4px] pr-[6px] cursor-default transition-colors duration-100 focus:bg-text focus:outline-none"
        aria-label={spoken}
        aria-describedby={hintId}
        onClick={(event) => {
          event.stopPropagation()
          // Safari doesn't focus a clicked button by itself.
          event.currentTarget.focus()
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          onEdit()
        }}
        onKeyDown={onKeyDown}
      >
        {address.invalid ? (
          <span className="inline-flex size-5 shrink-0 items-center justify-center text-error group-focus/token:text-bg" aria-hidden="true"><Icon icon="carbon:warning-alt-filled" className="size-[17px]" /></span>
        ) : (
          <span
            className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
            style={badgeStyle ?? undefined}
            aria-hidden="true"
          >
            {getSenderInitial(label)}
          </span>
        )}
        <span className={`min-w-0 truncate text-[13.5px] font-medium leading-none group-focus/token:text-bg max-4xl:text-[15px] ${address.invalid ? 'text-error underline decoration-dotted underline-offset-[3px] group-focus/token:no-underline' : 'text-text'}`}>{label}</span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="-ml-[5px] inline-flex size-5 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-muted cursor-pointer transition-colors duration-120 hover:bg-bg-subtle hover:text-text max-4xl:size-8 max-4xl:-ml-[8px] max-4xl:-mr-[6px]"
        aria-label={`Retirer ${label}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
      >
        <Icon icon="carbon:close" className="size-[13px]" aria-hidden="true" />
      </button>
      <Tooltip
        title={address.invalid ? (address.refused ? 'Adresse refusée' : 'Adresse non valide') : address.name || address.email}
        detail={address.invalid ? address.email : address.name ? address.email : null}
        side="bottom-start"
        className="max-4xl:hidden"
      />
    </span>
  )
}

// What the field's suggestions show of a name or an address: the parts the
// typed words start in bold (highlightRecipientMatch).
function MatchedText({ text, query }) {
  return highlightRecipientMatch(text, query).map((piece, index) => (
    piece.match ? <strong key={index} className="font-semibold text-text">{piece.text}</strong> : <Fragment key={index}>{piece.text}</Fragment>
  ))
}

// The suggestions already fetched while the composer is open, by query: a
// letter typed then taken back asks nothing again. In memory only (never
// localStorage: the directory's answers stay out of the browser's storage),
// gone with the composer; the oldest dropped past a few dozen.
const SUGGESTION_CACHE_SIZE = 40

function createSuggestionCache() {
  const entries = new Map()
  return {
    get: (query) => entries.get(query),
    set: (query, items) => {
      entries.delete(query)
      entries.set(query, items)
      if (entries.size > SUGGESTION_CACHE_SIZE) entries.delete(entries.keys().next().value)
    },
  }
}

// How long the typing pauses before the server is asked, and before a
// search still running shows « Recherche… » (a quick answer never does).
const SUGGESTION_DELAY_MS = 160
const SUGGESTION_SLOW_MS = 600

// The suggestions for what's typed in a field: the cached ones, the
// server's once they come, or meanwhile the last ones that still match (so
// the list narrows as the typing goes on instead of blinking). `status`:
// 'idle' (nothing to look for), 'loading', 'ok' or 'error'; `slow` a search
// still running after SUGGESTION_SLOW_MS.
function useRecipientSuggestions(query, enabled, cache) {
  const [response, setResponse] = useState({ query: '', items: [], status: 'idle' })
  const [slowQuery, setSlowQuery] = useState('')
  const searching = enabled && query.length >= RECIPIENT_QUERY_MIN_LENGTH
  const cached = searching ? cache.get(query) : undefined

  useEffect(() => {
    if (!searching || cache.get(query)) return undefined
    const controller = new AbortController()
    const slowTimer = window.setTimeout(() => setSlowQuery(query), SUGGESTION_SLOW_MS)
    const timer = window.setTimeout(async () => {
      const result = await getMailRecipientSuggestions(query, { signal: controller.signal })
      if (controller.signal.aborted || result.status === 'aborted') return
      window.clearTimeout(slowTimer)
      const failed = result.status === 'error'
      // Checked again here, whatever the server said (cleanRecipientSuggestions).
      const items = failed ? [] : cleanRecipientSuggestions(result.suggestions)
      if (!failed) cache.set(query, items)
      setResponse({ query, items, status: failed ? 'error' : 'ok' })
    }, SUGGESTION_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(slowTimer)
      controller.abort()
    }
  }, [searching, query, cache])

  if (!searching) return { items: [], status: 'idle', slow: false }
  if (cached) return { items: cached, status: 'ok', slow: false }
  if (response.query === query) return { items: response.items, status: response.status, slow: false }
  return {
    items: response.status === 'ok' ? response.items.filter((item) => matchesRecipientQuery(item, query)) : [],
    status: 'loading',
    slow: slowQuery === query,
  }
}

// À, Cc or Cci: the tokens, then the field, a combobox with its list of
// suggestions under it (the contacts, past correspondents and directory,
// useRecipientSuggestions). A comma, a semicolon, Enter or leaving the
// field turns what was typed into tokens; a pasted list is cut the same way
// (parseTypedRecipients). In the list, the arrows move, Enter, Tab or a
// click picks, Escape closes it (and only it: the composer stays). The first
// suggestion is picked by Enter unless what's typed is an address already.
// Backspace or ← in the empty field goes onto the last token. `exclude`:
// the other fields' tokens, never added twice nor suggested. The text size
// is the row's: an <input> takes its font from index.css's
// `input { font: inherit }`.
function RecipientInput({ id, field, label, tokens, onTokensChange, value, onValueChange, inputRef, exclude, cache, onNotice, onMove }) {
  const listId = useId()
  const hintId = useId()
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const scrollActiveRef = useRef(false)
  const [focused, setFocused] = useState(false)
  // The query Escape closed the list for: it opens again as the typing goes on.
  const [dismissedQuery, setDismissedQuery] = useState(null)
  const [activeEmail, setActiveEmail] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  const query = normalizeRecipientQuery(value)
  const suggestions = useRecipientSuggestions(query, focused, cache)
  const taken = new Set([...tokens, ...exclude].map(recipientKey))
  const items = suggestions.items.filter((item) => !taken.has(recipientKey(item)))
  const typedAddress = isValidAddress(value)
  const active = items.find((item) => item.email === activeEmail) ?? (typedAddress ? null : items[0] ?? null)
  const showSlow = suggestions.slow && !items.length
  const showError = suggestions.status === 'error' && !items.length
  const open = focused && dismissedQuery !== query && (items.length > 0 || showSlow || showError)
  const optionId = (index) => `${listId}-${index}`
  const activeIndex = active ? items.indexOf(active) : -1

  // Tokens added, at most what MAX_RECIPIENTS leaves room for (it says so).
  const addTokens = (added, base = tokens) => {
    if (!added.length) return
    const merged = mergeAddresses(base, added, exclude)
    const known = new Set([...base, ...exclude].map(recipientKey))
    const fresh = new Set(added.map(recipientKey).filter((key) => !known.has(key)))
    if (fresh.size > merged.length - base.length) onNotice(`${MAX_RECIPIENTS} destinataires au plus`)
    onTokensChange(merged)
  }
  const commitAll = (text) => {
    addTokens(parseRecipientText(text))
    onValueChange('')
  }
  const pick = (suggestion) => {
    addTokens([suggestion])
    onValueChange('')
    setActiveEmail(null)
    inputRef.current?.focus()
  }

  const tokenButtons = () => [...(rootRef.current?.querySelectorAll('[data-recipient-token]') ?? [])]
  const focusToken = (index) => {
    const buttons = tokenButtons()
    if (index >= 0 && index < buttons.length) buttons[index].focus()
    else inputRef.current?.focus()
  }
  const removeToken = (address, nextFocus) => {
    onTokensChange(tokens.filter((entry) => entry !== address))
    window.requestAnimationFrame(() => focusToken(nextFocus))
  }
  // Back into the field as text (« Nom <adresse> »), selected: what was
  // being typed there becomes a token first.
  const editToken = (address) => {
    const remaining = tokens.filter((entry) => entry !== address)
    if (value.trim()) addTokens(parseRecipientText(value), remaining)
    else onTokensChange(remaining)
    onValueChange(formatRecipient(address))
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }
  const handleTokenKeyDown = (event, address, index) => {
    // ⌘/Ctrl+Enter is still the composer's (send), Tab moves on.
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      removeToken(address, event.key === 'Backspace' ? (index > 0 ? index - 1 : tokens.length - 1) : index)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusToken(Math.max(0, index - 1))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusToken(index + 1)
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      editToken(address)
    } else if (event.key.length === 1) {
      // A letter typed over a token goes on in the field, as in Apple Mail
      // (moving the focus alone would lose it: the key is the token's).
      event.preventDefault()
      onValueChange(value + event.key)
      inputRef.current?.focus()
    }
  }

  const moveActive = (step) => {
    if (!items.length) return
    scrollActiveRef.current = true
    const next = activeIndex === -1 ? (step > 0 ? 0 : items.length - 1) : (activeIndex + step + items.length) % items.length
    setActiveEmail(items[next].email)
  }

  const handleKeyDown = (event) => {
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    if (event.key === 'ArrowDown' && plain && items.length) {
      event.preventDefault()
      if (!open) setDismissedQuery(null)
      else moveActive(1)
    } else if (event.key === 'ArrowUp' && plain && open) {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === 'Escape' && open) {
      // The list only: MailComposer's Escape skips a handled event.
      event.preventDefault()
      setDismissedQuery(query)
    } else if (event.key === 'Enter' && plain) {
      if (open && active) {
        event.preventDefault()
        pick(active)
      } else if (value.trim()) {
        event.preventDefault()
        commitAll(value)
      }
    } else if ((event.key === 'Tab' && !event.shiftKey && plain) || event.key === ',' || event.key === ';') {
      // Tab or a separator takes the suggestion lit; Tab again moves on.
      if (open && active) {
        event.preventDefault()
        pick(active)
      }
    } else if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && !value && tokens.length) {
      event.preventDefault()
      focusToken(tokens.length - 1)
    }
  }

  // The suggestion the arrows lit kept in sight in a list that scrolls (not
  // one the pointer lit: the list would slide under it).
  useEffect(() => {
    if (!scrollActiveRef.current) return
    scrollActiveRef.current = false
    if (open && activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' })
  })

  // The list's height: down to the visible bottom of the composer, above
  // a phone's keyboard (the visual viewport shrinks for it; the sheet,
  // fixed to the layout viewport, doesn't).
  useEffect(() => {
    const list = listRef.current
    if (!open || !list) return undefined
    const viewport = window.visualViewport
    const update = () => {
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
      const frameBottom = list.closest('.mail-composer')?.getBoundingClientRect().bottom ?? visibleBottom
      const room = Math.min(visibleBottom, frameBottom) - list.getBoundingClientRect().top - 12
      list.style.maxHeight = `${Math.max(132, Math.min(360, room))}px`
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [open])

  const isRecipientDrag = (event) => [...event.dataTransfer.types].includes(RECIPIENT_DRAG_TYPE)

  return (
    <div
      ref={rootRef}
      className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[10px] py-[6px] transition-[background-color] duration-120 ${dragOver ? 'bg-bg-subtle' : ''}`}
      onClick={() => inputRef.current?.focus()}
      onDragOver={(event) => {
        if (!isRecipientDrag(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false)
      }}
      onDrop={(event) => {
        setDragOver(false)
        if (!isRecipientDrag(event)) return
        event.preventDefault()
        try {
          const { field: from, key } = JSON.parse(event.dataTransfer.getData(RECIPIENT_DRAG_TYPE))
          if (from !== field) onMove(from, key, field)
          inputRef.current?.focus()
        } catch {
          // Not one of ours after all.
        }
      }}
    >
      {tokens.map((address, index) => (
        <RecipientToken
          key={recipientKey(address)}
          address={address}
          field={field}
          hintId={hintId}
          onRemove={() => removeToken(address, -1)}
          onEdit={() => editToken(address)}
          onKeyDown={(event) => handleTokenKeyDown(event, address, index)}
        />
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={MAX_ADDRESS_LENGTH * 2}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-describedby={tokens.length ? `${hintId}-field` : undefined}
        value={value}
        className="mail-composer-input h-7 min-w-[120px] flex-1 border-0 bg-transparent p-0 text-text max-4xl:h-8"
        onChange={(event) => {
          const next = event.target.value
          const { recipients, rest } = parseTypedRecipients(next)
          if (rest !== next) addTokens(recipients)
          // No leading space (the one typed after a comma, as in « a@b.fr, »).
          onValueChange(rest.trimStart())
          setDismissedQuery(null)
        }}
        onPaste={(event) => {
          // A list pasted (« A <a@x.fr>, b@y.fr; c@z.fr », one a line, or
          // split by spaces): cut here, as a text field would otherwise
          // drop its line breaks and glue the addresses together.
          const pasted = event.clipboardData?.getData('text/plain') ?? ''
          const several = /[,;\r\n]/.test(pasted) || (/\S\s+\S/.test(pasted.trim()) && (pasted.match(/@/g)?.length ?? 0) > 1)
          if (!several) return
          event.preventDefault()
          const input = event.currentTarget
          const text = value.slice(0, input.selectionStart ?? value.length) + pasted + value.slice(input.selectionEnd ?? value.length)
          const { recipients, rest } = parseTypedRecipients(/[,;\r\n]/.test(pasted) ? text : text.replace(/\s+/g, ', '))
          // Its last piece too when it's a whole address already (a list
          // pasted ends without a comma); a name being typed stays.
          const last = parseRecipientText(rest)
          const complete = last.length > 0 && last.every((address) => !address.invalid)
          addTokens(complete ? [...recipients, ...last] : recipients)
          onValueChange(complete ? '' : rest)
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setActiveEmail(null)
          // Not when the whole window loses the focus (another app, a tab):
          // the half-typed name is still being written.
          if (value.trim() && document.hasFocus()) commitAll(value)
        }}
      />
      <span id={hintId} hidden>Retour arrière pour retirer, Entrée pour modifier</span>
      <span id={`${hintId}-field`} hidden>Flèche gauche pour parcourir les destinataires</span>
      {/* How many suggestions, for a screen reader (the list itself isn't announced as it changes). */}
      <span className="sr-only" aria-live="polite">
        {open && items.length ? `${items.length} suggestion${items.length > 1 ? 's' : ''}` : ''}
      </span>
      {open ? (
        <div
          ref={listRef}
          className="mail-recipient-list absolute top-[calc(100%-2px)] left-3 right-3 z-20 overflow-y-auto overscroll-contain border border-border corners-[16px] bg-context-bg p-[5px] shadow-[0_1px_3px_rgb(52_18_0/0.08),0_18px_44px_-12px_var(--color-shadow)] backdrop-blur-[16px] 4xl:right-auto 4xl:w-[400px] 4xl:max-w-[calc(100%-24px)]"
          // The field keeps the focus (and the keyboard stays up on a phone).
          onMouseDown={(event) => event.preventDefault()}
        >
          <ul id={listId} role="listbox" aria-label={`Suggestions, ${label}`} className="m-0 list-none p-0">
            {items.map((item, index) => {
              const isActive = index === activeIndex
              const badgeStyle = getSenderBadgeStyle(item.email.toLowerCase())
              return (
                <li
                  key={recipientKey(item)}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isActive}
                  className={`flex min-h-[44px] cursor-pointer items-center gap-[10px] corners-[11px] px-[10px] py-[6px] max-4xl:min-h-[52px] ${isActive ? 'bg-context-hover' : ''}`}
                  onMouseMove={() => {
                    if (!isActive) setActiveEmail(item.email)
                  }}
                  onClick={() => pick(item)}
                >
                  <span
                    className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
                    style={badgeStyle ?? undefined}
                    aria-hidden="true"
                  >
                    {item.kind === 'group' ? <Icon icon="carbon:user-multiple" className="size-[14px]" /> : getSenderInitial(item.name || item.email)}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-[3px]">
                    {item.name ? (
                      <span className="truncate text-[14px] font-medium leading-tight text-text"><MatchedText text={item.name} query={query} /></span>
                    ) : null}
                    <span className={`truncate leading-tight ${item.name ? 'text-[12.5px] text-text-muted' : 'text-[14px] font-medium text-text'}`}><MatchedText text={item.email} query={query} /></span>
                  </span>
                  {item.kind === 'group' ? <span className="shrink-0 text-[12px] font-medium leading-none text-text-muted">Liste</span> : null}
                </li>
              )
            })}
          </ul>
          {!items.length ? (
            <p className="m-0 flex min-h-[40px] items-center px-[10px] text-[13px] font-medium leading-tight text-text-muted" role="status">
              {showError ? 'Suggestions indisponibles' : 'Recherche…'}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// A row of the header: its label in muted text, then what it holds. A
// recipients' row (`top`) holds its label on the first line of tokens, and
// is where its suggestions list hangs from (`relative`).
function FieldRow({ label, htmlFor, top = false, children }) {
  return (
    <div className={`relative flex min-h-[42px] min-w-0 gap-2 border-b border-border px-5 max-4xl:px-4 ${top ? 'items-start' : 'items-center'}`}>
      <label htmlFor={htmlFor} className={`shrink-0 font-medium text-text-muted ${top ? 'py-[6px] leading-7 max-4xl:leading-8' : ''}`}>{label}</label>
      {children}
    </div>
  )
}

// A native select in the format bar's look: grey, its chevron drawn over.
// Native, so it opens as the system's list on a phone.
// A button of the composer's toolbar, as the reader's (MailToolbar): an
// icon, a chevron when it opens a menu, its tooltip below.
function ToolButton({ label, icon, iconClassName = '', disabled = false, menu = true, tooltipSide = 'bottom', onClick }) {
  return (
    <button
      type="button"
      className={`${TOOLBAR_BUTTON_CLASSES} ${menu ? '!w-auto gap-0.5 px-2.5' : ''}`}
      aria-label={label}
      aria-haspopup={menu ? 'menu' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={icon} className={`size-[18px] shrink-0 transition-transform duration-100 ease-out group-active:scale-[0.86] ${iconClassName}`} aria-hidden="true" />
      {menu ? <Icon icon="carbon:chevron-down" className="size-3 shrink-0 text-text-muted" aria-hidden="true" /> : null}
      <Tooltip title={label} side={tooltipSide} className="max-4xl:hidden" />
    </button>
  )
}

// One of the format bar's choices (paragraph style, font, size…): a pill
// showing the current one, its list in the app's own menu (ContextMenu)
// rather than the system's. `onOpen(event)`: MailComposer opens it there,
// under the pill. The editor keeps its selection meanwhile.
function FormatSelect({ label, value, options, onOpen, className = '' }) {
  const current = options.find((option) => option.value === value) ?? options[0]
  return (
    <button
      type="button"
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border-0 bg-bg-subtle pl-2.5 pr-2 text-text cursor-pointer transition-[background-color] duration-120 hover:bg-bg-muted aria-expanded:bg-bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text ${className}`}
      aria-label={`${label} : ${current?.label ?? ''}`}
      aria-haspopup="menu"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
    >
      {/* The font on a span: index.css gives buttons `font: inherit`, outside Tailwind's layers. */}
      <span className="text-[13px] font-medium leading-none">{current?.label}</span>
      <Icon icon="carbon:chevron-down" className="size-3 shrink-0 text-text-muted" aria-hidden="true" />
    </button>
  )
}

// A segmented group of the format bar (B I U S…), its buttons lit when on.
function FormatSegment({ children }) {
  return <span className="inline-flex shrink-0 items-center gap-px rounded-[9px] bg-bg-subtle p-[2px]">{children}</span>
}

// Pressed down, a button would take the focus from the text and with it the
// selection it acts on: mousedown is cancelled, the click still lands.
function FormatButton({ label, icon, pressed, onClick, haspopup, disabled = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-haspopup={haspopup}
      disabled={disabled}
      className="group relative inline-flex h-7 w-7 items-center justify-center rounded-[7px] border-0 bg-transparent text-text cursor-pointer transition-[background-color] duration-120 hover:bg-black/5 dark:hover:bg-white/10 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent aria-pressed:bg-widget-bg aria-pressed:shadow-[0_1px_2px_rgb(52_18_0/0.14)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-text"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon icon={icon} className="size-4" aria-hidden="true" />
      <Tooltip title={label} side="bottom" className="max-4xl:hidden" />
    </button>
  )
}

// The text and highlight colours: a mark over a bar of the colour in use
// (the text's own when none is set), its palette in the app's menu. The
// text's is a drawn « A », the highlight's a pen: Carbon's text-color and
// text-highlight read poorly that small.
function ColorButton({ label, kind, color, onOpen }) {
  return (
    <button
      type="button"
      className="group relative inline-flex h-7 w-7 flex-col items-center justify-center gap-[2px] rounded-[7px] border-0 bg-transparent text-text cursor-pointer transition-[background-color] duration-120 hover:bg-black/5 dark:hover:bg-white/10 aria-expanded:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-text"
      aria-label={label}
      aria-haspopup="menu"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
    >
      {kind === 'text' ? (
        <span className="text-[14px] font-bold leading-[14px] tracking-[-0.02em]" aria-hidden="true">A</span>
      ) : (
        <Icon icon="carbon:pen" className="size-[13px]" aria-hidden="true" />
      )}
      <span
        className={`h-[3px] w-[15px] rounded-full ${color ? '' : kind === 'text' ? 'bg-text' : 'border border-border'}`}
        style={color ? { backgroundColor: color } : undefined}
        aria-hidden="true"
      />
      <Tooltip title={label} side="bottom" className="max-4xl:hidden" />
    </button>
  )
}

// Two files go to the webmail at once; the others wait their turn.
const PARALLEL_UPLOADS = 2

// What a chip says under the file's name, by its state; an error in red.
const ATTACHMENT_ERRORS = {
  'too-large': 'Trop volumineux',
  total: 'Dépasse la limite du mail',
  'too-many': 'Trop de fichiers',
  empty: 'Fichier vide',
  rate: 'Trop d’envois, réessaie plus tard',
  expired: 'Session expirée',
  failed: 'Échec du chargement',
  // The webmail no longer has it (a send said so): uploaded again with a
  // retry, while the composer still holds the file.
  'expired-upload': 'À joindre de nouveau',
}
const RETRYABLE_ERRORS = new Set(['failed', 'rate', 'expired-upload'])

function attachmentDetail(item) {
  const size = formatAttachmentSize(item.size)
  if (item.status === 'queued') return 'En attente'
  if (item.status === 'uploading') return [`${Math.round((item.progress ?? 0) * 100)} %`, size].filter(Boolean).join(' · ')
  if (item.status === 'error') return item.error === 'too-large' && size ? `${ATTACHMENT_ERRORS[item.error]} · ${size}` : ATTACHMENT_ERRORS[item.error] ?? ATTACHMENT_ERRORS.failed
  return [getAttachmentKind({ name: item.name, type: item.contentType }), size].filter(Boolean).join(' · ')
}

// A ring filling as the file goes (or turning, while it waits), around
// nothing: the chip's icon gives way to it.
function UploadRing({ progress, waiting }) {
  const radius = 11
  const length = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 28 28" className={`size-[26px] -rotate-90 ${waiting ? 'animate-spin [animation-duration:1.4s]' : ''}`} aria-hidden="true">
      <circle cx="14" cy="14" r={radius} fill="none" strokeWidth="2.5" className="stroke-text/12" />
      <circle
        cx="14"
        cy="14"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-text transition-[stroke-dashoffset] duration-200 ease-out"
        strokeDasharray={length}
        strokeDashoffset={waiting ? length * 0.75 : length * (1 - Math.min(Math.max(progress, 0.02), 1))}
      />
    </svg>
  )
}

// One attachment of the draft, as a chip in the look of the reader's rows
// (the file's kind as an icon, its name cut in the middle, its kind and
// size): its ring while it goes, its error in red, a retry when that may
// help, × taking it out (and stopping its upload). The name in full in the
// tooltip. A whole row on a phone.
function AttachmentChip({ item, onRemove, onRetry = null }) {
  const busy = item.status === 'uploading' || item.status === 'queued'
  const failed = item.status === 'error'
  const detail = attachmentDetail(item)
  const percent = Math.round((item.progress ?? 0) * 100)
  return (
    <li
      className={`group relative flex h-[46px] w-[248px] min-w-0 items-center gap-[9px] rounded-[14px] pl-[9px] pr-[3px] max-sm:w-full ${failed ? 'bg-error/8 dark:bg-error/14' : 'bg-bg-subtle dark:bg-bg-muted'}`}
      aria-label={`${item.name}, ${detail}`}
    >
      <span
        className={`inline-flex size-[28px] shrink-0 items-center justify-center ${failed ? 'text-error' : 'text-text-muted'}`}
        {...(item.status === 'uploading'
          ? { role: 'progressbar', 'aria-label': `Chargement de ${item.name}`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent }
          : { 'aria-hidden': true })}
      >
        {busy ? <UploadRing progress={item.progress ?? 0} waiting={item.status === 'queued'} /> : (
          <Icon icon={failed ? 'carbon:warning-alt-filled' : getAttachmentIcon(item.contentType)} className="size-[19px]" />
        )}
      </span>
      <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-[4px]" aria-hidden="true">
        <span className="text-[13px] font-semibold leading-[1.15] text-text"><FileName name={item.name} /></span>
        <span className={`truncate text-[11.5px] font-medium leading-none tabular-nums ${failed ? 'text-error' : 'text-text-muted'}`}>{detail}</span>
      </span>
      {failed && onRetry && RETRYABLE_ERRORS.has(item.error) ? (
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-muted cursor-pointer transition-colors duration-120 hover:bg-black/5 hover:text-text dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-text"
          aria-label={`Réessayer ${item.name}`}
          onClick={onRetry}
        >
          <Icon icon="carbon:renew" className="size-[15px]" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="-ml-[3px] inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-muted cursor-pointer transition-colors duration-120 hover:bg-black/5 hover:text-text dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-text"
        aria-label={busy ? `Annuler ${item.name}` : `Retirer ${item.name}`}
        onClick={onRemove}
      >
        <Icon icon="carbon:close" className="size-[15px]" aria-hidden="true" />
      </button>
      <Tooltip title={item.name} detail={detail} side="bottom-start" className="max-4xl:hidden" />
    </li>
  )
}

// A file dragged over the page: its types hold 'Files' (not a token, nor
// text, dragged from the composer itself).
const isFileDrag = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files')

// The draft's attachments: `items` (forwarded ones by reference, uploads as
// they go) and what changes them. A file added is checked first
// (checkNewAttachments: none past the limits leaves the browser), then
// uploaded at once (uploadMailAttachment), PARALLEL_UPLOADS at a time, the
// others queued. One the webmail refused for its session is tried once
// more on its own (the server signs in again meanwhile). Removing one stops
// its upload; closing the composer stops them all. The files themselves are
// held here (a ref) only until they're uploaded: a retry needs them.
// The files themselves stay in memory (a ref) for as long as the composer
// is open, and go with a send to MailPage: one the webmail lost by the time
// it's sent can be uploaded again (`initialFiles`, a reopened composer's).
function useAttachments(initialItems, limits, initialFiles = null) {
  const [items, setItems] = useState(initialItems)
  const filesRef = useRef(initialFiles ?? new Map())
  const queueRef = useRef([])
  const abortsRef = useRef(new Map())
  const retriedRef = useRef(new Set())
  const counterRef = useRef(0)
  const closedRef = useRef(false)

  const update = useCallback((key, patch) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }, [])

  // Starts the queued uploads there's room for. Through a ref: an upload's
  // end starts the next.
  const pumpRef = useRef(null)
  const pump = useCallback(() => {
    while (!closedRef.current && abortsRef.current.size < PARALLEL_UPLOADS && queueRef.current.length) {
      const key = queueRef.current.shift()
      const file = filesRef.current.get(key)
      if (!file) continue
      update(key, { status: 'uploading', progress: 0, error: null })
      const { promise, abort } = uploadMailAttachment(file, {
        name: sanitizeAttachmentName(file.name),
        onProgress: (sent, total) => update(key, { progress: total ? sent / total : 0 }),
      })
      abortsRef.current.set(key, abort)
      void promise.then((result) => {
        abortsRef.current.delete(key)
        if (closedRef.current || result.status === 'aborted') {
          pumpRef.current?.()
          return
        }
        if (result.status === 'ok') {
          update(key, { status: 'ready', progress: 1, aid: result.attachment.aid, size: result.attachment.size, contentType: result.attachment.contentType })
        } else if (result.code === 'retry' && !retriedRef.current.has(key)) {
          retriedRef.current.add(key)
          queueRef.current.unshift(key)
          update(key, { status: 'queued', progress: 0 })
        } else {
          update(key, { status: 'error', error: result.code === 'retry' ? 'failed' : result.code })
        }
        pumpRef.current?.()
      })
    }
  }, [update])
  useEffect(() => {
    pumpRef.current = pump
  }, [pump])

  // Closed: every upload stops (the server then stops its own to Partage).
  useEffect(() => {
    const aborts = abortsRef.current
    closedRef.current = false
    return () => {
      closedRef.current = true
      queueRef.current = []
      for (const abort of aborts.values()) abort()
    }
  }, [])

  const add = (fileList) => {
    const files = [...(fileList ?? [])]
    if (!files.length) return
    const verdicts = checkNewAttachments(files, items, limits)
    const added = files.map((file, index) => {
      counterRef.current += 1
      const key = `upload:${counterRef.current}`
      if (!verdicts[index]) {
        filesRef.current.set(key, file)
        queueRef.current.push(key)
      }
      return {
        key,
        source: 'upload',
        name: sanitizeAttachmentName(file.name),
        size: file.size,
        contentType: normalizeAttachmentType(file.type),
        status: verdicts[index] ? 'error' : 'queued',
        error: verdicts[index],
        progress: 0,
      }
    })
    setItems((current) => [...current, ...added])
    pump()
  }

  const remove = (key) => {
    queueRef.current = queueRef.current.filter((entry) => entry !== key)
    filesRef.current.delete(key)
    abortsRef.current.get(key)?.()
    setItems((current) => current.filter((item) => item.key !== key))
  }

  const retry = (key) => {
    if (!filesRef.current.has(key)) return
    queueRef.current.push(key)
    update(key, { status: 'queued', progress: 0, error: null })
    pump()
  }

  // Uploads Partage no longer has (a draft save refused them): to attach
  // again (« À joindre de nouveau », retried from the file kept), left out
  // of the draft meanwhile so its saves go on.
  const markExpired = useCallback((aids) => {
    const expired = new Set(aids)
    setItems((current) => (current.some((item) => item.aid && expired.has(item.aid) && item.status === 'ready')
      ? current.map((item) => (item.aid && expired.has(item.aid) && item.status === 'ready' ? { ...item, status: 'error', error: 'expired-upload' } : item))
      : current))
  }, [])

  // A forwarded mail's in or out (a switch between reply and forward), the
  // uploads kept.
  const setMessageItems = (messageItems) => {
    setItems((current) => {
      const added = messageItems.filter((entry) => !current.some((item) => item.key === entry.key))
      const isOriginal = (item) => item.key.startsWith('message:')
      return [...current.filter((item) => !isOriginal(item) || messageItems.some((entry) => entry.key === item.key)), ...added]
        .sort((left, right) => (isOriginal(left) ? 0 : 1) - (isOriginal(right) ? 0 : 1))
    })
  }

  return { items, add, remove, retry, setMessageItems, markExpired, filesRef }
}

// How long the typing rests before the draft is saved (createDraftSaver).
const AUTOSAVE_DELAY_MS = 4500

// A reopened composer's tokens that the webmail refused (a send's
// `invalid`): marked, shown red until fixed.
function markRefused(list, refused) {
  if (!refused.size) return list
  return list.map((address) => (refused.has(address.email.toLowerCase()) ? { ...address, invalid: true, refused: true } : address))
}

// The fields a composer opens with: a draft resumed or a composer
// reopened (`restore`: its fields as they were, a failed send's refusals
// marked), else a new mail's or an answer's (buildDraftFields).
function readInitialFields(restore, sendError, kind, message, ownEmails) {
  if (!restore) return { ...buildDraftFields(kind, message, ownEmails), bcc: [] }
  const refused = new Set((sendError?.invalid ?? []).map((email) => email.toLowerCase()))
  const expired = new Set(sendError?.aids ?? [])
  return {
    to: markRefused(restore.to ?? [], refused),
    cc: markRefused(restore.cc ?? [], refused),
    bcc: markRefused(restore.bcc ?? [], refused),
    subject: restore.subject ?? '',
    attachments: (restore.attachments ?? []).map((item) => (item.aid && expired.has(item.aid) ? { ...item, status: 'error', error: 'expired-upload' } : item)),
  }
}

// `initialKind`: 'new', 'reply', 'reply-all' or 'forward'; `message` the
// mail answered or forwarded (getMailMessage's), null for a new one.
// `sender`: the student's { name, email, signature }, for « De : » and to
// leave them out of a « Répondre à tous ». `identities`: the addresses the
// account may send from ({ id, name, email }, the default first:
// getMailPrefs), « De : » a choice when there are several.
// `attachmentLimits`: { maxFileBytes, maxTotalBytes } from the webmail
// (getMailPrefs), the fallback's until they're known. `saver`: the draft's
// saves (createDraftSaver, MailPage's). `restore`: the composer as it was
// (a draft resumed, an undo, a failed send: { to, cc, bcc, subject,
// content (the editor's JSON) or html, attachments, files, identityId,
// origin, dirty }), `sendError` why a send failed (sendMail's). `onSend(
// snapshot)`: « Envoyer », MailPage closes it and sends (src/useMailSend.js);
// false when it can't (a send already waiting). `ref` gets { isDirty,
// saveNow }, for MailPage to save it before another draft takes its place.
// Keyed by MailPage: each draft starts afresh.
function MailComposer({ initialKind = 'new', message = null, sender = null, identities = [], attachmentLimits = null, saver = null, restore = null, sendError = null, ref = null, onClose, onSend }) {
  const isPhone = useSyncExternalStore(subscribePhone, isPhoneNow, () => false)
  const titleId = useId()
  const fieldId = useId()
  const [initialFields] = useState(() => readInitialFields(restore, sendError, initialKind, message, [sender?.email, ...identities.map((identity) => identity.email)]))
  const [kind, setKind] = useState(initialKind)
  const [to, setTo] = useState(initialFields.to)
  const [cc, setCc] = useState(initialFields.cc)
  const [bcc, setBcc] = useState(initialFields.bcc)
  // « De : »: an identity's id (null: the account's default, the server's).
  const [identityId, setIdentityId] = useState(() => restore?.identityId ?? pickDefaultIdentity(identities, message))
  const origin = composeOrigin(kind, message, restore?.origin)
  // The draft's saves: « Brouillon non enregistré » when one fails.
  const [draftStatus, setDraftStatus] = useState(() => saver?.status ?? 'idle')
  const [toInput, setToInput] = useState('')
  const [ccInput, setCcInput] = useState('')
  const [bccInput, setBccInput] = useState('')
  // The recipients' suggestions fetched while this draft is open
  // (createSuggestionCache), shared by its three fields.
  const [suggestionCache] = useState(createSuggestionCache)
  const [subject, setSubject] = useState(initialFields.subject)
  const limits = readAttachmentLimits(attachmentLimits)
  const { items: attachments, add: addAttachments, remove: removeAttachment, retry: retryAttachment, setMessageItems, markExpired, filesRef: attachmentFilesRef } = useAttachments(initialFields.attachments, limits, restore?.files)
  // A save refusing uploads gone from Partage: those files to attach again.
  useEffect(() => saver?.subscribe((status, failure) => {
    setDraftStatus(status)
    if (failure?.code === 'upload-expired' && failure.aids?.length) markExpired(failure.aids)
  }), [saver, markExpired])
  const fileInputRef = useRef(null)
  // A file dragged over the composer (the drop zone shows), counted by the
  // elements entered and left on its way.
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const [showCc, setShowCc] = useState(initialFields.cc.length > 0 || initialFields.bcc.length > 0)
  const [menu, setMenu] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirmingClose, setConfirmingClose] = useState(false)
  // Full screen (from 1024 px; a phone's sheet is already): the window's
  // frame grows into it as a UE's tile opens full page (the same view
  // transition, .mail-composer's view-transition classes).
  const [isFullscreen, setIsFullscreen] = useState(Boolean(restore?.isFullscreen))
  const toggleFullscreen = useCallback(() => withViewTransition(() => setIsFullscreen((value) => !value)), [])

  const rootRef = useRef(null)
  const toInputRef = useRef(null)
  const ccInputRef = useRef(null)
  const bccInputRef = useRef(null)
  // The draft as it opened (fields and the text's characters): a draft
  // still equal to it closes without asking.
  const initialSnapshotRef = useRef(null)
  const noticeTimerRef = useRef(null)
  // The editor, for its paste and drop handlers (given before it exists).
  const editorRef = useRef(null)

  // Pasted or dropped, only the text: html from elsewhere (a web page, a
  // mail) would bring its styles and anything else it carries. A move
  // inside the text itself stays the editor's own.
  const [editorProps] = useState(() => ({
    attributes: {
      class: 'mail-composer-body min-h-[220px] flex-1 px-5 py-4 text-[16px] leading-[1.5] text-text 4xl:overflow-y-auto 4xl:overscroll-contain max-4xl:px-4',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': 'Message',
      spellcheck: 'true',
    },
    // ⌘/Ctrl+Enter sends (the composer's own keydown): not the hard break
    // Tiptap gives it.
    handleKeyDown: (view, event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey),
    handlePaste: (view, event) => {
      const text = event.clipboardData?.getData('text/plain')
      if (text) editorRef.current?.chain().insertContent(textToParagraphs(text).length > 1 ? textToParagraphs(text) : { type: 'text', text }).run()
      return true
    },
    handleDrop: (view, event, slice, moved) => {
      if (moved) return false
      const text = event.dataTransfer?.getData('text/plain')
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (text && at) editorRef.current?.chain().focus().insertContentAt(at.pos, textToParagraphs(text).length > 1 ? textToParagraphs(text) : { type: 'text', text }).run()
      return true
    },
  }))
  // The signature: on or off and which (Réglages › Messagerie, shared with
  // it), the automatic one's lines (`sender.signature`, from App).
  const signature = useComposerSignature({
    autoSignature: sender?.signature?.name ? sender.signature : null,
    identityId,
    reply: Boolean(origin),
  })
  // A resumed draft's or a reopened composer's text, else a new one's. A
  // draft read back from Zimbra may have lost its signature's placeholder:
  // put back while the signature is on.
  const [initialContent] = useState(() => restore?.content
    ?? (restore?.html != null ? withSignaturePlaceholder(restore.html, signature.on) : null)
    ?? buildInitialContent(message, initialKind, signature.on))
  // Read by the editor's update (set up once): the autosave's timer.
  const scheduleAutosaveRef = useRef(() => {})
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: initialContent,
    editorProps,
    // The draft's starting point, once the editor holds its text (before
    // that, it has no schema to read the text with). A composer reopened
    // after an undo or a failure holds a mail not sent: always changed.
    onCreate: ({ editor: created }) => {
      if (initialSnapshotRef.current === null) {
        initialSnapshotRef.current = restore?.dirty
          ? 'unsent'
          : JSON.stringify([initialFields.to, initialFields.cc, initialFields.bcc, '', '', '', initialFields.subject.trim(), created.getText(), initialFields.attachments.map((item) => item.key)])
      }
    },
    onUpdate: () => scheduleAutosaveRef.current(),
  })
  // Before the effects below, which reach it through the ref.
  useEffect(() => {
    editorRef.current = editor
  }, [editor])
  // The format bar follows the selection (a re-render only when what it
  // shows changes).
  const format = useEditorState({ editor, selector: ({ editor: current }) => readFormatState(current) }) ?? EMPTY_FORMAT

  // In at À for a new mail or a forward, at the top of the text for a
  // reply (its recipients are there already); back where it was on close.
  useEffect(() => {
    const previous = document.activeElement
    if (initialKind !== 'reply' && initialKind !== 'reply-all') toInputRef.current?.focus({ preventScroll: true })
    return () => {
      window.clearTimeout(noticeTimerRef.current)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [initialKind])
  // A reply's caret, once the editor is in the page: until then it has no
  // commands (Tiptap mounts it a moment later, which a phone made visible:
  // the reply crashed), so on its « create » if it isn't ready yet. Set by
  // hand, then the focus: on a phone Tiptap's focus command focuses first,
  // whose own transaction made the command's stale (« mismatched
  // transaction »).
  const focusedStartRef = useRef(false)
  useEffect(() => {
    if (focusedStartRef.current || !editor || (initialKind !== 'reply' && initialKind !== 'reply-all')) return undefined
    const focusStart = () => {
      if (editor.isDestroyed || focusedStartRef.current) return
      focusedStartRef.current = true
      const { state, view } = editor
      view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)))
      view.focus()
    }
    if (editor.isInitialized) {
      focusStart()
      return undefined
    }
    editor.on('create', focusStart)
    return () => editor.off('create', focusStart)
  }, [editor, initialKind])

  // While the composer is open, a file dropped beside it (on the page under
  // the floating window) isn't opened by the browser in the draft's place.
  useEffect(() => {
    const guard = (event) => {
      if (isFileDrag(event)) event.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

  const isDirty = useCallback(() => {
    const current = editorRef.current
    const text = current && !current.isDestroyed && current.schema ? current.getText() : ''
    // The attachments by key: one added or taken out changes the draft
    // (one refused before it went doesn't count).
    const attached = attachments.filter((item) => !isRefusedAttachment(item)).map((item) => item.key)
    const snapshot = JSON.stringify([to, cc, bcc, toInput.trim(), ccInput.trim(), bccInput.trim(), subject.trim(), text, attached])
    return initialSnapshotRef.current !== null && snapshot !== initialSnapshotRef.current
  }, [to, cc, bcc, toInput, ccInput, bccInput, subject, attachments])

  // The draft as saved and sent (buildComposePayload): the tokens, and
  // what's typed in a field still (as a send would take it); the text as
  // the editor's HTML (the signature's placeholder where it sits); the
  // signature's kind and choices, never its HTML.
  const getDraftState = useCallback(() => {
    const current = editorRef.current
    const typed = { to: toInput, cc: ccInput, bcc: bccInput }
    const fields = { to, cc, bcc }
    for (const name of RECIPIENT_FIELDS) {
      if (!typed[name].trim()) continue
      const others = RECIPIENT_FIELDS.filter((other) => other !== name).flatMap((other) => fields[other])
      fields[name] = mergeAddresses(fields[name], parseRecipientText(typed[name]), others)
    }
    return {
      ...fields,
      subject,
      html: current && !current.isDestroyed && current.schema ? current.getHTML() : '',
      attachments,
      origin,
      identityId,
      signature: signature.payload,
    }
  }, [to, cc, bcc, toInput, ccInput, bccInput, subject, attachments, origin, identityId, signature.payload])

  const saveNow = useCallback(() => saver?.save(getDraftState()), [saver, getDraftState])

  useImperativeHandle(ref, () => ({ isDirty, saveNow }), [isDirty, saveNow])

  // Saved AUTOSAVE_DELAY_MS after the last change, once the draft differs
  // from how it opened (an untouched one makes no draft); the saver skips a
  // save that would change nothing. A resumed draft starts as saved.
  const autosaveTimerRef = useRef(null)
  useEffect(() => {
    scheduleAutosaveRef.current = () => {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = window.setTimeout(() => {
        if (saver && isDirty()) void saver.save(getDraftState())
      }, AUTOSAVE_DELAY_MS)
    }
  }, [saver, isDirty, getDraftState])
  useEffect(() => {
    scheduleAutosaveRef.current()
  }, [to, cc, bcc, subject, attachments, identityId, signature.payload])
  useEffect(() => () => window.clearTimeout(autosaveTimerRef.current), [])
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current || !editor || !restore || restore.dirty || !saver?.id) return
    resumedRef.current = true
    saver.markSaved(getDraftState())
  }, [editor, restore, saver, getDraftState])

  const showNotice = useCallback((text) => {
    window.clearTimeout(noticeTimerRef.current)
    setNotice({ key: Date.now(), text })
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  // Stable: ConfirmDialog's focus effect follows it.
  const cancelClose = useCallback(() => setConfirmingClose(false), [])

  const requestClose = useCallback(() => {
    if (isDirty()) setConfirmingClose(true)
    else onClose()
  }, [isDirty, onClose])

  // The close dialog's choices: kept in Brouillons (saved now, the saver
  // outliving the window), or deleted, as Apple Mail's « Supprimer ».
  const saveAndClose = useCallback(() => {
    void saver?.save(getDraftState())
    onClose()
  }, [saver, getDraftState, onClose])
  const discardAndClose = useCallback(() => {
    void saver?.discard()
    onClose()
  }, [saver, onClose])

  // A failed send reopened: its reason, the field to fix in focus.
  useEffect(() => {
    if (!sendError) return
    showNotice(sendFailureText(sendError))
  }, [sendError, showNotice])

  // What was typed in À, Cc and Cci becomes tokens first, one field after
  // the other (none adding what another has); then what a send would
  // refuse is said: an address that isn't one, no recipient at all, files
  // still uploading. Else the mail goes to MailPage (onSend), which closes
  // this and sends it; the server checks it all again (src/mailCompose.js's
  // isValidAddress and sanitizeDisplayName are shared for it). Once only:
  // a second press while it goes does nothing.
  const sendingRef = useRef(false)
  const send = useCallback(() => {
    if (sendingRef.current) return
    const next = { to, cc, bcc }
    const typed = { to: toInput, cc: ccInput, bcc: bccInput }
    for (const name of RECIPIENT_FIELDS) {
      if (!typed[name].trim()) continue
      const others = RECIPIENT_FIELDS.filter((other) => other !== name).flatMap((other) => next[other])
      next[name] = mergeAddresses(next[name], parseRecipientText(typed[name]), others)
    }
    setTo(next.to)
    setCc(next.cc)
    setBcc(next.bcc)
    setToInput('')
    setCcInput('')
    setBccInput('')
    const all = [...next.to, ...next.cc, ...next.bcc]
    if (all.some((address) => address.refused)) showNotice(all.filter((address) => address.refused).length > 1 ? 'Des adresses ont été refusées' : 'Une adresse a été refusée')
    else if (all.some((address) => address.invalid)) showNotice('Une adresse n’est pas valide')
    else if (!all.length) showNotice('Aucun destinataire')
    else if (attachments.some((item) => item.status === 'uploading' || item.status === 'queued')) showNotice('Pièces jointes en cours de chargement')
    else if (attachments.some((item) => item.status === 'error' && !isRefusedAttachment(item))) showNotice('Une pièce jointe n’est pas chargée')
    else {
      const current = editorRef.current
      sendingRef.current = true
      const accepted = onSend?.({
        kind,
        message,
        to: next.to,
        cc: next.cc,
        bcc: next.bcc,
        subject,
        content: current?.getJSON() ?? null,
        attachments,
        files: new Map(attachmentFilesRef.current),
        identityId,
        origin,
        isFullscreen,
        saver,
        dirty: true,
        state: { ...getDraftState(), to: next.to, cc: next.cc, bcc: next.bcc },
      })
      if (accepted === false) {
        sendingRef.current = false
        showNotice('Un message part déjà, réessaie dans un instant')
      }
    }
  }, [to, cc, bcc, toInput, ccInput, bccInput, attachments, showNotice, onSend, kind, message, subject, identityId, origin, isFullscreen, saver, getDraftState, attachmentFilesRef])

  // A format command on the text: back in it first, at the selection it
  // had (the editor keeps it while a select or a picker has the focus).
  // `range`: the selection to put back first ({ from, to }): a menu taking
  // the focus loses the browser's, and the editor, focused again, would
  // take that (empty) one over its own.
  const edit = useCallback((apply, range = null) => {
    const current = editorRef.current
    if (!current) return
    const chain = current.chain().focus()
    apply(range ? chain.setTextSelection(range) : chain).run()
  }, [])

  // The signature in or out of the text as it's turned on or off, here or
  // in Réglages.
  useSignatureNodeSync(editorRef, editor, signature.on)

  const setBlock = (value, range = null) => edit((chain) => {
    if (value === 'h2' || value === 'h3') return chain.setHeading({ level: value === 'h2' ? 2 : 3 })
    if (value === 'blockquote') return chain.setParagraph().setBlockquote()
    return chain.setParagraph().unsetBlockquote()
  }, range)

  // Reply, reply all or forward, switched from the first pill: the fields
  // follow (the text written stays), and so does the quote's header line.
  const switchKind = (next) => {
    if (!message || next === kind) return
    const fields = buildDraftFields(next, message, [sender?.email, ...identities.map((identity) => identity.email)])
    setKind(next)
    setTo(fields.to)
    setCc(fields.cc)
    // Cci is the student's own choice: kept, without what À and Cc now hold.
    const shown = new Set([...fields.to, ...fields.cc].map(recipientKey))
    setBcc((current) => current.filter((address) => !shown.has(recipientKey(address))))
    setToInput('')
    setCcInput('')
    if (fields.cc.length) setShowCc(true)
    setSubject(fields.subject)
    // A forward takes the mail's attachments along, a reply leaves them;
    // the files added are kept either way.
    setMessageItems(fields.attachments)
    // The header is the paragraph right before the text's last quote.
    const current = editorRef.current
    if (!current) return
    const { doc } = current.state
    let quoteIndex = -1
    doc.forEach((node, offset, index) => {
      if (node.type.name === 'blockquote') quoteIndex = index
    })
    if (quoteIndex < 1) return
    const header = doc.child(quoteIndex - 1)
    if (header.type.name !== 'paragraph') return
    let from = 0
    for (let index = 0; index < quoteIndex - 1; index += 1) from += doc.child(index).nodeSize
    current.chain().insertContentAt({ from, to: from + header.nodeSize }, linesToParagraph(quoteHeader(message, next))).run()
  }

  // `opener`: the button it came from, given the focus back on close (the
  // menu's item had it, and with it gone Escape would no longer reach the
  // composer). A pick that moves the focus (a list, into the text) runs
  // after, so it wins.
  // Its button pressed again while it's open: it closes (a toggle).
  const openMenu = (kindOfMenu, event) => {
    const opener = event.currentTarget
    if (menu?.opener === opener) {
      closeMenu()
      return
    }
    const rect = opener.getBoundingClientRect()
    // The text's selection as the menu opens, for its pick to land there.
    const selection = editor?.state.selection
    setMenu({ kind: kindOfMenu, x: rect.left, y: rect.bottom + 6, opener, range: selection ? { from: selection.from, to: selection.to } : null })
  }

  // The format bar's choices, in the same menu: one ticked (the current),
  // each applied on a pick (applyFormat).
  const formatMenus = {
    block: { label: 'Style de paragraphe', options: BLOCK_OPTIONS, value: format.block },
    font: { label: 'Police', options: FONT_OPTIONS, value: format.font },
    size: { label: 'Taille', options: SIZE_OPTIONS, value: format.size },
    'text-color': { label: 'Couleur du texte', options: TEXT_COLORS, value: format.color, swatches: true },
    highlight: { label: 'Surlignage', options: HIGHLIGHT_COLORS, value: format.highlight, swatches: true },
  }
  const applyFormat = (menuKind, value, range) => {
    if (menuKind === 'block') setBlock(value, range)
    else if (menuKind === 'font') edit((chain) => (value === 'inter' ? chain.unsetFontFamily() : chain.setFontFamily(FONT_OPTIONS.find((option) => option.value === value)?.family)), range)
    else if (menuKind === 'size') edit((chain) => (value === DEFAULT_SIZE ? chain.unsetFontSize() : chain.setFontSize(value)), range)
    else if (menuKind === 'text-color') edit((chain) => (value ? chain.setColor(value) : chain.unsetColor()), range)
    else if (menuKind === 'highlight') edit((chain) => (value ? chain.setHighlight({ color: value }) : chain.unsetHighlight()), range)
  }

  const closeMenu = () => {
    menu?.opener?.focus({ preventScroll: true })
    setMenu(null)
  }

  // What each recipients' field is given: its tokens and text, the other
  // two fields' tokens (never added twice), the shared suggestions.
  const recipientFields = {
    to: { tokens: to, setTokens: setTo, value: toInput, setValue: setToInput, inputRef: toInputRef },
    cc: { tokens: cc, setTokens: setCc, value: ccInput, setValue: setCcInput, inputRef: ccInputRef },
    bcc: { tokens: bcc, setTokens: setBcc, value: bccInput, setValue: setBccInput, inputRef: bccInputRef },
  }
  // A token dragged from one field onto another: out of the first, into
  // the second (mergeAddresses, which still keeps it out of the third).
  const moveRecipient = (from, key, into) => {
    const source = recipientFields[from]
    const target = recipientFields[into]
    const address = source?.tokens.find((entry) => recipientKey(entry) === key)
    if (!address || !target) return
    const remaining = source.tokens.filter((entry) => entry !== address)
    const third = RECIPIENT_FIELDS.find((name) => name !== from && name !== into)
    source.setTokens(remaining)
    target.setTokens(mergeAddresses(target.tokens, [address], [...remaining, ...recipientFields[third].tokens]))
  }
  const recipientProps = (name) => ({
    id: `${fieldId}-${name}`,
    field: name,
    tokens: recipientFields[name].tokens,
    onTokensChange: recipientFields[name].setTokens,
    value: recipientFields[name].value,
    onValueChange: recipientFields[name].setValue,
    inputRef: recipientFields[name].inputRef,
    exclude: RECIPIENT_FIELDS.filter((other) => other !== name).flatMap((other) => recipientFields[other].tokens),
    cache: suggestionCache,
    onNotice: showNotice,
    onMove: moveRecipient,
  })

  const revealCc = () => {
    setShowCc(true)
    // Once the row is drawn.
    window.requestAnimationFrame(() => ccInputRef.current?.focus())
  }

  // Escape closes (asking first for a changed draft), ⌘/Ctrl+Enter sends.
  // A menu open over it takes Escape first (it cancels
  // the event). On a phone the sheet holds the focus: Tab goes round it.
  const handleKeyDown = (event) => {
    // The editor marks Escape handled (ProseMirror's base keys select the
    // block around the cursor): from the text, it still closes.
    const fromEditor = event.target instanceof Element && Boolean(event.target.closest('.ProseMirror'))
    const sendKeys = event.key === 'Enter' && (event.metaKey || event.ctrlKey)
    if (event.defaultPrevented && !((event.key === 'Escape' || sendKeys) && fromEditor)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // Full screen, Escape first leaves it (as a UE's full-page view).
      if (isFullscreen && !isPhone) toggleFullscreen()
      else requestClose()
      return
    }
    if (sendKeys) {
      event.preventDefault()
      send()
      return
    }
    if (event.key === 'Tab' && isPhone) {
      const focusable = [...rootRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [contenteditable="true"]')]
        .filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  const kindTitle = KIND_TITLES[kind]
  // « De : »: the identity picked (the account's default until the list
  // comes), else the account's own name and address.
  const fromIdentity = identities.find((identity) => identity.id === identityId) ?? identities[0] ?? null
  const fromName = fromIdentity?.name || sender?.name || ''
  const fromEmail = fromIdentity?.email || sender?.email || ''
  const fromLabel = fromName && fromEmail ? `${fromName} – ${fromEmail}` : fromEmail || fromName || 'Ton adresse'
  // Only a failed save is said: a saved draft goes without a word.
  const draftLine = draftStatus === 'error' ? 'Brouillon non enregistré' : null
  const canSwitchKind = Boolean(message)

  // The trombone: the file picker; for a reply to a mail with attachments
  // left out (as Apple Mail does), a menu offering them back too.
  const pickFiles = () => fileInputRef.current?.click()
  const originalAttachments = kind === 'forward' ? [] : messageAttachmentItems(message)
  const canAddOriginal = originalAttachments.some((entry) => !attachments.some((item) => item.key === entry.key))
  // A size refusal: the way round it is FileSender (RENATER), said once
  // under the chips.
  const sizeRefused = attachments.some((item) => item.status === 'error' && (item.error === 'too-large' || item.error === 'total'))

  // Files dropped or pasted anywhere on the composer, its text and fields
  // included: taken before the editor or a field sees them (capture), which
  // would otherwise paste a file's name as text or open it.
  const fileDropHandlers = {
    onDragEnterCapture: (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      dragDepthRef.current += 1
      setDragActive(true)
    },
    onDragOverCapture: (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeaveCapture: (event) => {
      if (!isFileDrag(event)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (!dragDepthRef.current) setDragActive(false)
    },
    onDropCapture: (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      dragDepthRef.current = 0
      setDragActive(false)
      addAttachments(event.dataTransfer.files)
    },
    onPasteCapture: (event) => {
      const files = event.clipboardData?.files
      if (!files?.length) return
      event.preventDefault()
      event.stopPropagation()
      addAttachments(files)
    },
  }

  const formatMenu = formatMenus[menu?.kind]
  const menuItems = formatMenu ? formatMenu.options.map((option) => ({
    id: option.value || 'none',
    label: option.label,
    checked: option.value === formatMenu.value,
    ...(formatMenu.swatches ? { swatch: option.value } : null),
    onSelect: () => applyFormat(menu.kind, option.value, menu.range),
  })) : menu?.kind === 'attach'
    ? [
      { id: 'files', label: 'Choisir des fichiers…', icon: 'carbon:document-add', onSelect: pickFiles },
      { id: 'original', label: 'Pièces jointes d’origine', icon: 'carbon:attachment', detail: String(originalAttachments.length), onSelect: () => setMessageItems(originalAttachments) },
    ]
    : menu?.kind === 'identity'
    ? identities.map((identity) => ({ id: identity.id, label: identity.email, hint: identity.name, checked: identity.id === fromIdentity?.id, onSelect: () => setIdentityId(identity.id) }))
    : menu?.kind === 'kind'
    ? ['reply', 'reply-all', 'forward'].map((id) => ({ id, label: KIND_TITLES[id], icon: KIND_ICONS[id], checked: kind === id, onSelect: () => switchKind(id) }))
    : menu?.kind === 'list'
      ? [
        { id: 'ul', label: 'Liste à puces', icon: 'carbon:list-bulleted', checked: format.unorderedList, onSelect: () => edit((chain) => chain.toggleBulletList(), menu.range) },
        { id: 'ol', label: 'Liste numérotée', icon: 'carbon:list-numbered', checked: format.orderedList, onSelect: () => edit((chain) => chain.toggleOrderedList(), menu.range) },
      ]
      : []

  // Dimmed while files are still uploading: a press then says so (send).
  const uploading = attachments.some((item) => item.status === 'uploading' || item.status === 'queued')
  const sendButton = (
    <button
      type="button"
      className={`group relative inline-flex size-9 shrink-0 items-center justify-center rounded-full border-0 bg-text text-bg cursor-pointer transition-[transform,filter,opacity] duration-100 ease-out hover:brightness-110 active:scale-[0.92] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${uploading ? 'opacity-40' : ''}`}
      aria-label="Envoyer"
      aria-disabled={uploading || undefined}
      onClick={send}
    >
      <Icon icon="carbon:arrow-up" className="size-[19px]" aria-hidden="true" />
      <Tooltip title={uploading ? 'Pièces jointes en cours de chargement' : 'Envoyer'} detail={uploading ? null : `${MOD_KEY} Entrée`} side="bottom-end" className="max-4xl:hidden" />
    </button>
  )

  // The kind of reply (reply, reply all, forward: a menu) and the
  // attachments, each a glass pill.
  const tools = (
    <div className="flex items-center gap-2">
      <span className="mobile-tab-bar relative flex shrink-0 items-center rounded-full p-[3px]">
        <ToolButton
          label="Type de réponse"
          icon={KIND_ICONS[kind]}
          iconClassName={kind === 'forward' ? '[transform:scaleX(-1)]' : ''}
          disabled={!canSwitchKind}
          tooltipSide="bottom-start"
          onClick={(event) => openMenu('kind', event)}
        />
      </span>
      <span className="mobile-tab-bar relative flex shrink-0 items-center rounded-full p-[3px]">
        <ToolButton
          label="Joindre un fichier"
          icon="carbon:attachment"
          menu={canAddOriginal}
          onClick={(event) => (canAddOriginal ? openMenu('attach', event) : pickFiles())}
        />
      </span>
    </div>
  )

  // Its buttons' icons take no pointer: a field left with text in it turns
  // that into tokens on blur, and the re-render that follows swaps the
  // icon's svg content under a press begun on it, which then never becomes
  // a click (« Envoyer » or « + » pressed straight from a field).
  //
  // On the body, as the app's other overlays: inside the page's column it
  // would stay under the tab bar and the header, whatever its z-index. At
  // z-30, over the page, the sidebar and the tab bar (it comes after them),
  // but under the app's dialogs (Réglages and the others, z-40 and up): a
  // working window, not a modal one.
  return createPortal(
    <section
      ref={rootRef}
      className={`mail-composer fixed z-30 flex flex-col overflow-hidden text-text [&_button_svg]:pointer-events-none 4xl:border 4xl:corners-[26px] max-4xl:inset-0 ${isFullscreen ? 'is-fullscreen 4xl:inset-3' : '4xl:right-6 4xl:bottom-6 4xl:h-[min(580px,calc(100dvh-48px))] 4xl:w-[min(680px,calc(100vw-48px))]'}`}
      role="dialog"
      aria-modal={isPhone || undefined}
      aria-label={kindTitle}
      onKeyDown={handleKeyDown}
      {...fileDropHandlers}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          addAttachments(event.target.files)
          // The same file can be picked again (after it's taken out).
          event.target.value = ''
        }}
      />
      {isPhone ? (
        // As iOS Mail: Annuler, the title, the send button; the tools under.
        <header className="grid gap-3 border-b border-border px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button type="button" className="justify-self-start rounded-full border-0 bg-transparent px-1 py-1.5 text-text cursor-pointer" onClick={requestClose}>
              <span className="text-[16px] font-medium leading-none">Annuler</span>
            </button>
            <div className="grid min-w-0 max-w-[50vw] justify-items-center">
              <h2 id={titleId} className="m-0 max-w-full truncate text-[16px] font-semibold leading-tight">{subject.trim() || kindTitle}</h2>
              {draftLine ? <span className="text-[11.5px] font-medium leading-tight text-text-muted" role="status">{draftLine}</span> : null}
            </div>
            <span className="justify-self-end">{sendButton}</span>
          </div>
          {tools}
        </header>
      ) : (
        <header className="flex items-center gap-3 px-4 pt-4 pb-3">
          <CloseButton onClick={requestClose} />
          <button
            type="button"
            className="close-button close-button--plain group relative inline-flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 p-0 text-text"
            aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            aria-pressed={isFullscreen}
            onClick={toggleFullscreen}
          >
            <Icon icon={isFullscreen ? 'carbon:minimize' : 'carbon:maximize'} className="size-[15px]" aria-hidden="true" />
            <Tooltip title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'} side="bottom-start" />
          </button>
          <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <h2 id={titleId} className="m-0 min-w-0 truncate text-[15px] font-semibold leading-tight">{subject.trim() || kindTitle}</h2>
            {draftLine ? <span className="shrink-0 whitespace-nowrap text-[12px] font-medium leading-tight text-text-muted max-[1180px]:hidden" role="status">{draftLine}</span> : null}
          </div>
          {tools}
          {sendButton}
        </header>
      )}

      <div className="flex min-h-0 flex-1 flex-col max-4xl:overflow-y-auto max-4xl:overscroll-contain">
        <div className="border-t border-border text-[14px] max-4xl:border-t-0 max-4xl:text-[16px]">
          <FieldRow label="À :" htmlFor={`${fieldId}-to`} top>
            <RecipientInput {...recipientProps('to')} label="Destinataires" />
            {showCc ? null : (
              <button
                type="button"
                className="group relative mt-[6px] inline-flex size-7 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-text-muted cursor-pointer hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-text max-4xl:size-8"
                aria-label="Ajouter Cc et Cci"
                onClick={revealCc}
              >
                <Icon icon="carbon:add-alt" className="size-[18px]" aria-hidden="true" />
                <Tooltip title="Ajouter Cc et Cci" side="bottom-end" className="max-4xl:hidden" />
              </button>
            )}
          </FieldRow>
          {showCc ? (
            <>
              <FieldRow label="Cc :" htmlFor={`${fieldId}-cc`} top>
                <RecipientInput {...recipientProps('cc')} label="Destinataires en copie" />
              </FieldRow>
              <FieldRow label="Cci :" htmlFor={`${fieldId}-bcc`} top>
                <RecipientInput {...recipientProps('bcc')} label="Destinataires en copie cachée" />
              </FieldRow>
            </>
          ) : null}
          <FieldRow label="Objet :" htmlFor={`${fieldId}-subject`}>
            <input
              id={`${fieldId}-subject`}
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="mail-composer-input h-[41px] min-w-0 flex-1 border-0 bg-transparent p-0 font-semibold text-text"
            />
          </FieldRow>
          <FieldRow label="De :">
            {identities.length > 1 ? (
              // Several addresses: a choice, in the app's menu.
              <span className="flex min-w-0 flex-1">
                <button
                  type="button"
                  className="-ml-2 inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-[9px] border-0 bg-transparent px-2 text-text cursor-pointer transition-[background-color] duration-120 hover:bg-bg-subtle aria-expanded:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text"
                  aria-label={`De : ${fromLabel}`}
                  aria-haspopup="menu"
                  onClick={(event) => openMenu('identity', event)}
                >
                  <span className="min-w-0 truncate">{fromLabel}</span>
                  <Icon icon="carbon:chevron-down" className="size-3 shrink-0 text-text-muted" aria-hidden="true" />
                </button>
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-text">{fromLabel}</span>
            )}
            {/* The signature (Réglages › Messagerie: the automatic one, the
                webmail's or the student's own), on or off; its label
                shimmers while it's on. On a phone, its own row below. */}
            {signature.available ? (
              <label className="flex shrink-0 cursor-pointer items-center gap-2.5 max-sm:hidden">
                <span className={`text-[13px] font-medium text-text-muted ${signature.on ? 'mail-signature-shimmer' : ''}`}>{SIGNATURE_LABELS[signature.kind]}</span>
                <Switch small label={SIGNATURE_LABELS[signature.kind]} checked={signature.on} onChange={signature.setOn} />
              </label>
            ) : null}
          </FieldRow>
          {signature.available ? (
            <label className="flex min-h-[42px] cursor-pointer items-center justify-between gap-3 border-b border-border px-4 sm:hidden">
              <span className={`min-w-0 truncate font-medium text-text-muted ${signature.on ? 'mail-signature-shimmer' : ''}`}>{SIGNATURE_LABELS[signature.kind]}</span>
              <Switch small label={SIGNATURE_LABELS[signature.kind]} checked={signature.on} onChange={signature.setOn} />
            </label>
          ) : null}
          {attachments.length ? (
            <div className="grid gap-2 border-b border-border px-5 py-3 max-4xl:px-4">
              {/* A scroll box only past two rows (four chips, from 4xl): the
                  chips' tooltips hang under them, and inside a scroll box
                  they made it scroll even for one chip. */}
              <ul className={`m-0 flex list-none flex-wrap gap-2 p-0 ${attachments.length > 4 ? 'overflow-y-auto overscroll-contain 4xl:max-h-[148px]' : ''}`} aria-label="Pièces jointes">
                {attachments.map((item) => (
                  <AttachmentChip key={item.key} item={item} onRemove={() => removeAttachment(item.key)} onRetry={() => retryAttachment(item.key)} />
                ))}
              </ul>
              {sizeRefused ? (
                <p className="m-0 text-[12.5px] font-medium leading-snug text-text-muted">
                  {formatAttachmentLimit(limits.maxTotalBytes)} au maximum par mail · Pour un fichier plus lourd,{' '}
                  <a className="font-semibold text-text underline decoration-text/30 underline-offset-2 hover:decoration-text" href={FILESENDER_URL} target="_blank" rel="noopener noreferrer">FileSender de RENATER</a>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Always there: on a phone it scrolls sideways. */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-2 max-4xl:flex-nowrap max-4xl:overflow-x-auto max-4xl:px-4" role="toolbar" aria-label="Mise en forme">
            <FormatSelect label="Style de paragraphe" value={format.block} options={BLOCK_OPTIONS} onOpen={(event) => openMenu('block', event)} />
            <FormatSelect label="Police" value={format.font} options={FONT_OPTIONS} onOpen={(event) => openMenu('font', event)} />
            <FormatSelect label="Taille" value={format.size} options={SIZE_OPTIONS} onOpen={(event) => openMenu('size', event)} />
            <FormatSegment>
              <ColorButton label="Couleur du texte" kind="text" color={format.color} onOpen={(event) => openMenu('text-color', event)} />
              <ColorButton label="Surlignage" kind="highlight" color={format.highlight} onOpen={(event) => openMenu('highlight', event)} />
            </FormatSegment>
            <FormatSegment>
              <FormatButton label="Gras" icon="carbon:text-bold" pressed={format.bold} onClick={() => edit((chain) => chain.toggleBold())} />
              <FormatButton label="Italique" icon="carbon:text-italic" pressed={format.italic} onClick={() => edit((chain) => chain.toggleItalic())} />
              <FormatButton label="Souligné" icon="carbon:text-underline" pressed={format.underline} onClick={() => edit((chain) => chain.toggleUnderline())} />
              <FormatButton label="Barré" icon="carbon:text-strikethrough" pressed={format.strikeThrough} onClick={() => edit((chain) => chain.toggleStrike())} />
            </FormatSegment>
            <FormatSegment>
              <FormatButton label="Listes" icon={format.orderedList ? 'carbon:list-numbered' : 'carbon:list-bulleted'} pressed={format.unorderedList || format.orderedList} haspopup="menu" onClick={(event) => openMenu('list', event)} />
              {/* A list's item nests (into the one above); a paragraph indents. */}
              <FormatButton label="Réduire le retrait" icon="carbon:text-indent-less" disabled={!format.canOutdent} onClick={() => edit((chain) => (format.inList ? chain.liftListItem('listItem') : chain.outdent()))} />
              <FormatButton label="Augmenter le retrait" icon="carbon:text-indent-more" disabled={!format.canIndent} onClick={() => edit((chain) => (format.inList ? chain.sinkListItem('listItem') : chain.indent()))} />
            </FormatSegment>
          </div>

        <MailSignatureContext.Provider value={signature.value}>
          <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col [&>.mail-composer-body]:flex-1" />
        </MailSignatureContext.Provider>
      </div>

      {dragActive ? (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-text/25 bg-widget-bg/85 backdrop-blur-[6px]" aria-hidden="true">
          <MailDropSheets />
          <span className="text-[15px] font-semibold leading-tight text-text">Déposer pour joindre</span>
          <span className="text-[12.5px] font-medium leading-tight text-text-muted">{formatAttachmentLimit(limits.maxTotalBytes)} au maximum par mail</span>
        </div>
      ) : null}

      {/* The notice (« L’envoi arrive bientôt »), over the text's foot: in the
          window rather than the page's own toast, which it may cover. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4 max-4xl:bottom-[max(20px,env(safe-area-inset-bottom))]" role="status">
        {notice ? (
          <div key={notice.key} className="mail-toast-in flex min-h-[39px] items-center rounded-full bg-black px-4 text-white shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:bg-white dark:text-black">
            <span className="text-[13px] font-medium leading-tight">{notice.text}</span>
          </div>
        ) : null}
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={formatMenu?.label ?? (menu.kind === 'kind' ? 'Type de réponse' : menu.kind === 'attach' ? 'Joindre' : menu.kind === 'identity' ? 'Envoyer depuis' : 'Listes')}
          title={menu.kind === 'identity' ? 'Envoyer depuis' : null}
          items={menuItems}
          anchor={menu.opener}
          onClose={closeMenu}
        />
      ) : null}
      <ConfirmDialog
        open={confirmingClose}
        title="Enregistrer le brouillon ?"
        confirmLabel="Enregistrer"
        extraLabel="Supprimer"
        onExtra={discardAndClose}
        onConfirm={saveAndClose}
        onCancel={cancelClose}
      >
        Tu pourras le reprendre depuis Brouillons
      </ConfirmDialog>
    </section>,
    document.body,
  )
}

export default MailComposer
