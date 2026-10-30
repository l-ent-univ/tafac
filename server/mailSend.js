// Sending a mail and saving a draft from the composer (POST
// /__ent_auth/mail/send and /mail/draft in entAuthApp.js): the pieces that
// don't need a request, tested on their own (tests/mailSend.test.js).
//
// Nothing the page sends is taken as it is. The recipients are checked again
// with the composer's own rules (src/mailCompose.js), the subject loses its
// line breaks, the text goes through an allowlist as tight as what the
// editor makes (sanitizeComposerHtml), the attachments are references of
// known shapes, and the sender is never the page's to choose: an identity id
// from the account's own list (normalizeZimbraIdentities), whose address the
// server sets. The signature is built here too, from the account and the
// university's config, or read from the webmail (server/mailSignature.js),
// never from HTML the page sends.
//
// What goes to Zimbra (buildZimbraMessage) is the <m> of a SendMsgRequest
// or a SaveDraftRequest (urn:zimbraMail), in its JSON form:
//   { idnt, e: [{ t: 'f'|'t'|'c'|'b', a, p }], su: { _content },
//     origid, rt: 'r'|'w', irt: { _content },  (a reply or a forward)
//     did (send: the draft it replaces) | id (save: the draft saved over),
//     mp: [{ ct: 'multipart/alternative', mp: [
//       { ct: 'text/plain', content: { _content } },
//       { ct: 'multipart/related', mp: [            (the signature's logos,
//         { ct: 'text/html', content: { _content } },  the text's images)
//         { ci: '…@tafac.fr', attach: { aid } | { mp: [{ mid, part }] } } ] } ] }],
//     attach: { aid: 'a,b', mp: [{ mid, part }] } }
import sanitizeHtml from 'sanitize-html'
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_RECIPIENTS,
  isValidAddress,
  recipientKey,
  sanitizeDisplayName,
} from '../src/mailCompose.js'
import { MAX_ATTACHMENTS, sanitizeAttachmentName } from '../src/mailAttachments.js'
import { isSignatureKind, signatureLogin, signatureLoginLine } from '../src/mailSignatureChoice.js'
import { CONTROL_CHARACTERS, capLength, decodeEntities, escapeHtml } from '../src/mailText.js'

export const MAX_SUBJECT_LENGTH = 255
// The editor's HTML, a long thread quoted under a reply included: more is
// no mail a student writes (the route's JSON body is capped above this).
export const MAX_COMPOSER_HTML_LENGTH = 1_500_000
export const MAX_SIGNATURE_GROUP_LENGTH = 80
const MAX_IDENTITIES = 20
const SEND_UID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
const IDENTITY_ID_PATTERN = /^[A-Za-z0-9:._-]{1,64}$/
const ESTABLISHMENT_ID_PATTERN = /^[a-z0-9-]{1,40}$/
const PART_ID_PATTERN = /^\d+(?:\.\d+)*$/
// The images inside the text (an image of a grade, src/gradeMail.js): a few
// per mail, each its own inline part (multipart/related), named by a cid
// the page makes (src/mailInlineImages.js's createInlineCid), shown at most
// MAX_INLINE_IMAGE_WIDTH wide (a mail's usual column).
export const MAX_INLINE_IMAGES = 3
export const MAX_INLINE_IMAGE_WIDTH = 560
export const INLINE_CID_PATTERN = /^tafac-img-[0-9a-f-]{8,64}@tafac\.fr$/
export const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])
const MAX_IMAGE_ALT_LENGTH = 200
// The composer's kinds of answer, as the page names them, and Zimbra's
// reply type for each (rt: 'r' replied, 'w' forwarded).
const ORIGIN_KINDS = { reply: 'r', replyAll: 'r', forward: 'w' }

// ── The editor's HTML ──────────────────────────────────────────────────────

// What the format bar offers (MailComposer: TEXT_COLORS, HIGHLIGHT_COLORS,
// SIZE_OPTIONS, FONT_OPTIONS; src/tiptapIndent.js), and no more. Colours as
// the editor writes them (hex, or rgb() once a browser has reread them).
const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i
const FONT_SIZE = /^(?:10|13|16|18|24|32)px$/
const FONT_FAMILY = /^(?:"?Inter Variable"?, system-ui, sans-serif|Georgia, serif|ui-monospace, Menlo, monospace)$/
const INDENT = /^(?:32|64|96|128|160|192)px$/
const SPAN_STYLES = { color: [COLOR], 'background-color': [COLOR], 'font-size': [FONT_SIZE], 'font-family': [FONT_FAMILY] }
const BLOCK_STYLES = { 'margin-left': [INDENT] }

// sanitize-html options for the editor's HTML: Tiptap's StarterKit (less
// code, rules and other headings), its text style marks, the highlight,
// the indent, links to http(s) and mailto only, and the signature's
// placeholder (src/mailSignatureNode.js: an empty div[data-mail-signature],
// one at most). Any other div (a resumed draft's wrapper) gives way to its
// content (sanitizeComposerHtml); anything else goes, its text kept.
// A summary box (src/mailSummaryNode.js): a table of text, label and value
// a row, no attribute but its mark (a draft read back may have lost it).
// An image only as a reference to one of the mail's inline parts
// (img[data-inline-cid], src/mailInlineImageNode.js), never a source:
// remote, data: and blob: images all go (selectInlineImages keeps those the
// payload lists).
const COMPOSER_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'a', 'span', 'mark', 'div', 'table', 'tbody', 'tr', 'th', 'td', 'img']
const IMAGE_SIZE = /^\d{1,4}$/

function cleanImageAttributes(attribs) {
  const cid = String(attribs['data-inline-cid'] ?? '').trim().toLowerCase()
  if (!INLINE_CID_PATTERN.test(cid)) return {}
  const alt = capLength(decodeEntities(String(attribs.alt ?? '')).replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim(), MAX_IMAGE_ALT_LENGTH).trim()
  return {
    'data-inline-cid': cid,
    ...(alt ? { alt } : null),
    ...(IMAGE_SIZE.test(attribs.width ?? '') ? { width: attribs.width } : null),
    ...(IMAGE_SIZE.test(attribs.height ?? '') ? { height: attribs.height } : null),
  }
}

