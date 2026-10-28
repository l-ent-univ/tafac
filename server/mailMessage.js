// A mail's body for the mail page's reader, from Zimbra's GetMsgResponse.
//
// The HTML is untrusted: it's cleaned here (allowlist, sanitize-html) and the
// page still shows it in a sandboxed iframe without scripts, under a CSP that
// keeps remote content out (src/components/MailReader.jsx). Here:
// - scripts, forms, frames, embeds, SVG/MathML, <meta>/<base>/<link> and
//   event attributes go; links keep http(s)/mailto/tel (and #anchors) only,
//   a relative one loses its href;
// - cid: images point to the part proxy (/__ent_auth/mail/part), data:
//   images stay, remote images move to data-remote-src (loaded only when the
//   student asks, the CSP blocks them otherwise);
// - the CSS's url()s (style attributes, <style>) get the same treatment,
//   any other URL in them goes (rewriteCssUrls);
// - a plain text body becomes escaped HTML with its links clickable.
import sanitizeHtml from 'sanitize-html'
import { escapeHtml } from '../src/mailText.js'

const MAIL_PART_PATH = '/__ent_auth/mail/part'
const PART_ID_PATTERN = /^\d+(?:\.\d+)*$/
// Shown inline by the part proxy; anything else downloads.
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])

const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption',
  'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i',
  'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section',
  'small', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var', 'wbr',
]

const GLOBAL_ATTRIBUTES = [
  'align', 'valign', 'dir', 'lang', 'title', 'class', 'id', 'style', 'width', 'height', 'bgcolor',
  'color', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'nowrap', 'face', 'size',
  'start', 'type', 'reversed', 'span', 'headers', 'scope', 'abbr', 'summary', 'cite', 'datetime',
  'hspace', 'vspace', 'rules', 'frame', 'background', 'data-remote-background', 'data-remote-style',
]

const COLOR_PATTERN = /^#?[0-9a-z]{1,20}$/i

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value)
}

function normalizeCid(value) {
  let cid = String(value ?? '').trim().replace(/^cid:/i, '').replace(/^<|>$/g, '')
  try {
    cid = decodeURIComponent(cid)
  } catch {
    // Kept as written
  }
  return cid.toLowerCase()
}

export function buildMailPartHref(messageId, part, { download = false } = {}) {
  const params = new URLSearchParams({ id: messageId, part })
  if (download) params.set('download', '1')
  return `${MAIL_PART_PATH}?${params}`
}

export function isValidMailPartId(value) {
  return typeof value === 'string' && value.length <= 40 && PART_ID_PATTERN.test(value)
}

// A Zimbra item id as the mail routes take it: the digits of a message or a
// conversation in the student's own mailbox, a leading minus for the virtual
// conversation Zimbra gives a lone mail (the list's rows, /mail/thread).
// Nothing else reaches Zimbra: no `zid:id` cross-mailbox reference (a shared
// mailbox's item, which the page never lists), no path or query characters
// for the REST part URL. Ten digits cover Zimbra's 32-bit item ids.
export function isValidMailMessageId(value) {
  return typeof value === 'string' && /^-?\d{1,10}$/.test(value)
}

// The demo account's ids (src/demoAccount.js: demo-mail-1…; its drafts and
// sent mails, demo-draft-1… and demo-sent-1…, kept in the server's memory).
// Accepted only for a demo session, whose routes never call Zimbra: a real
// session's ids stay numeric.
export function isValidDemoMailMessageId(value) {
  return typeof value === 'string' && /^demo-(?:mail|draft|sent)-\d{1,4}$/.test(value)
}

