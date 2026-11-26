// The HTML of the demo account's mails. For a real account the server makes
// a mail of the composer's text (server/mailSend.js, mailSignature.js and
// mailMessage.js, on sanitize-html); the demo's mails never leave the page
// (src/demoMail.js), so its copies are made here, by the same rules and to
// the same output (tests/demoMailHtml.test.js holds each function to the
// server's). No HTML parser: a small rewriter of its own, enough for what
// it is given, the visitor's own editor's text (Tiptap's, well formed) and
// the page's own constants, which stay in their browser and are shown in
// the reader's sandboxed frame as any mail is.
import { signatureLogin, signatureLoginLine } from './mailSignatureChoice.js'
import { CONTROL_CHARACTERS, capLength, decodeEntities } from './mailText.js'

// ── The rewriter ───────────────────────────────────────────────────────────

// Tags without content: written « <br /> », never closed.
const VOID_TAGS = new Set(['img', 'br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta', 'col'])
// A comment, a declaration, an end tag, a start tag (with its attributes).
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/([a-z][a-z0-9-]*)[^>]*>|<([a-z][a-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
// An attribute left empty is written bare, « alt » as alt="", and one of
// these not at all (sanitize-html's nonBooleanAttributes, those met here).
const NEVER_EMPTY = new Set(['class', 'height', 'href', 'id', 'rel', 'src', 'start', 'style', 'target', 'title', 'width'])

const escapeText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (value) => escapeText(value).replace(/"/g, '&quot;')
// A non-breaking space stays one (the editor writes it « &nbsp; »).
const decodeText = (text) => decodeEntities(text.replace(/&nbsp;/gi, '\u00a0'))

function readAttributes(written) {
  const attribs = {}
  for (const [, rawName, double, single, bare] of written.matchAll(ATTRIBUTE)) {
    const name = rawName.toLowerCase()
    if (!(name in attribs)) attribs[name] = decodeText(double ?? single ?? bare ?? '')
  }
  return attribs
}

function writeAttributes(attribs) {
  let out = ''
  for (const [name, value] of Object.entries(attribs)) {
    const text = String(value ?? '')
    if (text) out += ` ${name}="${escapeAttribute(text)}"`
    else if (name === 'alt') out += ' alt=""'
    else if (!NEVER_EMPTY.has(name)) out += ` ${name}`
  }
  return out
}

// `html` written again by `rules`:
//   allowedTags   a Set; a tag outside it goes, its content stays
//   nonTextTags   a Set: among the tags that go, those whose content goes too
//   transform     (tag, attribs) → { tag, attribs }, before anything else
//   attributes    (tag, attribs) → the attributes kept
//   exclusive     (frame: { tag, attribs, text }) → true: the element goes
//                 whole, once closed
// Text is decoded then escaped again; an end tag without its start is
// ignored, a start tag left open is closed at the end.
function rewriteHtml(html, { allowedTags = null, nonTextTags = new Set(), transform = null, attributes = null, exclusive = null }) {
  const source = String(html ?? '')
  let out = ''
  const stack = []
  // Inside a tag whose content goes: its name, and how many are open.
  let dropped = null

  const closeFrame = () => {
    const frame = stack.pop()
    const parent = stack[stack.length - 1]
    if (frame.skipped) {
      if (parent) parent.text += frame.text
      return
    }
    if (exclusive?.(frame)) {
      out = out.slice(0, frame.start)
      return
    }
    if (parent) parent.text += frame.text
    if (!VOID_TAGS.has(frame.tag)) out += `</${frame.tag}>`
  }

  const text = (raw) => {
    if (dropped || !raw) return
    const decoded = decodeText(raw)
    out += escapeText(decoded)
    if (stack.length) stack[stack.length - 1].text += decoded
  }

  let last = 0
  for (const match of source.matchAll(TOKEN)) {
    text(source.slice(last, match.index))
    last = match.index + match[0].length
    const [, endTag, startTag, written] = match
    const rawTag = (endTag ?? startTag)?.toLowerCase()
    if (!rawTag) continue

    if (dropped) {
      if (rawTag === dropped.tag) dropped.depth += startTag ? 1 : -1
      if (dropped.depth > 0) continue
      dropped = null
      closeFrame()
      continue
    }

    if (endTag) {
      // What was opened inside it and left open closes with it.
      const index = stack.findLastIndex((frame) => frame.sourceTag === rawTag)
      if (index === -1) continue
      while (stack.length > index) closeFrame()
      continue
    }

    const changed = transform ? transform(rawTag, readAttributes(written)) : { tag: rawTag, attribs: readAttributes(written) }
    const frame = { sourceTag: rawTag, tag: changed.tag, attribs: changed.attribs, start: out.length, text: '', skipped: false }
    if (allowedTags && !allowedTags.has(frame.tag)) {
      frame.skipped = true
      if (nonTextTags.has(frame.tag) && !VOID_TAGS.has(rawTag)) dropped = { tag: rawTag, depth: 1 }
    } else {
      if (attributes) frame.attribs = attributes(frame.tag, frame.attribs)
      out += `<${frame.tag}${writeAttributes(frame.attribs)}${VOID_TAGS.has(frame.tag) ? ' />' : '>'}`
    }
    stack.push(frame)
    if (VOID_TAGS.has(rawTag)) closeFrame()
  }
  text(source.slice(last))
  while (stack.length) closeFrame()
  return out
}

// A style attribute's declarations, those `allowed` takes ({ property:
// [patterns] }, or null: all of them), written « a:b;c:d ».
function filterStyle(style, allowed = null) {
  return String(style ?? '').split(';')
    .map((declaration) => {
      const colon = declaration.indexOf(':')
      return colon === -1 ? null : [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]
    })
    .filter((declaration) => declaration?.[0] && declaration[1])
    .filter(([property, value]) => !allowed || allowed[property]?.some((pattern) => pattern.test(value)))
    .map(([property, value]) => `${property}:${value}`)
    .join(';')
}

const pick = (attribs, names) => Object.fromEntries(Object.entries(attribs).filter(([name]) => names.includes(name)))

// ── The editor's HTML ──────────────────────────────────────────────────────

// As the server takes them (server/mailSend.js: its COMPOSER_SANITIZE_OPTIONS
// and what they are made of).
export const MAX_COMPOSER_HTML_LENGTH = 1_500_000
export const INLINE_CID_PATTERN = /^tafac-img-[0-9a-f-]{8,64}@tafac\.fr$/
const MAX_IMAGE_ALT_LENGTH = 200
const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i
const FONT_SIZE = /^(?:10|13|16|18|24|32)px$/
const FONT_FAMILY = /^(?:"?(?:Collab Sans|Inter Variable)"?, system-ui, sans-serif|Georgia, serif|ui-monospace, Menlo, monospace)$/
const INDENT = /^(?:32|64|96|128|160|192)px$/
const SPAN_STYLES = { color: [COLOR], 'background-color': [COLOR], 'font-size': [FONT_SIZE], 'font-family': [FONT_FAMILY] }
const BLOCK_STYLES = { 'margin-left': [INDENT] }
const COMPOSER_STYLES = { span: SPAN_STYLES, mark: { 'background-color': [COLOR], color: [/^inherit$/] }, p: BLOCK_STYLES, h2: BLOCK_STYLES, h3: BLOCK_STYLES }
const COMPOSER_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'a', 'span', 'mark', 'div', 'table', 'tbody', 'tr', 'th', 'td', 'img'])
const COMPOSER_ATTRIBUTES = {
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
}
const COMPOSER_NON_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'option', 'noscript', 'title', 'head', 'template', 'svg', 'math', 'iframe', 'object'])
const IMAGE_SIZE = /^\d{1,4}$/

