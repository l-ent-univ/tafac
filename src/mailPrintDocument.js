import { formatAttachmentSize } from './mailAttachments.js'
import { escapeHtml } from './mailText.js'

// What « Imprimer » and « Enregistrer en PDF » put on paper (src/mailPrint.js,
// src/mailPdf.js): a mail or a whole thread, oldest first, each mail's
// subject, sender, recipients, date and attachments over its body. Pure, so
// it can be tested without a DOM.
//
// The body is the server's sanitized HTML (server/mailMessage.js), exactly
// as the reader gets it: remote images stay held back (data-remote-*, never
// a src), whatever the reader showed, so printing never reaches a sender's
// server. The document is only ever shown in a sandboxed frame without
// scripts (mailPrint.js), never in the app's own page.

const printDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' })

// The reader's inline images come through the part proxy (cid: resolved by
// the server); nothing else is let in, as in the reader's frame.
const MAIL_PART_PATH = '/__ent_auth/mail/part'

// The shared one (src/mailText.js), named here as before.
export { escapeHtml }

// « Camille Martin <camille.martin@univ.fr> », or whichever of the two is known.
export function formatPrintAddress(address) {
  const email = address?.email?.trim() || ''
  const name = address?.name?.trim() || ''
  if (name && email && name !== email) return `${name} <${email}>`
  return email || name
}

// « mercredi 28 octobre 2026 à 14:05 ». Null without a valid date.
export function formatPrintDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? printDateFormatter.format(date) : null
}

export function getPrintSubject(message) {
  return message?.subject?.trim() || '(Sans objet)'
}

// One mail's header as both outputs write it: { subject, rows: [{ label,
// value }], attachments: ['Consignes.pdf (243 Ko)'] }. A draft (not sent)
// says so where the date goes.
export function describePrintedMail(message, { draft = false } = {}) {
  const list = (addresses) => (Array.isArray(addresses) ? addresses.map(formatPrintAddress).filter(Boolean).join(', ') : '')
  const replyTo = message?.replyTo && message.replyTo.email !== message.from?.email ? formatPrintAddress(message.replyTo) : ''
  const rows = [
    { label: 'De', value: formatPrintAddress(message?.from) || 'Expéditeur inconnu' },
    { label: 'À', value: list(message?.to) },
    { label: 'Cc', value: list(message?.cc) },
    { label: 'Répondre à', value: replyTo },
    { label: 'Date', value: draft ? 'Brouillon, pas encore envoyé' : formatPrintDate(message?.receivedAt) },
  ].filter((row) => row.value)
  const attachments = (Array.isArray(message?.attachments) ? message.attachments : []).map((attachment) => {
    const size = formatAttachmentSize(attachment.size)
    return size ? `${attachment.name} (${size})` : String(attachment.name ?? '')
  })
  return { subject: getPrintSubject(message), rows, attachments }
}

// The reader's frame CSP (MailReader's buildFrameCsp) with remote images
// always off. `origin`: the app's, for the part proxy's inline images.
export function buildPrintCsp(origin) {
  return `default-src 'none'; style-src 'unsafe-inline'; img-src data: ${origin}${MAIL_PART_PATH}; media-src 'none'; font-src 'none'; form-action 'none'`
}