const COMPOSER_SANITIZE_OPTIONS = {
  allowedTags: COMPOSER_TAGS,
  allowedAttributes: {
    a: ['href'],
    span: ['style'],
    mark: ['style'],
    p: ['style'],
    h2: ['style'],
    h3: ['style'],
    ol: ['start'],
    div: ['data-mail-signature'],
    table: ['data-mail-summary'],
    img: ['data-inline-cid', 'alt', 'width', 'height'],
  },
  allowedStyles: {
    span: SPAN_STYLES,
    mark: { 'background-color': [COLOR], color: [/^inherit$/] },
    p: BLOCK_STYLES,
    h2: BLOCK_STYLES,
    h3: BLOCK_STYLES,
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Scripts, styles and the like lose their text too.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'head', 'template', 'svg', 'math', 'iframe', 'object'],
  transformTags: {
    div: (tagName, attribs) => ({ tagName, attribs: Object.hasOwn(attribs, 'data-mail-signature') ? { 'data-mail-signature': '' } : {} }),
    table: (tagName, attribs) => ({ tagName, attribs: Object.hasOwn(attribs, 'data-mail-summary') ? { 'data-mail-summary': '' } : {} }),
    img: (tagName, attribs) => ({ tagName, attribs: cleanImageAttributes(attribs) }),
    ol: (tagName, attribs) => ({ tagName, attribs: /^\d{1,4}$/.test(attribs.start ?? '') && attribs.start !== '1' ? { start: attribs.start } : {} }),
    a: (tagName, attribs) => {
      const href = String(attribs.href ?? '').trim()
      return { tagName, attribs: /^(?:https?:\/\/|mailto:)/i.test(href) ? { href } : {} }
    },
  },
  // A signature placeholder holds nothing; an image is a reference or goes.
  exclusiveFilter: (frame) => (frame.tag === 'div' && 'data-mail-signature' in frame.attribs && Boolean(frame.text?.trim()))
    || (frame.tag === 'img' && !frame.attribs['data-inline-cid']),
}

// The placeholder, set aside while the other divs are unwrapped: sanitized
// HTML escapes « < » in text, so this can't come from what was typed.
const SIGNATURE_TOKEN = '<tafac-signature>'
const SIGNATURE_DIV = /<div data-mail-signature(?:="")?><\/div>/

export function sanitizeComposerHtml(html) {
  const source = typeof html === 'string' ? html.slice(0, MAX_COMPOSER_HTML_LENGTH) : ''
  const clean = sanitizeHtml(source, COMPOSER_SANITIZE_OPTIONS)
  // The first placeholder stays, the others go with the plain divs.
  return clean.replace(SIGNATURE_DIV, SIGNATURE_TOKEN)
    .replace(/<\/?div(?: data-mail-signature(?:="")?)?>/g, '')
    .replace(SIGNATURE_TOKEN, '<div data-mail-signature></div>')
}

export const SIGNATURE_PLACEHOLDER = '<div data-mail-signature></div>'