function cleanImageAttributes(attribs) {
  const cid = String(attribs['data-inline-cid'] ?? '').trim().toLowerCase()
  if (!INLINE_CID_PATTERN.test(cid)) return {}
  const alt = capLength(String(attribs.alt ?? '').replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim(), MAX_IMAGE_ALT_LENGTH).trim()
  return {
    'data-inline-cid': cid,
    ...(alt ? { alt } : null),
    ...(IMAGE_SIZE.test(attribs.width ?? '') ? { width: attribs.width } : null),
    ...(IMAGE_SIZE.test(attribs.height ?? '') ? { height: attribs.height } : null),
  }
}

const COMPOSER_TRANSFORMS = {
  div: (attribs) => (Object.hasOwn(attribs, 'data-mail-signature') ? { 'data-mail-signature': '' } : {}),
  table: (attribs) => (Object.hasOwn(attribs, 'data-mail-summary') ? { 'data-mail-summary': '' } : {}),
  img: cleanImageAttributes,
  ol: (attribs) => (/^\d{1,4}$/.test(attribs.start ?? '') && attribs.start !== '1' ? { start: attribs.start } : {}),
  a: (attribs) => {
    const href = String(attribs.href ?? '').trim()
    return /^(?:https?:\/\/|mailto:)/i.test(href) ? { href } : {}
  },
}

const SIGNATURE_TOKEN = '<tafac-signature>'
const SIGNATURE_DIV = /<div data-mail-signature(?:="")?><\/div>/
export const SIGNATURE_PLACEHOLDER = '<div data-mail-signature></div>'