// Light whatever the app's theme; each mail of a thread on a page of its
// own. The header's rules are scoped and important: a mail's own <style>
// (kept, its layout may need it) shouldn't restyle them.
const PRINT_STYLE = [
  '@page{margin:16mm 15mm}',
  ':root{color-scheme:light}',
  'html,body{background:#fff!important;color:#1a1a1a}',
  'html{-webkit-text-size-adjust:100%}',
  'body{margin:0;font:10.5pt/1.5 system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;overflow-wrap:anywhere}',
  '.tafac-print-mail+.tafac-print-mail{break-before:page}',
  '.tafac-print-head{display:block!important;margin:0 0 14pt!important;padding:0 0 10pt!important;border-bottom:1px solid #d9d9d9!important;color:#1a1a1a!important;font:10pt/1.45 system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif!important;break-inside:avoid}',
  '.tafac-print-head h1{display:block!important;margin:0 0 8pt!important;font-size:15pt!important;font-weight:700!important;line-height:1.3!important;color:#1a1a1a!important}',
  '.tafac-print-head table{border-collapse:collapse!important;width:auto!important;margin:0!important}',
  '.tafac-print-head th,.tafac-print-head td{padding:1pt 0!important;vertical-align:top!important;text-align:left!important;font:inherit!important;color:#1a1a1a!important;border:0!important}',
  '.tafac-print-head th{padding-right:10pt!important;font-weight:600!important;color:#666!important;white-space:nowrap!important}',
  '.tafac-print-note{margin:12pt 0 0!important;color:#666!important;font:9pt/1.4 system-ui,-apple-system,sans-serif!important}',
  // The reader's base rules (buildFrameStyle), for the body.
  'img,video{max-width:100%!important;height:auto!important}',
  // A held-back remote image has no source: no broken picture in its place.
  'img:not([src]){display:none!important}',
  'table,[style*="width"]{max-width:100%!important}',
  'pre{white-space:pre-wrap}',
  'blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #ccc}',
  'hr.tafac-mail-part-break{border:0;border-top:1px dashed #ccc;margin:18pt 0}',
  'a{color:#0b57d0}',
  '.tafac-mail-text{white-space:pre-wrap}',
].join('')

// One mail as an <article>: its header, then its body.
function buildPrintedMail(message, draft) {
  const { subject, rows, attachments } = describePrintedMail(message, { draft })
  const row = (label, cell) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${cell}</td></tr>`
  // The attachments as the last row, one name a line.
  const table = rows.map(({ label, value }) => row(label, escapeHtml(value))).join('')
    + (attachments.length ? row('Pièces jointes', attachments.map(escapeHtml).join('<br>')) : '')
  const note = message?.truncated ? '<p class="tafac-print-note">Mail trop long, la suite est dans le webmail</p>' : ''
  // The server's sanitized HTML, as the reader shows it (see the top).
  const body = typeof message?.html === 'string' && message.html ? message.html : '<p>Ce mail n’a pas de texte</p>'
  return `<article class="tafac-print-mail"><header class="tafac-print-head"><h1>${escapeHtml(subject)}</h1><table>${table}</table></header>`
    + `<div class="tafac-print-body">${body}</div>${note}</article>`
}

// The whole document. `mails`: [{ message, draft }], oldest first.
// `origin`: window.location.origin. Its <title>, the first mail's subject,
// is what a browser's « Enregistrer au format PDF » names the file.
export function buildPrintDocument(mails, { origin }) {
  const title = getPrintSubject(mails[0]?.message)
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(buildPrintCsp(origin))}">`
    + '<meta name="referrer" content="no-referrer">'
    + `<title>${escapeHtml(title)}</title><style>${PRINT_STYLE}</style></head><body>`
    + mails.map(({ message, draft }) => buildPrintedMail(message, Boolean(draft))).join('')
    + '</body></html>'
}

// The PDF's file name, from the subject: « R5.11 – Rendu du TP.pdf ». The
// reply and forward prefixes go, characters no file system takes become a
// dash, control characters and the invisible ones go, its length is kept
// reasonable (cut at a word).
const FILE_NAME_MAX_LENGTH = 80
export function getPdfFileName(subject) {
  let name = String(subject ?? '')
    .normalize('NFC')
    // Control characters, zero-width and bidirectional marks.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/^(?:\s*(?:re|tr|fw|fwd|réf)\s*(?:\[\d+\])?\s*:\s*)+/i, '')
    // « 2025/2026 » as « 2025-2026 », the other forbidden ones as « - ».
    .replace(/(\S)[\\/]+(?=\S)/g, '$1-')
    .replace(/\s*[\\/:*?"<>|][\s\\/:*?"<>|]*/g, ' - ')
    .replace(/\s+/g, ' ')
    // A leading dot hides the file (macOS, Linux); trailing dots and spaces
    // are dropped by Windows.
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
  if (name.length > FILE_NAME_MAX_LENGTH) {
    const cut = name.slice(0, FILE_NAME_MAX_LENGTH)
    const lastSpace = cut.lastIndexOf(' ')
    name = (lastSpace > FILE_NAME_MAX_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s.-]+$/, '')
  }
  return `${name || 'Mail'}.pdf`
}
