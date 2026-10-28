// The student's own signatures, from the webmail (GET /__ent_auth/mail/
// signatures, POST /mail/signature and the sends in entAuthApp.js): the
// pieces that don't need a request, tested on their own
// (tests/mailSignature.test.js).
//
// A signature of the webmail (GetSignaturesRequest, urn:zimbraAccount) is
// someone's HTML or text: it's never sent nor shown as Zimbra gives it. Its
// HTML goes through an allowlist tighter than the composer's (text, line
// breaks, bold and the like, a few inline styles, http(s) and mailto links;
// no image, no table, no class, no script), capped, and its text version is
// made from that. The page only ever names a kind ('partage', 'custom'): the
// server reads the signature itself at send time.
//
// GetSignaturesResponse, in its JSON form:
//   { signature: [{ id, name, content: [{ type: 'text/plain' | 'text/html',
//     _content }] }] }   (content a lone object on some versions)
import sanitizeHtml from 'sanitize-html'
import { decodeEntities, escapeHtml } from './mailSend.js'
import { CUSTOM_SIGNATURE_NAME } from '../src/mailSignatureChoice.js'

// Zimbra's own limit is 20 signatures (zimbraSignatureMaxNumEntries).
const MAX_SIGNATURES = 30
export const SIGNATURE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
// Past these, a webmail signature is no signature (a pasted page): its HTML
// gives way to its text, its text is cut.
export const MAX_SIGNATURE_HTML_LENGTH = 20_000
export const MAX_SIGNATURE_TEXT_LENGTH = 4000
const MAX_SIGNATURE_NAME_LENGTH = 80
// The webmail's « no signature » (ZmIdentity.SIG_ID_NONE).
const NO_SIGNATURE_ID = '11111111-1111-1111-1111-111111111111'
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\u2028\u2029]/gu

const capLength = (text, max) => (text.length > max ? Array.from(text).slice(0, max).join('') : text)

// ── The webmail's HTML ─────────────────────────────────────────────────────

const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i
const INLINE_STYLES = {
  color: [COLOR],
  'font-weight': [/^(?:bold|bolder|normal|[1-9]00)$/],
  'font-style': [/^(?:italic|normal)$/],
  'text-decoration': [/^(?:underline|line-through|none)$/],
  'font-size': [/^(?:[89]|[12]\d|3[0-2])(?:\.\d+)?(?:px|pt)$/],
}
export const SIGNATURE_TAGS = ['div', 'p', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li']
const STYLED_TAGS = ['div', 'p', 'span', 'li', 'b', 'strong', 'i', 'em', 'u', 's']
const SAFE_HREF = /^(?:https?:\/\/|mailto:)/i

// A table's cells (a signature's usual layout) become lines one under the
// other, a heading a line, <font color> a span.
const AS_DIV = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'center', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'header', 'footer', 'address']

const SIGNATURE_SANITIZE_OPTIONS = {
  allowedTags: SIGNATURE_TAGS,
  allowedAttributes: { a: ['href'], ...Object.fromEntries(STYLED_TAGS.map((tag) => [tag, ['style']])) },
  allowedStyles: Object.fromEntries(STYLED_TAGS.map((tag) => [tag, INLINE_STYLES])),
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'head', 'template', 'svg', 'math', 'iframe', 'object', 'select', 'button'],
  transformTags: {
    ...Object.fromEntries(AS_DIV.map((tag) => [tag, 'div'])),
    font: (tagName, attribs) => ({ tagName: 'span', attribs: COLOR.test(attribs.color ?? '') ? { style: `color:${attribs.color}` } : {} }),
    a: (tagName, attribs) => {
      const href = String(attribs.href ?? '').trim()
      return { tagName, attribs: SAFE_HREF.test(href) ? { href } : {} }
    },
  },
}

// Empty lines around the signature (the webmail's editor leaves some).
const EDGE_BLANKS = /^(?:\s|&nbsp;|<br \/>|<(div|p)>(?:\s|&nbsp;|<br \/>)*<\/\1>)+|(?:\s|&nbsp;|<br \/>|<(div|p)>(?:\s|&nbsp;|<br \/>)*<\/\2>)+$/g