// The editor's HTML, held to what the format bar offers (the server's
// sanitizeComposerHtml): its tags, their few attributes and styles, links
// to http(s) and mailto, one signature placeholder, an image only as a
// reference (img[data-inline-cid]).
export function cleanComposerHtml(html) {
  const source = typeof html === 'string' ? html.slice(0, MAX_COMPOSER_HTML_LENGTH) : ''
  const clean = rewriteHtml(source, {
    allowedTags: COMPOSER_TAGS,
    nonTextTags: COMPOSER_NON_TEXT_TAGS,
    transform: (tag, attribs) => ({ tag, attribs: COMPOSER_TRANSFORMS[tag]?.(attribs) ?? attribs }),
    attributes: (tag, attribs) => {
      const kept = pick(attribs, COMPOSER_ATTRIBUTES[tag] ?? [])
      if ('style' in kept) {
        kept.style = filterStyle(kept.style, COMPOSER_STYLES[tag])
        if (!kept.style) delete kept.style
      }
      return kept
    },
    exclusive: (frame) => (frame.tag === 'div' && 'data-mail-signature' in frame.attribs && Boolean(frame.text.trim()))
      || (frame.tag === 'img' && !frame.attribs['data-inline-cid']),
  })
  // The first placeholder stays, the others go with the plain divs.
  return clean.replace(SIGNATURE_DIV, SIGNATURE_TOKEN)
    .replace(/<\/?div(?: data-mail-signature(?:="")?)?>/g, '')
    .replace(SIGNATURE_TOKEN, SIGNATURE_PLACEHOLDER)
}

// The images the mail takes (the server's selectInlineImages): those of
// `references` ([{ cid, … }]) the cleaned text holds, once each, in its
// order and with its alt; any other image goes from the text.
export function selectComposerImages(cleanHtml, references = []) {
  const byCid = new Map(references.map((entry) => [entry.cid, entry]))
  const images = []
  const html = rewriteHtml(cleanHtml, {
    allowedTags: COMPOSER_TAGS,
    transform: (tag, attribs) => {
      if (tag !== 'img') return { tag, attribs }
      const reference = byCid.get(attribs['data-inline-cid'])
      if (!reference || images.some((image) => image.cid === reference.cid)) return { tag, attribs: {} }
      images.push({ ...reference, alt: attribs.alt ?? '' })
      return { tag, attribs }
    },
    exclusive: (frame) => frame.tag === 'img' && !frame.attribs['data-inline-cid'],
  })
  return { html, images }
}

// ── The mail as kept: inline styles ────────────────────────────────────────

// The sent mail's look (server/mailSend.js: inlineComposerStyles and
// buildMailHtml), then as the reader is given a mail (server/mailMessage.js:
// sanitizeMailHtml, which makes the body a div and opens links in a tab).
const DEFAULT_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
const TEXT_COLOR = '#1d1d1f'
const MUTED_COLOR = '#6b625b'
const HIGHLIGHT_TEXT = '#1f1f1f'
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
  table: 'margin:4px 0 12px;padding:6px 0;border-collapse:separate;border-spacing:0;border:1px solid #e8e1da;border-radius:12px;background:#f8f5f1;font-size:14px;line-height:1.45',
  th: `padding:4px 18px 4px 14px;text-align:left;vertical-align:top;font-weight:500;color:${MUTED_COLOR};white-space:nowrap`,
  td: `padding:4px 14px 4px 0;text-align:left;vertical-align:top;font-weight:600;color:${TEXT_COLOR}`,
}
const LINK_ATTRIBUTES = { target: '_blank', rel: 'noopener noreferrer' }

const withStyle = (base, own) => [base, own].filter(Boolean).join(';')

function styledElement(tag, attribs, images) {
  if (tag === 'img') {
    const image = images.get(attribs['data-inline-cid'])
    // The reader shows an image of the mail's own only: a data: URL here.
    if (!image || !/^data:image\//i.test(image.src)) return {}
    return {
      width: String(image.width),
      height: String(image.height),
      alt: image.alt ?? '',
      style: `display:block;width:${image.width}px;max-width:100%;height:auto;margin:0 0 4px;border:0;outline:none;border-radius:16px`,
      src: image.src,
    }
  }
  if (tag === 'table') return { cellpadding: '0', cellspacing: '0', style: ELEMENT_STYLES.table }
  if (tag === 'span' && attribs.style) {
    return { style: attribs.style.replace(/font-family:\s*"?(?:Collab Sans|Inter Variable)"?, system-ui, sans-serif/, `font-family:${DEFAULT_FONT}`) }
  }
  if (tag === 'mark') return { style: withStyle((attribs.style ?? '').replace(/;?\s*color:\s*inherit/, ''), `color:${HIGHLIGHT_TEXT}`) }
  const base = ELEMENT_STYLES[tag]
  if (!base) return attribs
  const indent = /margin-left:\s*(\d+)px/.exec(attribs.style ?? '')?.[1]
  const style = indent && ['p', 'h2', 'h3'].includes(tag) ? `${base};margin-left:${indent}px` : base
  if (tag !== 'a') return { ...attribs, style }
  const { href, ...rest } = attribs
  return { ...rest, style, ...(href ? { href } : null), ...LINK_ATTRIBUTES }
}

// The demo's copy of a sent mail, as the reader shows a mail: the cleaned
// text (cleanComposerHtml, selectComposerImages) with its styles inline,
// the signature (`signatureHtml`, or nothing) where the editor had its
// placeholder, its images by their data: URL (`images`: Map(cid → { src,
// width, height, alt })).
export function buildSentHtml(cleanHtml, { signatureHtml = '', images = new Map() } = {}) {
  const styled = rewriteHtml(cleanHtml, {
    allowedTags: COMPOSER_TAGS,
    transform: (tag, attribs) => ({ tag, attribs: styledElement(tag, attribs, images) }),
    exclusive: (frame) => frame.tag === 'img' && !frame.attribs.src,
  })
  const body = styled
    .replace(/<p style="([^"]*)"><\/p>/g, '<p style="$1"><br /></p>')
    .replace(SIGNATURE_DIV, () => signatureHtml)
  return `<div class="tafac-mail-body"><div style="${WRAPPER_STYLE}">${body}</div></div>`
}