// The images the mail takes, from sanitizeComposerHtml's HTML and the
// payload's references (normalizeComposePayload's `inlineImages`, by cid):
// an image whose cid isn't listed goes, as does a second one of a cid
// (each part once in the mail). → { html, images } (`images`: the listed
// ones the text holds, in its order, each with its alt from the text).
export function selectInlineImages(cleanHtml, references = []) {
  const byCid = new Map(references.map((entry) => [entry.cid, entry]))
  const images = []
  const html = sanitizeHtml(cleanHtml, {
    allowedTags: COMPOSER_TAGS,
    allowedAttributes: false,
    transformTags: {
      img: (tagName, attribs) => {
        const reference = byCid.get(attribs['data-inline-cid'])
        if (!reference || images.some((image) => image.cid === reference.cid)) return { tagName, attribs: {} }
        images.push({ ...reference, alt: attribs.alt ?? '' })
        return { tagName, attribs }
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs['data-inline-cid'],
  })
  return { html, images }
}

// ── The mail as sent: inline styles ────────────────────────────────────────

// Mail clients read <style> blocks unevenly (Gmail drops some, Outlook
// most): every rule the editor's look needs sits on its element. The text's
// default look is the wrapping div's; the editor's own font (Inter) isn't on
// the reader's machine, the system's sans-serif stands in for it.
const DEFAULT_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
const TEXT_COLOR = '#1d1d1f'
const MUTED_COLOR = '#6b625b'
const WRAPPER_STYLE = `font-family:${DEFAULT_FONT};font-size:16px;line-height:1.5;color:${TEXT_COLOR}`
const ELEMENT_STYLES = {
  p: 'margin:0',
  h2: 'margin:0.2em 0;font-size:1.5em;font-weight:700;line-height:1.25',
  h3: 'margin:0.2em 0;font-size:1.2em;font-weight:600;line-height:1.3',
  ul: 'margin:0.25em 0;padding-left:1.5em',
  ol: 'margin:0.25em 0;padding-left:1.5em',
  li: 'margin:0',
  blockquote: `margin:0.4em 0 0;padding:0 0 0 12px;border-left:2px solid #d9d2cc;color:${MUTED_COLOR}`,
  a: 'color:#1a73e8',
  // The summary box: a light card of label and value rows.
  table: 'margin:4px 0 12px;padding:6px 0;border-collapse:separate;border-spacing:0;border:1px solid #e8e1da;border-radius:12px;background:#f8f5f1;font-size:14px;line-height:1.45',
  th: `padding:4px 18px 4px 14px;text-align:left;vertical-align:top;font-weight:500;color:${MUTED_COLOR};white-space:nowrap`,
  td: `padding:4px 14px 4px 0;text-align:left;vertical-align:top;font-weight:600;color:${TEXT_COLOR}`,
}

function withStyle(base, own) {
  return [base, own].filter(Boolean).join(';')
}

// The sanitized HTML (sanitizeComposerHtml) with its styles inline: an empty
// paragraph (an empty line) keeps its height with a <br>; an indent
// becomes the paragraph's left margin; the editor's Inter, the default font.
// `images`: Map(cid → { src, width, height, alt }), the mail's inline
// images (src: their cid: URL, or a data: URL for the demo's copy); an
// image not in it goes.
const HIGHLIGHT_TEXT = '#1f1f1f'

function inlineImageTag(image) {
  return {
    src: image.src,
    width: String(image.width),
    height: String(image.height),
    alt: image.alt ?? '',
    style: `display:block;width:${image.width}px;max-width:100%;height:auto;margin:0 0 4px;border:0;outline:none;border-radius:16px`,
  }
}

export function inlineComposerStyles(cleanHtml, { images = new Map() } = {}) {
  const styled = sanitizeHtml(cleanHtml, {
    allowedTags: COMPOSER_TAGS,
    allowedAttributes: false,
    allowedSchemesByTag: { img: ['cid', 'data'] },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
    transformTags: {
      '*': (tagName, attribs) => {
        if (tagName === 'img') {
          const image = images.get(attribs['data-inline-cid'])
          return { tagName, attribs: image ? inlineImageTag(image) : {} }
        }
        if (tagName === 'table') return { tagName, attribs: { cellpadding: '0', cellspacing: '0', style: ELEMENT_STYLES.table } }
        const base = ELEMENT_STYLES[tagName]
        if (tagName === 'span' && attribs.style) {
          return { tagName, attribs: { style: attribs.style.replace(/font-family:\s*"?Inter Variable"?, system-ui, sans-serif/, `font-family:${DEFAULT_FONT}`) } }
        }
        // A dark text on the highlight, whatever the client: its light
        // backgrounds stay as written, while a dark-mode client lightens
        // inherited text, which went white on yellow.
        if (tagName === 'mark') return { tagName, attribs: { style: withStyle((attribs.style ?? '').replace(/;?\s*color:\s*inherit/, ''), `color:${HIGHLIGHT_TEXT}`) } }
        if (!base) return { tagName, attribs }
        const indent = /margin-left:\s*(\d+)px/.exec(attribs.style ?? '')?.[1]
        const style = indent && ['p', 'h2', 'h3'].includes(tagName) ? `${base};margin-left:${indent}px` : base
        return { tagName, attribs: { ...attribs, style } }
      },
    },
  })
  return styled.replace(/<p style="([^"]*)"><\/p>/g, '<p style="$1"><br /></p>')
}

// The whole HTML part: the text in its wrapper, the signature (or nothing)
// where the editor had its placeholder. A draft keeps the placeholder
// (`keepPlaceholder`): empty, it shows nothing in the webmail, and the
// composer puts the signature back there when the draft is resumed.
export function buildMailHtml(cleanHtml, { signatureHtml = '', keepPlaceholder = false, images = new Map() } = {}) {
  const styled = inlineComposerStyles(cleanHtml, { images })
  const body = keepPlaceholder ? styled : styled.replace(SIGNATURE_DIV, () => signatureHtml)
  return `<html><head><meta charset="utf-8"></head><body><div style="${WRAPPER_STYLE}">${body}</div></body></html>`
}

// ── The text/plain alternative ─────────────────────────────────────────────

// The sanitized HTML as plain text (the multipart/alternative's other
// part): a paragraph or a heading a line, lists as « - » or « 1. », a quote
// as « > » lines, a link as « text (url) » unless its text is the url, a
// summary box as « label : value » lines set apart, an image as « [Image :
// its alt] », the signature (`signatureText`) where its placeholder was.
// The HTML is
// sanitize-html's output (tags of the allowlist, quoted attributes), which
// a plain tokenizer reads safely.
export function composerHtmlToText(cleanHtml, { signatureText = '' } = {}) {
  const lines = []
  let line = null
  let quoteDepth = 0
  const lists = []
  let marker = null
  let link = null

  const prefix = () => '> '.repeat(quoteDepth)
  const open = () => {
    if (line) return
    const indent = lists.length > 1 ? '  '.repeat(lists.length - 1) : ''
    line = { head: prefix() + indent + (marker ?? (lists.length ? '  ' : '')), text: '' }
    marker = null
  }
  const close = (keepEmpty = false) => {
    if (line) {
      lines.push((line.head + line.text.replace(/\s+$/, '')).replace(/\s+$/, ''))
      line = null
    } else if (keepEmpty) {
      lines.push(prefix().trimEnd())
    }
  }

  const tokens = String(cleanHtml ?? '').matchAll(/<(\/?)([a-z0-9-]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi)
  let blockEmpty = false
  for (const [, closing, rawTag, attributes, rawText] of tokens) {
    if (rawText !== undefined) {
      const text = decodeEntities(rawText).replace(/\s+/g, ' ')
      if (!text.trim() && !line) continue
      open()
      line.text += line.text ? text : text.trimStart()
      blockEmpty = false
      if (link) link.text += text
      continue
    }
    const tag = rawTag.toLowerCase()
    if (tag === 'br') {
      open()
      close()
      continue
    }
    if (tag === 'img') {
      close()
      const alt = decodeEntities(/alt="([^"]*)"/.exec(attributes)?.[1] ?? '').trim()
      lines.push(`${prefix()}[Image${alt ? ` : ${alt}` : ''}]`)
      continue
    }
    if (tag === 'table') {
      close()
      // Set apart by an empty line on each side.
      if (lines.length && lines[lines.length - 1] !== prefix().trimEnd()) lines.push(prefix().trimEnd())
      continue
    }
    if (tag === 'tr') {
      close()
      continue
    }
    if (tag === 'th' && closing) {
      if (line) line.text = `${line.text.replace(/\s+$/, '')} : `
      continue
    }
    if (tag === 'div' && !closing && /data-mail-signature/.test(attributes)) {
      close()
      if (signatureText) {
        // An empty line before « -- », as a signature is set apart.
        if (lines.length && lines[lines.length - 1] !== '') lines.push('')
        for (const signatureLine of signatureText.split('\n')) lines.push(prefix() + signatureLine)
      }
      continue
    }
    if (tag === 'a') {
      if (!closing) {
        link = { href: decodeEntities(/href="([^"]*)"/.exec(attributes)?.[1] ?? ''), text: '' }
      } else if (link) {
        const target = link.href.replace(/^mailto:/i, '')
        if (link.href && target !== link.text.trim() && link.href !== link.text.trim()) {
          open()
          line.text += ` (${target})`
        }
        link = null
      }
      continue
    }
    if (['p', 'h2', 'h3'].includes(tag)) {
      if (!closing) {
        close()
        blockEmpty = true
      } else {
        close(blockEmpty)
        blockEmpty = false
      }
      continue
    }
    if (tag === 'ul' || tag === 'ol') {
      close()
      if (!closing) lists.push({ ordered: tag === 'ol', count: Number(/start="(\d+)"/.exec(attributes)?.[1] ?? 1) - 1 })
      else lists.pop()
      continue
    }
    if (tag === 'li') {
      close()
      if (!closing) {
        const list = lists[lists.length - 1]
        if (list) {
          list.count += 1
          marker = list.ordered ? `${list.count}. ` : '- '
        }
      }
      continue
    }
    if (tag === 'blockquote') {
      close()
      quoteDepth = Math.max(0, quoteDepth + (closing ? -1 : 1))
    }
  }
  close()
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
}

// ── The signature ──────────────────────────────────────────────────────────

// Built here from what the server knows (the identity's name, the
// university's config) and two short choices of the page (its group's
// label, its establishment's id, checked against the config): { html, text }.
// `logos`: [{ cid, width, height, alt }], inline parts of the mail (the
// signature's <img src="cid:…">, with their size and a text for clients that
// don't show images); `src` instead of `cid` for a copy that isn't sent
// (the demo account's). `login`: the session's CAS login where the
// university shows it (mail.signature.showLogin), checked again here
// (signatureLogin: no line for an address or anything else). In the
// editor's look (MailSignatureView): a dash, the name, « Identifiant : »,
// the group, the establishment and the university, the logos.
export function buildMailSignature({ name = '', login = null, group = '', establishment = '', university = '', logos = [] } = {}) {
  const place = [...new Set([establishment, university].map((value) => String(value ?? '').trim()).filter(Boolean))].join(' – ')
  const checkedLogin = signatureLogin(login)
  const lines = [name, checkedLogin ? signatureLoginLine(checkedLogin) : '', group, place].map((value) => String(value ?? '').trim())
  if (!lines.some(Boolean) && !logos.length) return { html: '', text: '' }
  const row = (text, style = '') => (text ? `<div${style ? ` style="${style}"` : ''}>${escapeHtml(text)}</div>` : '')
  const images = logos.map((logo, index) => (
    `<img src="${logo.src ? escapeHtml(logo.src) : `cid:${escapeHtml(logo.cid.replace(/^<|>$/g, ''))}`}" width="${logo.width}" height="${logo.height}" alt="${escapeHtml(logo.alt)}" style="display:inline-block;width:${logo.width}px;height:${logo.height}px;border:0;outline:none;vertical-align:middle${index ? ';margin-left:10px' : ''}" />`
  )).join('')
  const html = `<div style="margin:14px 0 6px;font-size:14px;line-height:1.45;color:${MUTED_COLOR}">`
    + row('—')
    + row(lines[0], `font-weight:600;color:${TEXT_COLOR}`)
    + row(lines[1])
    + row(lines[2])
    + row(lines[3])
    + (images ? `<div style="margin-top:8px;line-height:0">${images}</div>` : '')
    + '</div>'
  const text = ['-- ', ...lines.filter(Boolean)].join('\n')
  return { html, text }
}

// A PNG's size in pixels (its IHDR), or null.
export function readPngSize(buffer) {
  if (!buffer || buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

// ── The page's request ─────────────────────────────────────────────────────

export function sanitizeSubject(value) {
  const text = typeof value === 'string' ? value.slice(0, MAX_SUBJECT_LENGTH * 4) : ''
  return capLength(text.normalize('NFC').replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim(), MAX_SUBJECT_LENGTH).trim()
}

function readRecipientList(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_RECIPIENTS * 2) return null
  return value.map((entry) => ({
    name: typeof entry?.name === 'string' ? entry.name.slice(0, MAX_DISPLAY_NAME_LENGTH * 4) : '',
    email: typeof entry?.email === 'string' ? entry.email.slice(0, 1024) : '',
  }))
}

// A file as a send names it: an upload of the session's, or a part of a
// mail of its mailbox (a forwarded mail's, a draft's). Null for any other.
function readPartReference(entry, isValidMessageId, isValidUploadId) {
  if (entry?.source === 'upload' && isValidUploadId(entry.aid)) return { source: 'upload', aid: entry.aid }
  if (entry?.source === 'message' && isValidMessageId(entry.messageId) && !String(entry.messageId).startsWith('-')
    && typeof entry.part === 'string' && entry.part.length <= 40 && PART_ID_PATTERN.test(entry.part)) {
    return { source: 'message', messageId: entry.messageId, part: entry.part }
  }
  return null
}

const referenceKey = (reference) => (reference.source === 'upload' ? reference.aid : `${reference.messageId}/${reference.part}`)

// The text's images (`inlineImages`): MAX_INLINE_IMAGES at most, each a
// cid of the page's kind, a file reference (readPartReference) and the
// size it shows at, MAX_INLINE_IMAGE_WIDTH wide at most (its height in
// proportion). → [{ cid, source, aid | messageId + part, width, height }],
// or null when malformed.
function readInlineImages(value, isValidMessageId, isValidUploadId) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_INLINE_IMAGES) return null
  const images = []
  for (const entry of value) {
    const cid = typeof entry?.cid === 'string' ? entry.cid.toLowerCase() : ''
    const reference = readPartReference(entry, isValidMessageId, isValidUploadId)
    const width = Number(entry?.width)
    const height = Number(entry?.height)
    if (!INLINE_CID_PATTERN.test(cid) || !reference || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > 4000 || height > 4000) return null
    if (images.some((image) => image.cid === cid || referenceKey(image) === referenceKey(reference))) return null
    const scale = Math.min(1, MAX_INLINE_IMAGE_WIDTH / width)
    images.push({ cid, ...reference, width: Math.round(width * scale), height: Math.max(1, Math.round(height * scale)) })
  }
  return images
}