// A webmail signature's HTML, cleaned → { html, hasImages } (hasImages: it
// had some, left out: the page says so).
export function sanitizeSignatureHtml(html) {
  const source = typeof html === 'string' ? html.slice(0, MAX_SIGNATURE_HTML_LENGTH * 5) : ''
  const clean = sanitizeHtml(source, SIGNATURE_SANITIZE_OPTIONS).replace(EDGE_BLANKS, '')
  return { html: clean, hasImages: /<img\b/i.test(source) }
}

// The cleaned HTML (sanitizeSignatureHtml's) as text: a block or a <br> a
// line, a list item as « - », a link as « text (url) » unless its text is
// the url. sanitize-html's output (its tags, quoted attributes), which a
// plain tokenizer reads safely.
const TEXT_BLOCKS = new Set(['div', 'p', 'ul', 'ol', 'li'])

export function signatureHtmlToText(cleanHtml) {
  let out = ''
  let link = null
  const newLine = () => {
    if (out && !out.endsWith('\n')) out += '\n'
  }
  const tokens = String(cleanHtml ?? '').matchAll(/<(\/?)([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi)
  for (const [, closing, rawTag, attributes, rawText] of tokens) {
    if (rawText !== undefined) {
      const text = decodeEntities(rawText).replace(/\s+/g, ' ')
      out += text
      if (link) link.text += text
      continue
    }
    const tag = rawTag.toLowerCase()
    if (tag === 'br') {
      out += '\n'
    } else if (tag === 'a') {
      if (!closing) {
        link = { href: decodeEntities(/href="([^"]*)"/.exec(attributes)?.[1] ?? ''), text: '' }
      } else if (link) {
        const target = link.href.replace(/^mailto:/i, '')
        if (link.href && target !== link.text.trim() && link.href !== link.text.trim()) out += ` (${target})`
        link = null
      }
    } else if (TEXT_BLOCKS.has(tag)) {
      newLine()
      if (tag === 'li' && !closing) out += '- '
    }
  }
  return out.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
}

// A text signature as HTML: a line a <div>, an empty line kept.
export function plainSignatureToHtml(text) {
  return String(text ?? '').split('\n').map((line) => `<div>${line ? escapeHtml(line) : '<br />'}</div>`).join('')
}

function cleanSignatureText(text) {
  const clean = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(CONTROL_CHARACTERS, '').replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  return capLength(clean, MAX_SIGNATURE_TEXT_LENGTH)
}

// A signature's content (its HTML and/or its text, as the webmail keeps
// them) → { html, text, hasImages }: the HTML cleaned, its text made from
// it; an HTML too long, or with nothing in it, gives way to the text.
export function readSignatureContent({ html = null, text = null } = {}) {
  if (typeof html === 'string' && html.trim()) {
    const clean = sanitizeSignatureHtml(html)
    const fromHtml = cleanSignatureText(signatureHtmlToText(clean.html))
    if (clean.html.length <= MAX_SIGNATURE_HTML_LENGTH && fromHtml) {
      return { html: clean.html, text: fromHtml, hasImages: clean.hasImages }
    }
    const fallback = typeof text === 'string' && text.trim() ? cleanSignatureText(text) : fromHtml
    return { html: plainSignatureToHtml(fallback), text: fallback, hasImages: clean.hasImages }
  }
  const plain = cleanSignatureText(text)
  return { html: plain ? plainSignatureToHtml(plain) : '', text: plain, hasImages: false }
}

// ── The webmail's answers ──────────────────────────────────────────────────

const asList = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [])

// GetSignaturesResponse → [{ id, name, html, text, hasImages }], in the
// webmail's order; one without an id of the expected shape is left out.
export function readZimbraSignatures(response) {
  const signatures = []
  const seen = new Set()
  for (const entry of asList(response?.signature).slice(0, MAX_SIGNATURES)) {
    const id = String(entry?.id ?? '')
    if (!SIGNATURE_ID_PATTERN.test(id) || seen.has(id)) continue
    seen.add(id)
    const contents = asList(entry.content)
    const pick = (type) => contents.find((content) => String(content?.type ?? '').toLowerCase() === type && typeof content._content === 'string')?._content ?? null
    const name = capLength(String(entry.name ?? '').replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim(), MAX_SIGNATURE_NAME_LENGTH)
    signatures.push({ id, name, ...readSignatureContent({ html: pick('text/html'), text: pick('text/plain') }) })
  }
  return signatures
}

// The one Tafac writes (CUSTOM_SIGNATURE_NAME), or null.
export function findCustomSignature(signatures) {
  return signatures.find((signature) => signature.name === CUSTOM_SIGNATURE_NAME) ?? null
}

// The webmail signature a mail takes when the student chose « Partage »:
// the identity's own (zimbraPrefDefaultSignatureId; for a reply or a
// forward zimbraPrefForwardReplySignatureId when it names one), else, none
// set or set to one deleted since, their first besides Tafac's (they chose
// « Partage » in Tafac: one of theirs rather than nothing). `ids`: the
// identity's { signatureId, replySignatureId } (readIdentitySignatureIds).
// → the signature, or null when they have none.
export function pickPartageSignature(signatures, ids, { reply = false } = {}) {
  const byId = (id) => (id && id !== NO_SIGNATURE_ID ? signatures.find((signature) => signature.id === id) ?? null : null)
  return (reply ? byId(ids?.replySignatureId) : null)
    ?? byId(ids?.signatureId)
    ?? signatures.find((signature) => signature.name !== CUSTOM_SIGNATURE_NAME && signature.text)
    ?? null
}

// ── The custom signature, written ─────────────────────────────────────────

// The request that makes the webmail's Tafac signature `text` (normalized
// by normalizeCustomSignatureText), `existing` the one it has now
// (findCustomSignature): modified (by its id), created, deleted for an
// empty text, or nothing to do (null). Both its contents, so the webmail
// shows the same in its HTML and its text editor.
export function buildCustomSignatureRequest(text, existing) {
  if (!text) return existing ? { name: 'DeleteSignatureRequest', body: { signature: { id: existing.id } } } : null
  const content = [
    { type: 'text/plain', _content: text },
    { type: 'text/html', _content: plainSignatureToHtml(text) },
  ]
  return existing
    ? { name: 'ModifySignatureRequest', body: { signature: { id: existing.id, name: CUSTOM_SIGNATURE_NAME, content } } }
    : { name: 'CreateSignatureRequest', body: { signature: { name: CUSTOM_SIGNATURE_NAME, content } } }
}

// ── In the mail as sent ───────────────────────────────────────────────────

// As the automatic one (mailSend.js's buildMailSignature): set apart, a
// notch smaller, in the text's colour; links in the mail's blue.
const FRAME_STYLE = 'margin:14px 0 6px;font-size:14px;line-height:1.45;color:#1d1d1f'
const ELEMENT_STYLES = { p: 'margin:0', ul: 'margin:0.25em 0;padding-left:1.5em', ol: 'margin:0.25em 0;padding-left:1.5em', a: 'color:#1a73e8' }

// A signature (readSignatureContent's) for the mail → { html, text }: its
// HTML in its frame, its styles inline; its text after « -- » (the line
// mail clients know a signature by), unless it starts with one.
export function frameSignature(signature) {
  const html = String(signature?.html ?? '')
  const text = String(signature?.text ?? '')
  if (!html && !text) return { html: '', text: '' }
  const styled = sanitizeHtml(html || plainSignatureToHtml(text), {
    allowedTags: SIGNATURE_TAGS,
    allowedAttributes: false,
    transformTags: {
      '*': (tagName, attribs) => {
        const base = ELEMENT_STYLES[tagName]
        if (!base) return { tagName, attribs }
        return { tagName, attribs: { ...attribs, style: [base, attribs.style].filter(Boolean).join(';') } }
      },
    },
  })
  return {
    html: `<div style="${FRAME_STYLE}">${styled}</div>`,
    text: /^--\s*(?:\n|$)/.test(text) ? text : `-- \n${text}`,
  }
}