// The mail's CSS (style attributes, <style> blocks) loads things too:
// `background:url(...)`, list markers, cursors, fonts. The frame is
// same-origin with the app, so a path there (`url(/__ent_proxy/...)`) would
// be an authenticated request with the student's cookies, sent just by
// opening the mail; the frame's CSP lets only the part proxy in, and this is
// the wall before it. Each url() is read (CSS escapes decoded) and becomes:
// - data:image/... kept, cid: the part proxy's URL (unknown: dropped);
// - http(s): held back like a remote <img> (`none` until the student asks,
//   the original kept aside for « Afficher », counted with the images);
// - anything else (relative and absolute paths, other schemes): dropped.
// A url( this can't read goes whole, a function name spelled with escapes
// that isn't plain once decoded is broken; image-set() and image(), which
// take bare strings as URLs, go whole too (`none`); @import goes (the CSP
// blocks it anyway). What's written back is escaped: nothing can close the
// <style> or the attribute it sits in.
const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|\r\n|([^]))/gi
const CSS_ESCAPED_FUNCTION = /(?:[\w-]|\\[0-9a-f]{1,6}[ \t\n\r\f]?|\\[^\n\r\f0-9a-f])+(?=\()/gi
const CSS_URL = /url\(\s*(?:"((?:[^"\\\n]|\\[^])*)"|'((?:[^'\\\n]|\\[^])*)'|([^"'()\s\\]*))\s*\)|url\([^)]*\)?/gi
const CSS_STRING_URL_FUNCTION = /(?:-webkit-)?\b(?:image-set|image)\(/gi
const CSS_IMPORT = /@import\b[^;{}]*;?/gi
// Inside a <style>: what htmlparser2 kept raw. sanitize-html writes the end
// tag as </style>, and the raw text can't hold one.
const STYLE_ELEMENT = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi

function decodeCssEscapes(value) {
  return value.replace(CSS_ESCAPE, (match, hex, char) => {
    if (hex) {
      const codePoint = Number.parseInt(hex, 16)
      return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff) ? String.fromCodePoint(codePoint) : '\ufffd'
    }
    // A backslash before a line break continues the string: nothing.
    return char === undefined || /[\n\r\f]/.test(char) ? '' : char
  })
}

function cssUrl(value) {
  return `url("${value.replace(/[^\w\-.:/?#=&%+,;~@!$*]/g, (char) => `\\${char.codePointAt(0).toString(16)} `)}")`
}

// Each call of those functions, up to its matching parenthesis (or the end),
// becomes `none`.
function dropCssFunctions(css, pattern) {
  let result = ''
  let last = 0
  for (const match of css.matchAll(pattern)) {
    if (match.index < last) continue
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < css.length; end += 1) {
      if (css[end] === '(') depth += 1
      else if (css[end] === ')' && (depth -= 1) === 0) break
    }
    result += `${css.slice(last, match.index)}none`
    last = end + 1
  }
  return result + css.slice(last)
}

// css → { held, revealed, remote }: `held` without the remote URLs, `revealed`
// with them (the same otherwise), `remote` how many there were.
function rewriteCssUrls(css, resolveCid) {
  let remote = 0
  const unescaped = String(css ?? '')
    .replace(CSS_ESCAPED_FUNCTION, (name) => {
      if (!name.includes('\\')) return name
      const decoded = decodeCssEscapes(name)
      return /^[a-z-]+$/i.test(decoded) ? decoded : 'x-invalid'
    })
    .replace(CSS_IMPORT, '')
  const normalized = dropCssFunctions(unescaped, CSS_STRING_URL_FUNCTION)
  const parts = []
  let last = 0
  for (const match of normalized.matchAll(CSS_URL)) {
    parts.push(normalized.slice(last, match.index))
    last = match.index + match[0].length
    const [, doubleQuoted, singleQuoted, bare] = match
    if (doubleQuoted === undefined && singleQuoted === undefined && bare === undefined) {
      // A url( not read as one (escapes in a bare URL, stray quotes): gone,
      // up to its closing parenthesis.
      parts.push('none')
      continue
    }
    const value = decodeCssEscapes(doubleQuoted ?? singleQuoted ?? bare).trim()
    if (/^data:image\//i.test(value)) {
      parts.push(cssUrl(value))
    } else if (/^cid:/i.test(value)) {
      const resolved = resolveCid(normalizeCid(value))
      parts.push(resolved ? cssUrl(resolved) : 'none')
    } else if (isRemoteUrl(value)) {
      remote += 1
      parts.push({ remote: cssUrl(value) })
    } else {
      parts.push('none')
    }
  }
  parts.push(normalized.slice(last))
  const join = (reveal) => parts.map((part) => (typeof part === 'string' ? part : (reveal ? part.remote : 'none'))).join('')
  return { held: join(false), revealed: remote ? join(true) : null, remote }
}