// A send's or a draft's body, checked. `isValidMessageId(id)`,
// `isValidUploadId(aid)`: the session's own kinds of ids (a real one's
// Zimbra ids, the demo's). A draft takes what a send would refuse
// (no recipient, an address not yet right: left out of the saved draft).
// The text keeps only the images listed in `inlineImages`
// (selectInlineImages), and `inlineImages` only those the text shows.
// → { ok: true, value: { to, cc, bcc, subject, html, attachments,
//      inlineImages: [{ cid, source, aid | messageId + part, width, height,
//      alt }], origin, identityId, draftId, sendUid, signature: { include,
//      mode, group, establishment } } }
//   or { ok: false, error, invalid? } (error: a fixed code for the page).
export function normalizeComposePayload(body, { draft = false, isValidMessageId, isValidUploadId }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'mail_send_invalid' }
  const fields = { to: readRecipientList(body.to), cc: readRecipientList(body.cc), bcc: readRecipientList(body.bcc) }
  if (!fields.to || !fields.cc || !fields.bcc) return { ok: false, error: 'mail_send_invalid' }

  // Each address once across the three fields (the first field it's in),
  // MAX_RECIPIENTS in all.
  const seen = new Set()
  const invalid = []
  const recipients = { to: [], cc: [], bcc: [] }
  let count = 0
  for (const field of ['to', 'cc', 'bcc']) {
    for (const entry of fields[field]) {
      const email = entry.email.trim().normalize('NFC')
      if (!isValidAddress(email)) {
        if (email) invalid.push(capLength(email.replace(CONTROL_CHARACTERS, ''), 254))
        continue
      }
      const key = recipientKey({ email })
      if (seen.has(key)) continue
      seen.add(key)
      count += 1
      if (count > MAX_RECIPIENTS) {
        if (draft) break
        return { ok: false, error: 'mail_send_too_many_recipients' }
      }
      recipients[field].push({ name: sanitizeDisplayName(entry.name, email), email })
    }
  }
  if (!draft && invalid.length) return { ok: false, error: 'mail_send_invalid_recipients', invalid: invalid.slice(0, MAX_RECIPIENTS) }
  if (!draft && !count) return { ok: false, error: 'mail_send_no_recipient' }

  if (body.html !== undefined && typeof body.html !== 'string') return { ok: false, error: 'mail_send_invalid' }
  if ((body.html ?? '').length > MAX_COMPOSER_HTML_LENGTH) return { ok: false, error: 'mail_send_too_large' }

  // Attachments: references only, of the session's kinds, each once.
  const rawAttachments = body.attachments ?? []
  if (!Array.isArray(rawAttachments) || rawAttachments.length > MAX_ATTACHMENTS) return { ok: false, error: 'mail_send_invalid' }
  const attachments = []
  const attachmentKeys = new Set()
  for (const entry of rawAttachments) {
    const reference = readPartReference(entry, isValidMessageId, isValidUploadId)
    if (!reference) return { ok: false, error: 'mail_send_invalid' }
    const key = referenceKey(reference)
    if (attachmentKeys.has(key)) continue
    attachmentKeys.add(key)
    attachments.push(reference)
  }

  // The text's images, none of them a file attached as well.
  const listedImages = readInlineImages(body.inlineImages, isValidMessageId, isValidUploadId)
  if (!listedImages || listedImages.some((image) => attachmentKeys.has(referenceKey(image)))) return { ok: false, error: 'mail_send_invalid' }
  const { html, images: inlineImages } = selectInlineImages(sanitizeComposerHtml(body.html ?? ''), listedImages)

  let origin = null
  if (body.origin !== undefined && body.origin !== null) {
    const kind = body.origin?.kind
    if (!Object.hasOwn(ORIGIN_KINDS, kind) || !isValidMessageId(body.origin.messageId) || String(body.origin.messageId).startsWith('-')) {
      return { ok: false, error: 'mail_send_invalid' }
    }
    origin = { kind, messageId: body.origin.messageId, replyType: ORIGIN_KINDS[kind] }
  }

  const identityId = body.identityId === undefined || body.identityId === null ? null : body.identityId
  if (identityId !== null && (typeof identityId !== 'string' || !IDENTITY_ID_PATTERN.test(identityId))) return { ok: false, error: 'mail_send_invalid' }

  const draftId = body.draftId === undefined || body.draftId === null ? null : body.draftId
  if (draftId !== null && (!isValidMessageId(draftId) || String(draftId).startsWith('-'))) return { ok: false, error: 'mail_send_invalid' }

  const sendUid = draft ? null : body.sendUid
  if (!draft && (typeof sendUid !== 'string' || !SEND_UID_PATTERN.test(sendUid))) return { ok: false, error: 'mail_send_invalid' }

  const rawSignature = body.signature ?? {}
  if (typeof rawSignature !== 'object' || Array.isArray(rawSignature)) return { ok: false, error: 'mail_send_invalid' }
  // Which signature (src/mailSignatureChoice.js), the automatic one when
  // none is named: the server reads the others from the webmail itself.
  const mode = rawSignature.mode === undefined || rawSignature.mode === null ? 'auto' : rawSignature.mode
  if (!isSignatureKind(mode)) return { ok: false, error: 'mail_send_invalid' }
  const group = mode === 'auto' && typeof rawSignature.group === 'string'
    ? capLength(rawSignature.group.slice(0, 1000).normalize('NFC').replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim(), MAX_SIGNATURE_GROUP_LENGTH).trim()
    : ''
  const establishment = mode === 'auto' && typeof rawSignature.establishment === 'string' && ESTABLISHMENT_ID_PATTERN.test(rawSignature.establishment) ? rawSignature.establishment : null

  return {
    ok: true,
    value: {
      ...recipients,
      subject: sanitizeSubject(body.subject),
      html,
      attachments,
      inlineImages,
      origin,
      identityId,
      draftId,
      sendUid,
      signature: { include: rawSignature.include === true, mode, group, establishment },
    },
  }
}