// ── The text/plain alternative ─────────────────────────────────────────────

// The cleaned HTML as plain text, for a row's preview (the server's
// composerHtmlToText, as it stands there): a paragraph or a heading a line,
// lists as « - » or « 1. », a quote as « > » lines, a link as « text (url) »
// unless its text is the url, a summary box as « label : value » lines set
// apart, an image as « [Image : its alt] », the signature (`signatureText`)
// where its placeholder was.
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

// The automatic signature of a sent mail (the server's buildMailSignature):
// a dash, the name, « Identifiant : » where the university shows it
// (`login`, checked: signatureLogin), the group, the establishment and the
// university, the logos (`logos`: [{ src, width, height, alt }], a data:
// URL each) → { html, text }.
export function buildAutoSignature({ name = '', login = null, group = '', establishment = '', university = '', logos = [] } = {}) {
  const place = [...new Set([establishment, university].map((value) => String(value ?? '').trim()).filter(Boolean))].join(' – ')
  const checkedLogin = signatureLogin(login)
  const lines = [name, checkedLogin ? signatureLoginLine(checkedLogin) : '', group, place].map((value) => String(value ?? '').trim())
  if (!lines.some(Boolean) && !logos.length) return { html: '', text: '' }
  const row = (text, style = '') => (text ? `<div${style ? ` style="${style}"` : ''}>${escapeText(text)}</div>` : '')
  const images = logos.map((logo, index) => (
    `<img width="${logo.width}" height="${logo.height}" alt="${escapeAttribute(String(logo.alt ?? ''))}" style="display:inline-block;width:${logo.width}px;height:${logo.height}px;border:0;outline:none;vertical-align:middle${index ? ';margin-left:10px' : ''}" src="${escapeAttribute(logo.src)}" />`
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

// The student's own signature in a mail (the server's frameSignature):
// its HTML (the demo's are the page's own, src/demoMail.js) in its frame,
// its styles inline, its links opening in a tab; its text after « -- ».
const OWN_SIGNATURE_TAGS = new Set(['div', 'p', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li'])
const OWN_SIGNATURE_STYLES = { p: 'margin:0', ul: 'margin:0.25em 0;padding-left:1.5em', ol: 'margin:0.25em 0;padding-left:1.5em', a: 'color:#1a73e8' }
const OWN_SIGNATURE_FRAME = `margin:14px 0 6px;font-size:14px;line-height:1.45;color:${TEXT_COLOR}`

// A text signature as HTML: a line a <div>, an empty line kept.
export function plainSignatureToHtml(text) {
  return String(text ?? '').split('\n').map((line) => `<div>${line ? escapeText(line) : '<br />'}</div>`).join('')
}

export function frameOwnSignature(signature) {
  const html = String(signature?.html ?? '')
  const text = String(signature?.text ?? '')
  if (!html && !text) return { html: '', text: '' }
  const styled = rewriteHtml(html || plainSignatureToHtml(text), {
    allowedTags: OWN_SIGNATURE_TAGS,
    transform: (tag, attribs) => {
      const base = OWN_SIGNATURE_STYLES[tag]
      if (!base) return { tag, attribs }
      const { href, ...rest } = attribs
      const style = filterStyle(withStyle(base, rest.style))
      return { tag, attribs: tag === 'a' ? { ...rest, style, ...(href ? { href } : null), ...LINK_ATTRIBUTES } : { ...attribs, style } }
    },
  })
  return {
    html: `<div style="${OWN_SIGNATURE_FRAME}">${styled}</div>`,
    text: /^--\s*(?:\n|$)/.test(text) ? text : `-- \n${text}`,
  }
}