// `resolveCid(cid)`: the URL of the inline image with that Content-ID, or null.
// Returns { html, remoteImages } where remoteImages counts what was held back.
export function sanitizeMailHtml(html, { resolveCid = () => null } = {}) {
  let remoteImages = 0

  // `background` (tables, cells): held back like a remote <img>, cid:
  // resolved. An incoming data-remote-background is never trusted.
  const holdRemoteBackground = (attribs) => {
    const { background: rawBackground, 'data-remote-background': _ignored, ...rest } = attribs
    const background = String(rawBackground ?? '').trim()
    if (isRemoteUrl(background)) {
      remoteImages += 1
      return { ...rest, 'data-remote-background': background }
    }
    const resolved = /^cid:/i.test(background) ? resolveCid(normalizeCid(background)) : null
    return resolved ? { ...rest, background: resolved } : rest
  }

  // A style attribute's url()s (rewriteCssUrls): the one with its remote
  // images waits in data-remote-style. An incoming one is never trusted.
  const cleanStyleAttribute = (attribs) => {
    const { 'data-remote-style': _ignored, ...rest } = attribs
    if (rest.style === undefined) return rest
    const { held, revealed, remote } = rewriteCssUrls(rest.style, resolveCid)
    remoteImages += remote
    rest.style = held
    if (revealed) rest['data-remote-style'] = revealed
    return rest
  }

  const clean = sanitizeHtml(String(html ?? ''), {
    allowedTags: ALLOWED_TAGS,
    allowVulnerableTags: true,
    allowedAttributes: {
      '*': GLOBAL_ATTRIBUTES,
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'data-remote-src'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'background'],
    allowProtocolRelative: false,
    // Their text goes with them (not just the tag).
    nonTextTags: ['script', 'textarea', 'option', 'noscript', 'title', 'xml', 'select', 'button'],
    transformTags: {
      // The mail's own page colours and spacing survive on a wrapper.
      // bgcolor/text, which a <div> ignores, become its style.
      body: (_tagName, { bgcolor, text, ...attribs }) => {
        const colors = [
          COLOR_PATTERN.test(bgcolor ?? '') ? `background-color:${bgcolor}` : null,
          COLOR_PATTERN.test(text ?? '') ? `color:${text}` : null,
        ].filter(Boolean)
        const style = [...colors, attribs.style].filter(Boolean).join(';')
        return { tagName: 'div', attribs: { ...attribs, ...(style ? { style } : {}), class: 'tafac-mail-body' } }
      },
      a: (tagName, { href: rawHref, ...attribs }) => {
        const href = String(rawHref ?? '').trim()
        // Anchors within the mail stay in the frame, the rest opens a tab.
        const target = href.startsWith('#') ? '_self' : '_blank'
        // A relative link has nothing to point at in a mail but this app
        // (the frame is same-origin with it): it goes, the text stays.
        const kept = /^(?:#|https?:|mailto:|tel:)/i.test(href)
        return { tagName, attribs: { ...attribs, ...(kept ? { href } : {}), target, rel: 'noopener noreferrer' } }
      },
      img: (tagName, attribs) => {
        const { src: rawSrc, 'data-remote-src': _ignored, ...rest } = attribs
        const src = String(rawSrc ?? '').trim()
        if (/^cid:/i.test(src)) {
          const resolved = resolveCid(normalizeCid(src))
          return { tagName, attribs: resolved ? { ...rest, src: resolved } : rest }
        }
        if (isRemoteUrl(src)) {
          remoteImages += 1
          return { tagName, attribs: { ...rest, 'data-remote-src': src } }
        }
        return { tagName, attribs: /^data:image\//i.test(src) ? { ...rest, src } : rest }
      },
      '*': (tagName, attribs) => ({ tagName, attribs: cleanStyleAttribute(holdRemoteBackground(attribs)) }),
    },
    // An <img> left without a source (cid not found, other scheme) is dropped.
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src && !frame.attribs['data-remote-src'],
  })

  // <style> blocks, as sanitize-html left them (raw): their url()s too, the
  // version with the remote images kept in data-remote-css for « Afficher ».
  const styled = clean.replace(STYLE_ELEMENT, (_match, attributes, css) => {
    const { held, revealed, remote } = rewriteCssUrls(css, resolveCid)
    remoteImages += remote
    const reveal = revealed ? ` data-remote-css="${escapeHtml(revealed)}"` : ''
    return `<style${attributes}${reveal}>${held.replace(/<\/(style)/gi, '<\\/$1')}</style>`
  })

  return { html: styled, remoteImages }
}

const TEXT_LINK_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi

// A plain text body as HTML: escaped, links clickable (trailing punctuation
// left out of them), lines kept.
export function mailTextToHtml(text) {
  const source = String(text ?? '')
  let html = ''
  let last = 0
  for (const match of source.matchAll(TEXT_LINK_PATTERN)) {
    const url = match[0].replace(/[.,;:!?)\]}]+$/, '')
    html += escapeHtml(source.slice(last, match.index))
    html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
    last = match.index + url.length
  }
  html += escapeHtml(source.slice(last))
  return `<div class="tafac-mail-text">${html}</div>`
}