// ── The account's identities (« De : ») ───────────────────────────────────

// Zimbra writes an element's attributes either as { _attrs: { name: value } }
// or as { a: [{ n, _content }] }: one map, a list for a repeated one.
function readZimbraAttrs(element) {
  const attrs = {}
  const add = (name, value) => {
    if (typeof name !== 'string' || value === undefined || value === null) return
    const values = Array.isArray(value) ? value : [value]
    attrs[name] = [...(attrs[name] ?? []), ...values.map(String)]
  }
  if (element?._attrs && typeof element._attrs === 'object') {
    for (const [name, value] of Object.entries(element._attrs)) add(name, value)
  }
  if (Array.isArray(element?.a)) for (const entry of element.a) add(entry?.n, entry?._content)
  return attrs
}

const firstAttr = (attrs, name) => attrs[name]?.find((value) => value.trim())?.trim() ?? ''

// GetIdentitiesResponse and GetInfoResponse (sections mbox, attrs) → the
// identities the account may send as: [{ id, name, email, isDefault }],
// the default first. An identity's address must be one Zimbra lets the
// account use (its name, its aliases, zimbraAllowFromAddress), checked
// here as Zimbra would on the send: a persona with any other address is
// left out. Without a usable identity, the account's own address.
export function normalizeZimbraIdentities(identitiesResponse, infoResponse) {
  const infoAttrs = readZimbraAttrs(infoResponse?.attrs)
  const accountName = String(infoResponse?.name ?? '').trim()
  const accountDisplay = sanitizeDisplayName(firstAttr(infoAttrs, 'displayName') || [firstAttr(infoAttrs, 'givenName'), firstAttr(infoAttrs, 'sn')].filter(Boolean).join(' '), accountName)
  const allowed = new Set(
    [accountName, ...(infoAttrs.zimbraMailAlias ?? []), ...(infoAttrs.zimbraAllowFromAddress ?? [])]
      .map((address) => String(address).trim().toLowerCase())
      .filter(Boolean),
  )
  const list = Array.isArray(identitiesResponse?.identity) ? identitiesResponse.identity : []
  const identities = []
  const seen = new Set()
  for (const identity of list) {
    const attrs = readZimbraAttrs(identity)
    const id = String(identity?.id ?? firstAttr(attrs, 'zimbraPrefIdentityId'))
    const isDefault = identity?.name === 'DEFAULT' || firstAttr(attrs, 'zimbraPrefIdentityName') === 'DEFAULT'
    const email = firstAttr(attrs, 'zimbraPrefFromAddress') || (isDefault ? accountName : '')
    if (!IDENTITY_ID_PATTERN.test(id) || seen.has(id) || !isValidAddress(email) || !allowed.has(email.toLowerCase())) continue
    seen.add(id)
    identities.push({ id, name: sanitizeDisplayName(firstAttr(attrs, 'zimbraPrefFromDisplay'), email) || accountDisplay, email, isDefault })
  }
  identities.sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
  if (!identities.length && isValidAddress(accountName)) {
    identities.push({ id: 'default', name: accountDisplay, email: accountName, isDefault: true })
  }
  return identities.slice(0, MAX_IDENTITIES)
}

// The webmail signatures each identity names (GetIdentitiesResponse:
// zimbraPrefDefaultSignatureId, zimbraPrefForwardReplySignatureId), by the
// identity's id as normalizeZimbraIdentities reads it: Map(id → {
// signatureId, replySignatureId }), an id of an unexpected shape as null.
const SIGNATURE_ID = /^[A-Za-z0-9-]{1,64}$/

