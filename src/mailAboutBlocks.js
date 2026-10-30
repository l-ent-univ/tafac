// The blocks a mail « about » something carries (a grade of « Mes notes »,
// src/gradeMail.js; a class of the Planning, src/courseMail.js): a summary
// box of « label : value » rows and its image inline, in a prefilled mail
// or put in at the caret by the trombone's « Une note… » / « Un cours… ».
// Shared so both read and land the same way. Pure but for
// makeInlineImageItem (a File), so the tests run it straight in Node.

import { escapeHtml } from './mailText.js'
import { MAX_INLINE_IMAGES, createInlineCid, inlineImageKey } from './mailInlineImages.js'

// `text` on one line, cut to `max` characters with an ellipsis.
export function shortenMailText(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

// The editor's HTML (what MailComposer's `restore.html` takes): the
// greeting, the line saying what the mail is about (`about`), an empty line
// for the student (`focusBlock`, the caret's), the summary box (`rows`:
// [{ label, value }]), the image (`image`: { cid, alt, width, height } or
// null). → { html, focusBlock }.
export function buildAboutMailHtml({ about, rows, image = null }) {
  const summary = `<table data-mail-summary=""><tbody>${rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`).join('')}</tbody></table>`
  const picture = image
    ? `<img data-inline-cid="${escapeHtml(image.cid)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}">`
    : ''
  const blocks = ['<p>Bonjour,</p>', '<p></p>', `<p>${escapeHtml(about)}</p>`, '<p></p>', '<p></p>', summary, picture].filter(Boolean)
  return { html: blocks.join(''), focusBlock: 3 }
}

// A drawn image (a canvas's PNG) as the composer's item
// (useInlineImages's), its file to upload.
export function makeInlineImageItem({ blob, width, height, name, alt }) {
  const cid = createInlineCid()
  return {
    key: inlineImageKey(cid),
    cid,
    source: 'upload',
    file: new File([blob], name, { type: 'image/png' }),
    name,
    size: blob.size,
    contentType: 'image/png',
    width,
    height,
    alt,
    status: 'queued',
  }
}

// Where the blocks go, among the text's top-level blocks (`blocks`:
// [{ type, empty }], the editor's doc children). `caretIndex`: the block
// the caret is in, when the student has been in the text (null else).
// - after the caret's block, an empty line under them to go on writing
//   (`withLine`, the caret moved there); in an empty line, before it (the
//   caret stays there, under them);
// - else, or with the caret in a reply's quote, under the text: before the
//   signature, or before the line introducing the quote, or at the end.
// → { index, withLine }.
export function pickAboutInsertIndex(blocks, caretIndex = null) {
  const list = Array.isArray(blocks) ? blocks : []
  const signature = list.findIndex((block) => block.type === 'mailSignature')
  const quote = list.findIndex((block) => block.type === 'blockquote')
  let end = list.length
  if (signature >= 0) end = signature
  else if (quote >= 1) {
    // The header introducing the quote, and the empty line above it.
    end = quote - 1
    if (end >= 1 && list[end - 1].type === 'paragraph' && list[end - 1].empty) end -= 1
  }
  if (Number.isInteger(caretIndex) && caretIndex >= 0 && caretIndex < end) {
    const block = list[caretIndex]
    if (block.type === 'paragraph' && block.empty) return { index: caretIndex, withLine: false }
    return { index: caretIndex + 1, withLine: true }
  }
  return { index: end, withLine: false }
}

// The editor's nodes: the summary box, then the image (`image`: { cid,
// width, height } or null, `alt` its text). Past the server's
// MAX_INLINE_IMAGES (`imagesInText`: those the text shows already, grades
// and classes alike), the box alone (`capped`). → { nodes, capped }.
export function buildAboutInsertion({ rows, alt = '', image = null, imagesInText = 0 }) {
  const capped = imagesInText >= MAX_INLINE_IMAGES
  const nodes = [{ type: 'mailSummary', attrs: { rows } }]
  if (image && !capped) {
    nodes.push({ type: 'mailInlineImage', attrs: { cid: image.cid, alt, width: image.width ?? null, height: image.height ?? null } })
  }
  return { nodes, capped }
}