function attachmentName(part) {
  if (part.filename) return String(part.filename)
  if (part.ct === 'message/rfc822') return 'Message joint.eml'
  if (part.ct === 'text/calendar') return 'Invitation.ics'
  return 'Pièce jointe'
}

// Walks the MIME tree: the body parts Zimbra marked (body: true), the inline
// images by Content-ID, the other leaves as attachments. An attached message
// (message/rfc822) is one attachment, its own parts aren't read.
function collectParts(parts, found) {
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!part || typeof part !== 'object') continue
    const partId = String(part.part ?? '')
    const type = String(part.ct ?? '').toLowerCase()

    if (part.body && typeof part.content === 'string') {
      found.bodies.push({ type, content: part.content, truncated: Boolean(part.truncated) })
      continue
    }
    if (type.startsWith('multipart/')) {
      collectParts(part.mp, found)
      continue
    }
    if (!isValidMailPartId(partId)) continue

    const entry = {
      part: partId,
      name: attachmentName(part),
      type: type || null,
      size: Number(part.s) || null,
      cid: part.ci ? normalizeCid(part.ci) : null,
    }
    // A text part that isn't the body (an alternative Zimbra didn't pick).
    if (!part.filename && part.cd !== 'attachment' && (type === 'text/plain' || type === 'text/html')) continue
    found.leaves.push(entry)
  }
  return found
}