export function readIdentitySignatureIds(identitiesResponse) {
  const ids = new Map()
  const list = Array.isArray(identitiesResponse?.identity) ? identitiesResponse.identity : []
  for (const identity of list.slice(0, MAX_IDENTITIES * 2)) {
    const attrs = readZimbraAttrs(identity)
    const id = String(identity?.id ?? firstAttr(attrs, 'zimbraPrefIdentityId'))
    if (!IDENTITY_ID_PATTERN.test(id) || ids.has(id)) continue
    const read = (name) => {
      const value = firstAttr(attrs, name)
      return SIGNATURE_ID.test(value) ? value : null
    }
    ids.set(id, { signatureId: read('zimbraPrefDefaultSignatureId'), replySignatureId: read('zimbraPrefForwardReplySignatureId') })
  }
  return ids
}

// The identity a send uses: the one asked for, from the list, or the
// default when none is asked; null for an id the account doesn't have.
export function pickIdentity(identities, identityId) {
  if (!identityId) return identities[0] ?? null
  return identities.find((identity) => identity.id === identityId) ?? null
}

// ── The <m> element ────────────────────────────────────────────────────────

// `ci` goes bare: Zimbra puts the angle brackets around it itself (sent
// with them, the header came out « <<…>> », which Partage's webmail can't
// match to the <img src="cid:…">: broken images, listed as attachments).
// `identity`: pickIdentity's; `inlineParts`: [{ cid, aid } | { cid,
// messageId, part }] (the signature's logos, the text's images: uploads, or
// parts of a saved draft); `attachments`: normalizeComposePayload's references; `origin`:
// { messageId, replyType, messageIdHeader } (the original's Message-ID, read
// by the server, for In-Reply-To); `draftId`: a send's draft to delete
// (did), a save's draft to replace (id).
export function buildZimbraMessage({ identity, to = [], cc = [], bcc = [], subject = '', html, text, inlineParts = [], attachments = [], origin = null, draftId = null, forDraft = false }) {
  const address = (type) => (entry) => (entry.name ? { t: type, a: entry.email, p: entry.name } : { t: type, a: entry.email })
  const message = {}
  if (identity && identity.id !== 'default') message.idnt = identity.id
  if (draftId) message[forDraft ? 'id' : 'did'] = draftId
  if (origin) {
    message.origid = origin.messageId
    message.rt = origin.replyType
    if (origin.replyType === 'r' && origin.messageIdHeader) message.irt = { _content: origin.messageIdHeader }
  }
  message.e = [
    ...(identity ? [address('f')(identity)] : []),
    ...to.map(address('t')),
    ...cc.map(address('c')),
    ...bcc.map(address('b')),
  ]
  message.su = { _content: subject }
  const htmlPart = { ct: 'text/html', content: { _content: html } }
  message.mp = [{
    ct: 'multipart/alternative',
    mp: [
      { ct: 'text/plain', content: { _content: text } },
      inlineParts.length
        ? { ct: 'multipart/related', mp: [htmlPart, ...inlineParts.map((part) => ({
          ci: part.cid.replace(/^<|>$/g, ''),
          attach: part.aid ? { aid: part.aid } : { mp: [{ mid: part.messageId, part: part.part }] },
        }))] }
        : htmlPart,
    ],
  }]
  const uploads = attachments.filter((entry) => entry.source === 'upload').map((entry) => entry.aid)
  const parts = attachments.filter((entry) => entry.source === 'message').map((entry) => ({ mid: entry.messageId, part: entry.part }))
  if (uploads.length || parts.length) {
    message.attach = {}
    if (uploads.length) message.attach.aid = uploads.join(',')
    if (parts.length) message.attach.mp = parts
  }
  return message
}

// The order the attachments end up in the mail: Zimbra adds the uploads
// (aid) first, then the parts of other mails (ParseMimeMessage), whatever
// order the page had them in. Indices into `attachments`.
export function zimbraAttachmentOrder(attachments) {
  const indices = attachments.map((entry, index) => ({ entry, index }))
  return [
    ...indices.filter(({ entry }) => entry.source === 'upload').map(({ index }) => index),
    ...indices.filter(({ entry }) => entry.source !== 'upload').map(({ index }) => index),
  ]
}

// A saved draft's attachments: the parts after its body in its top
// multipart/mixed, in order → [{ part, name, size, contentType }].
export function readDraftAttachmentParts(message) {
  const root = Array.isArray(message?.mp) ? message.mp[0] : null
  if (!root || String(root.ct ?? '').toLowerCase() !== 'multipart/mixed' || !Array.isArray(root.mp)) return []
  return root.mp.slice(1)
    .filter((part) => typeof part?.part === 'string' && PART_ID_PATTERN.test(part.part))
    // An image of the text, should Zimbra have put it there: not a file.
    .filter((part) => !INLINE_CID_PATTERN.test(String(part.ci ?? '').trim().replace(/^<|>$/g, '').toLowerCase()))
    .map((part) => ({
      part: part.part,
      name: sanitizeAttachmentName(part.filename),
      size: Number.isSafeInteger(Number(part.s)) && Number(part.s) > 0 ? Number(part.s) : null,
      contentType: String(part.ct ?? 'application/octet-stream').toLowerCase(),
    }))
}

// A saved draft's inline images: the parts anywhere in it with a Content-ID
// of the composer's kind (INLINE_CID_PATTERN) → [{ cid, part, name, size,
// contentType }], once each.
export function readDraftInlineParts(message) {
  const found = []
  const walk = (parts) => {
    for (const part of Array.isArray(parts) ? parts : []) {
      if (!part || typeof part !== 'object') continue
      if (Array.isArray(part.mp)) walk(part.mp)
      const cid = String(part.ci ?? '').trim().replace(/^<|>$/g, '').toLowerCase()
      const contentType = String(part.ct ?? '').toLowerCase()
      if (!INLINE_CID_PATTERN.test(cid) || !INLINE_IMAGE_TYPES.has(contentType) || typeof part.part !== 'string' || !PART_ID_PATTERN.test(part.part)) continue
      if (found.some((entry) => entry.cid === cid)) continue
      found.push({
        cid,
        part: part.part,
        name: sanitizeAttachmentName(part.filename),
        size: Number.isSafeInteger(Number(part.s)) && Number(part.s) > 0 ? Number(part.s) : null,
        contentType,
      })
    }
  }
  walk(message?.mp)
  return found
}

// After a save, the text's images as parts of the draft, by their cid
// (Zimbra keeps the Content-ID it was given): [{ cid, messageId, part } |
// null], in the page's order, and the uploads now parts of it (`used`: to
// forget, as settleDraftAttachments).
export function settleDraftInlineImages(images, draftId, parts) {
  const byCid = new Map(parts.map((part) => [part.cid, part]))
  const mapped = images.map((image) => (byCid.has(image.cid) ? { cid: image.cid, messageId: draftId, part: byCid.get(image.cid).part } : null))
  const used = images.filter((image, index) => image.source === 'upload' && mapped[index]).map((image) => image.aid)
  return { inlineImages: mapped, used }
}

// After a save, each of the page's references as a part of the draft (its
// uploads are gone from Zimbra once used): [{ messageId, part } | null], in
// the page's order. By position (zimbraAttachmentOrder), when the draft has
// as many attachments as were sent; else by name where one matches
// (`names`: the page's references' file names, null where unknown).
export function mapDraftAttachments(attachments, draftId, parts, names = []) {
  const order = zimbraAttachmentOrder(attachments)
  const result = attachments.map(() => null)
  if (parts.length === attachments.length) {
    order.forEach((index, position) => {
      result[index] = { messageId: draftId, part: parts[position].part }
    })
    return result
  }
  const free = [...parts]
  attachments.forEach((entry, index) => {
    const name = names[index] ? sanitizeAttachmentName(names[index]) : null
    const at = name ? free.findIndex((part) => part.name === name) : -1
    if (at >= 0) result[index] = { messageId: draftId, part: free.splice(at, 1)[0].part }
  })
  return result
}

// A saved draft's references (mapDraftAttachments) and the uploads now
// parts of it (`used`: to forget, Partage has them in the draft). An upload
// left unmapped isn't among them: the page names it again on its next save,
// so it's still one the session may name (Partage refusing it if it's
// gone, 409 with its aid: the composer asks for it again).
export function settleDraftAttachments(attachments, draftId, parts, names = []) {
  const mapped = mapDraftAttachments(attachments, draftId, parts, names)
  const used = attachments.filter((entry, index) => entry.source === 'upload' && mapped[index]).map((entry) => entry.aid)
  return { attachments: mapped, used }
}

// ── Zimbra's faults ────────────────────────────────────────────────────────

// A failed SendMsgRequest (error.zimbraCode, error.zimbraArgs: the fault's
// code and its <a n=…> arguments, set by zimbraSoapRequest) → what the page
// is told: { status, code, invalid?, aids? }, or null for any other
// failure (the generic answer, sendMailRouteError). The addresses and ids
// sent back are only ever ones the page sent: nothing else of the fault.
export function mapZimbraSendFault(error, { recipients = [], aids = [] } = {}) {
  const code = String(error?.zimbraCode ?? '')
  const args = Array.isArray(error?.zimbraArgs) ? error.zimbraArgs : []
  const argValues = (...names) => args.filter((arg) => names.includes(arg?.n)).flatMap((arg) => String(arg?._content ?? '').split(/[,\s]+/)).filter(Boolean)
  if (code === 'mail.SEND_ABORTED_ADDRESS_FAILURE' || code === 'mail.SEND_PARTIAL_ADDRESS_FAILURE') {
    const named = new Set(argValues('invalid', 'unsent').map((value) => value.replace(/^<|>$/g, '').toLowerCase()))
    const invalid = recipients.filter((email) => named.has(email.toLowerCase()))
    return code === 'mail.SEND_PARTIAL_ADDRESS_FAILURE'
      ? { status: 200, code: 'mail_send_partial', invalid }
      : { status: 422, code: 'mail_send_invalid_recipients', invalid }
  }
  if (code === 'mail.NO_SUCH_UPLOAD') {
    const named = new Set(argValues('id', 'aid'))
    return { status: 409, code: 'mail_send_upload_expired', aids: aids.filter((aid) => named.has(aid)) }
  }
  if (/QUOTA_EXCEEDED/.test(code)) return { status: 413, code: 'mail_send_quota' }
  if (/MESSAGE_TOO_BIG|TOO_LARGE|UPLOAD_TOO_LARGE/.test(code)) return { status: 413, code: 'mail_send_too_large' }
  if (/NO_SUCH_(MSG|ITEM|PART)/.test(code)) return { status: 409, code: 'mail_send_missing_reference' }
  return null
}

const isPartialSend = (error) => error?.zimbraCode === 'mail.SEND_PARTIAL_ADDRESS_FAILURE'

// SendMsgRequest (`request(message)`, the same suid each time) → null once
// sent, or the SEND_PARTIAL_ADDRESS_FAILURE fault when it went to some
// addresses only (sent all the same: mapZimbraSendFault names the others).
// The draft it replaces gone meanwhile (sent or deleted in the webmail):
// sent once more without it (`message.did` dropped), a partial send read
// the same way on that second try.
export async function submitZimbraSend(request, message) {
  const attempt = async () => {
    try {
      await request(message)
      return null
    } catch (error) {
      if (isPartialSend(error)) return error
      throw error
    }
  }
  try {
    return await attempt()
  } catch (error) {
    if (!message.did || !/NO_SUCH_(MSG|ITEM)/.test(String(error?.zimbraCode ?? ''))) throw error
    delete message.did
    return attempt()
  }
}

// ── Limits ────────────────────────────────────────────────────────────────

// Sends (or saves) per key over sliding windows: `perMinute` and `perDay`
// mails, `recipientsPerDay` recipients (null: no such limit). `take(keys,
// recipients)` counts one for every key when all of them allow it →
// { ok: true, release } or { ok: false, retryAfter } (seconds, the longest
// wait).
// Keys idle for a day are forgotten (looked over once a minute at most).
export function createSendLimiter({ perMinute, perDay, recipientsPerDay = null }) {
  const MINUTE = 60_000
  const DAY = 24 * 60 * MINUTE
  const entries = new Map()
  let prunedAt = 0

  function prune(now) {
    if (now - prunedAt < MINUTE) return
    prunedAt = now
    for (const [key, events] of entries) {
      const kept = events.filter((event) => now - event.at < DAY)
      if (kept.length) entries.set(key, kept)
      else entries.delete(key)
    }
  }

  function wait(key, recipients, now) {
    const events = (entries.get(key) ?? []).filter((event) => now - event.at < DAY)
    entries.set(key, events)
    const minute = events.filter((event) => now - event.at < MINUTE)
    let until = 0
    if (minute.length >= perMinute) until = Math.max(until, minute[minute.length - perMinute].at + MINUTE)
    if (events.length >= perDay) until = Math.max(until, events[events.length - perDay].at + DAY)
    if (recipientsPerDay !== null) {
      let total = events.reduce((sum, event) => sum + event.recipients, 0) + recipients
      for (const event of events) {
        if (total <= recipientsPerDay) break
        total -= event.recipients
        until = Math.max(until, event.at + DAY)
      }
      if (recipients > recipientsPerDay) until = now + DAY
    }
    return until > now ? Math.max(1, Math.ceil((until - now) / 1000)) : 0
  }

  // `release()`: a send the server refused before anything went (an
  // identity not the account's, an upload gone) gives its count back.
  function take(keys, recipients = 0, now = Date.now()) {
    prune(now)
    const retryAfter = Math.max(0, ...keys.map((key) => wait(key, recipients, now)))
    if (retryAfter) return { ok: false, retryAfter }
    const event = { at: now, recipients }
    for (const key of keys) entries.get(key).push(event)
    return {
      ok: true,
      release() {
        for (const key of keys) {
          const events = entries.get(key)
          const index = events?.indexOf(event) ?? -1
          if (index >= 0) events.splice(index, 1)
        }
      },
    }
  }

  return { take, _entries: entries }
}