// Zimbra's GetMsgResponse message → what the reader shows.
export function buildMailMessage(message, messageId) {
  const { bodies, leaves } = collectParts(message?.mp, { bodies: [], leaves: [] })
  const id = String(message?.id ?? messageId)
  const imagesByCid = new Map(
    leaves.filter((leaf) => leaf.cid && INLINE_IMAGE_TYPES.has(leaf.type)).map((leaf) => [leaf.cid, leaf]),
  )
  const usedCids = new Set()
  const resolveCid = (cid) => {
    const leaf = imagesByCid.get(cid)
    if (!leaf) return null
    usedCids.add(cid)
    return buildMailPartHref(id, leaf.part)
  }

  let remoteImages = 0
  const htmlParts = bodies.map((body) => {
    if (body.type === 'text/html') {
      const result = sanitizeMailHtml(body.content, { resolveCid })
      remoteImages += result.remoteImages
      return result.html
    }
    return mailTextToHtml(body.content)
  })

  const addresses = Array.isArray(message?.e) ? message.e : []
  const pick = (type) => addresses
    .filter((address) => address?.t === type)
    .map((address) => ({ name: String(address.p || address.d || address.a || ''), email: address.a ? String(address.a) : null }))
  const timestamp = Number(message?.d)

  return {
    id,
    subject: typeof message?.su === 'string' ? message.su : '',
    from: pick('f')[0] ?? null,
    replyTo: pick('r')[0] ?? null,
    to: pick('t'),
    cc: pick('c'),
    receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
    unread: typeof message?.f === 'string' && message.f.includes('u'),
    flagged: typeof message?.f === 'string' && message.f.includes('f'),
    // 'html' when any body part was HTML: the reader then shows it on white,
    // as written; 'text' follows the app's theme.
    format: bodies.some((body) => body.type === 'text/html') ? 'html' : 'text',
    html: htmlParts.join('<hr class="tafac-mail-part-break">'),
    remoteImages,
    truncated: bodies.some((body) => body.truncated),
    attachments: leaves
      .filter((leaf) => !(leaf.cid && usedCids.has(leaf.cid)))
      .map(({ part, name, type, size }) => ({ part, name, type, size, href: buildMailPartHref(id, part, { download: true }) })),
  }
}

// How the part proxy answers: inline for the images the reader shows, a
// download (with a safe file name) for everything else.
export function getMailPartDisposition({ contentType, filename, download }) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  const inline = !download && INLINE_IMAGE_TYPES.has(type)
  const name = String(filename ?? '').replace(/[\r\n"\\/]/g, '_').trim().slice(0, 200) || 'piece-jointe'
  const asciiName = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_')
  return {
    contentType: inline ? type : (type && /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream'),
    disposition: `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
  }
}

// The file name in an upstream Content-Disposition (RFC 5987 first), or null.
export function readContentDispositionFilename(header) {
  const value = String(header ?? '')
  const encoded = value.match(/filename\*\s*=\s*([\w-]+)'[^']*'([^;]+)/i)
  if (encoded) {
    try {
      return encoded[1].toLowerCase() === 'utf-8' ? decodeURIComponent(encoded[2].trim()) : unescape(encoded[2].trim())
    } catch {
      // Falls back to the plain name
    }
  }
  return value.match(/filename\s*=\s*"([^"]*)"/i)?.[1] ?? value.match(/filename\s*=\s*([^;\s]+)/i)?.[1] ?? null
}

// A mail sent to oneself sits twice in its thread: the copy in Envoyés and
// the one received. One is shown, as Apple Mail does: the copy in the folder
// read (`folder`), else the received one. Copies are told by their
// Message-ID header (`messageIdHeader`); without it (Partage didn't give
// it), by a sent copy with the same sender, subject and time (to the
// second) as another. `messages`: the reader's thread rows, each with its
// `folder`; `sentFolder`, Envoyés' id.
export function dropOwnMailCopies(messages, folder, sentFolder = '5') {
  const keyOf = (message) => {
    if (message.messageIdHeader) return `id:${message.messageIdHeader}`
    const time = Date.parse(message.receivedAt ?? '')
    if (!message.from?.email || !Number.isFinite(time)) return null
    return `same:${message.from.email.toLowerCase()}|${message.subject}|${Math.round(time / 1000)}`
  }
  const groups = new Map()
  for (const message of messages) {
    const key = keyOf(message)
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), message])
  }
  const dropped = new Set()
  for (const [key, copies] of groups) {
    if (copies.length < 2) continue
    // Without the header, only a sent copy beside a received one counts:
    // two different mails can share a sender, subject and second.
    if (key.startsWith('same:') && !(copies.some((copy) => copy.folder === sentFolder) && copies.some((copy) => copy.folder !== sentFolder))) continue
    const kept = copies.find((copy) => copy.folder === folder) ?? copies.find((copy) => copy.folder !== sentFolder) ?? copies[0]
    for (const copy of copies) if (copy !== kept) dropped.add(copy)
  }
  return dropped.size ? messages.filter((message) => !dropped.has(message)) : messages
}