// ── A send asked for twice ─────────────────────────────────────────────────

// The sends a key (a session) asked for, by the page's send uid: the page
// tries a send once more, with the same uid, when its answer never came
// (src/mailSendQueue.js). The first one may have gone through all the same,
// its uploads used and forgotten since: checked again, the retry would be
// refused as « to attach again », and the mail sent anew. So a uid seen
// shares the first one's outcome instead (`run(key, uid, fn)`: fn's promise,
// started once): its answer once sent, the same wait while it goes. A send
// that failed is forgotten, for a later try to go (nothing left: Zimbra's
// suid covers one that went through all the same). `ttlMs` and `perKey`
// bound what's kept; keys idle past ttlMs are dropped (looked over once a
// minute at most).
export function createSendOnce({ ttlMs = 10 * 60_000, perKey = 20 } = {}) {
  const entries = new Map()
  let prunedAt = 0

  function prune(now) {
    if (now - prunedAt < 60_000) return
    prunedAt = now
    for (const [key, sends] of entries) {
      for (const [uid, entry] of sends) {
        if (now - entry.at >= ttlMs) sends.delete(uid)
      }
      if (!sends.size) entries.delete(key)
    }
  }

  function find(key, uid, now = Date.now()) {
    prune(now)
    const entry = entries.get(key)?.get(uid)
    return entry && now - entry.at < ttlMs ? entry : null
  }

  // Whether `uid` was asked for already (the limits aren't counted again).
  const has = (key, uid, now = Date.now()) => Boolean(find(key, uid, now))

  function run(key, uid, fn, now = Date.now()) {
    const known = find(key, uid, now)
    if (known) return known.promise
    let sends = entries.get(key)
    if (!sends) {
      sends = new Map()
      entries.set(key, sends)
    }
    const entry = { at: now, promise: Promise.resolve().then(fn) }
    sends.delete(uid)
    sends.set(uid, entry)
    while (sends.size > perKey) sends.delete(sends.keys().next().value)
    entry.promise.catch(() => {
      if (sends.get(uid) === entry) sends.delete(uid)
    })
    return entry.promise
  }

  return { has, run, forget: (key) => entries.delete(key), _entries: entries }
}

// ── A draft, back into the composer ────────────────────────────────────────

// Plain text as the editor's paragraphs (a draft written as text elsewhere).
export function plainTextToComposerHtml(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}

function findBodyParts(parts, found = []) {
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!part || typeof part !== 'object') continue
    if (part.body && typeof part.content === 'string') found.push({ type: String(part.ct ?? '').toLowerCase(), content: part.content })
    else if (String(part.ct ?? '').toLowerCase().startsWith('multipart/')) findBodyParts(part.mp, found)
  }
  return found
}

// The draft's HTML with its images as the editor holds them: an <img
// src="cid:…"> of one of its inline parts (`cids`) becomes an
// img[data-inline-cid] (sanitizeComposerHtml keeps it), any other <img>
// goes. → { html, used (the cids shown, in order), dropped (images left
// out: one Partage lost the part of) }.
function readDraftImages(html, cids) {
  const used = []
  let dropped = 0
  const out = sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    allowVulnerableTags: true,
    transformTags: {
      img: (tagName, attribs) => {
        const cid = String(attribs.src ?? '').trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').toLowerCase()
        if (!/^cid:/i.test(String(attribs.src ?? '').trim()) || !cids.has(cid) || used.includes(cid)) {
          if (/^cid:tafac-img-/i.test(String(attribs.src ?? '').trim())) dropped += 1
          return { tagName, attribs: {} }
        }
        used.push(cid)
        const { width, height, alt } = attribs
        return { tagName, attribs: { 'data-inline-cid': cid, ...(alt ? { alt } : null), ...(width ? { width } : null), ...(height ? { height } : null) } }
      },
    },
  })
  return { html: out, used, dropped }
}

// A draft as GetMsgRequest gives it (html: 1, neuter: 0: its HTML as
// saved) → what the composer opens with: { id, to, cc, bcc, subject, html
// (sanitizeComposerHtml's: what the editor itself may hold), attachments:
// [{ part, name, size, contentType }], inlineImages: [{ cid, part, name,
// size, contentType, width, height }] (the text's, by their part),
// droppedImages (how many of the composer's images came back without
// their part), identityId (one of `identities`, else null), origin: {
// kind, messageId } (the mail it answers or forwards) }.
export function readDraftForComposer(message, identities = []) {
  const addresses = Array.isArray(message?.e) ? message.e : []
  const pick = (type) => {
    const seen = new Set()
    return addresses
      .filter((entry) => entry?.t === type && isValidAddress(entry.a))
      .map((entry) => ({ name: sanitizeDisplayName(entry.p || entry.d || '', entry.a), email: String(entry.a).trim() }))
      .filter((entry) => !seen.has(recipientKey(entry)) && seen.add(recipientKey(entry)))
  }
  const bodies = findBodyParts(message?.mp)
  const htmlBody = bodies.find((body) => body.type === 'text/html')
  const textBody = bodies.find((body) => body.type === 'text/plain')
  const inlineParts = readDraftInlineParts(message)
  const images = htmlBody ? readDraftImages(htmlBody.content, new Set(inlineParts.map((part) => part.cid))) : { html: '', used: [], dropped: 0 }
  const html = htmlBody ? sanitizeComposerHtml(images.html) : sanitizeComposerHtml(plainTextToComposerHtml(textBody?.content ?? ''))
  // Each image's size as the text has it (its <img>'s width and height).
  const sizes = new Map([...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => {
    const read = (name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null
    return [read('data-inline-cid'), { width: Number(read('width')) || null, height: Number(read('height')) || null }]
  }))
  const identityId = identities.some((identity) => identity.id === message?.idnt) ? message.idnt : null
  const originId = String(message?.origid ?? '')
  const origin = /^\d{1,10}$/.test(originId) && (message?.rt === 'r' || message?.rt === 'w')
    ? { kind: message.rt === 'w' ? 'forward' : 'reply', messageId: originId }
    : null
  return {
    id: String(message?.id ?? ''),
    to: pick('t'),
    cc: pick('c'),
    bcc: pick('b'),
    subject: sanitizeSubject(message?.su ?? ''),
    html,
    attachments: readDraftAttachmentParts(message),
    inlineImages: images.used.map((cid) => ({ ...inlineParts.find((part) => part.cid === cid), ...sizes.get(cid) })),
    droppedImages: images.dropped,
    identityId,
    origin,
  }
}
