// The composer's attachments (MailComposer), shared with the server's upload
// relay (server/mailUpload.js, POST /__ent_auth/mail/upload). Pure, so it
// can be tested without a DOM.
//
// An attachment is held as what a send will need and nothing more: Zimbra's
// SendMsgRequest takes `<attach aid="…">` for a file uploaded to it
// (source 'upload', its `aid` from Partage's upload servlet) and `<attach>
// <mp mid part/></attach>` for one already in the mailbox (source
// 'message', a forwarded mail's). The file's bytes never sit on the app's
// server: an upload goes through it as a stream, straight to Partage.
import { CONTROL_CHARACTERS } from './mailText.js'

// Partage's own limit is the whole mail's (Zimbra GetInfo's attSizeLimit,
// zimbraMtaMaxMessageSize), counted on the mail as sent: attachments in
// base64 take 4/3 of their size, plus a line break every 76 characters. What
// the files may weigh is that, less room for the text and the headers. When
// Partage doesn't say (or says « no limit »), this one.
export const FALLBACK_MESSAGE_LIMIT_BYTES = 25 * 1024 * 1024
// Whatever Partage allows, never more through the app's server.
export const HARD_ATTACHMENT_LIMIT_BYTES = 50 * 1024 * 1024
const BASE64_RATIO = (4 / 3) * (78 / 76)
const MESSAGE_OVERHEAD_BYTES = 256 * 1024
// A mail's attachments, however small: more is a folder to share.
export const MAX_ATTACHMENTS = 20
// The relay to RENATER's large-file service, offered past the limit.
export const FILESENDER_URL = 'https://filesender.renater.fr'

// `messageLimit`: GetInfo's attSizeLimit in bytes (-1 or 0 no limit, absent
// unknown). { maxFileBytes, maxTotalBytes, messageLimitBytes, known }: one
// file, and all of a mail's together, at most (the same: a single file has
// the whole mail to itself).
export function deriveAttachmentLimits(messageLimit) {
  const value = Number(messageLimit)
  const known = Number.isFinite(value) && value > MESSAGE_OVERHEAD_BYTES
  const messageLimitBytes = known ? value : FALLBACK_MESSAGE_LIMIT_BYTES
  const total = Math.min(Math.floor((messageLimitBytes - MESSAGE_OVERHEAD_BYTES) / BASE64_RATIO), HARD_ATTACHMENT_LIMIT_BYTES)
  return { maxFileBytes: total, maxTotalBytes: total, messageLimitBytes, known }
}

// The limits the page was given (GET /__ent_auth/mail/prefs), checked: two
// positive sizes no larger than the hard cap, else the fallback's.
export function readAttachmentLimits(value) {
  const fallback = deriveAttachmentLimits(null)
  const size = (bytes) => (Number.isSafeInteger(bytes) && bytes > 0 ? Math.min(bytes, HARD_ATTACHMENT_LIMIT_BYTES) : null)
  const maxFileBytes = size(value?.maxFileBytes)
  const maxTotalBytes = size(value?.maxTotalBytes)
  return maxFileBytes && maxTotalBytes ? { maxFileBytes, maxTotalBytes } : { maxFileBytes: fallback.maxFileBytes, maxTotalBytes: fallback.maxTotalBytes }
}

export const MAX_ATTACHMENT_NAME_LENGTH = 180
export const DEFAULT_ATTACHMENT_NAME = 'piece-jointe'

// A file's name as it may go into a mail (and Partage's upload): no folder
// (anything up to the last / or \), no control or bidi character, no
// character a header or a file system chokes on (" * : < > ? |), one space
// between words, no dot or space at its ends, MAX_ATTACHMENT_NAME_LENGTH
// characters at most, its extension kept when it's cut.
export function sanitizeAttachmentName(name) {
  let text = String(name ?? '').normalize('NFC')
  text = text.slice(Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')) + 1)
  text = text.replace(CONTROL_CHARACTERS, '').replace(/["*:<>?|]/g, '_').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '')
  const characters = Array.from(text)
  if (characters.length > MAX_ATTACHMENT_NAME_LENGTH) {
    const extension = /\.[\p{L}\p{N}]{1,10}$/u.exec(text)?.[0] ?? ''
    text = characters.slice(0, MAX_ATTACHMENT_NAME_LENGTH - extension.length).join('').trimEnd() + extension
  }
  return text || DEFAULT_ATTACHMENT_NAME
}

// A MIME type as Partage is told it: type/subtype, lowercased, without its
// parameters; anything else is a plain stream of bytes.
export function normalizeAttachmentType(type) {
  const value = String(type ?? '').split(';')[0].trim().toLowerCase()
  return /^[a-z0-9][\w.+-]{0,63}\/[a-z0-9][\w.+-]{0,127}$/.test(value) ? value : 'application/octet-stream'
}

// The Content-Disposition the page sends its upload with (RFC 5987: the
// name in UTF-8, percent-encoded, so any name fits a header).
export function buildUploadDisposition(name) {
  const encoded = encodeURIComponent(sanitizeAttachmentName(name)).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename*=UTF-8''${encoded}`
}

const PART_ID_PATTERN = /^\d+(\.\d+)*$/

// A forwarded mail's attachments (getMailMessage's `attachments`, its `id`),
// as the composer holds them: in the mailbox already, nothing to upload.
export function messageAttachmentItems(message) {
  const messageId = typeof message?.id === 'string' ? message.id : ''
  if (!messageId) return []
  return (Array.isArray(message?.attachments) ? message.attachments : [])
    .filter((attachment) => typeof attachment?.part === 'string' && attachment.part.length <= 40 && PART_ID_PATTERN.test(attachment.part))
    .map((attachment) => ({
      key: `message:${messageId}:${attachment.part}`,
      source: 'message',
      messageId,
      part: attachment.part,
      name: sanitizeAttachmentName(attachment.name),
      size: Number.isSafeInteger(attachment.size) && attachment.size > 0 ? attachment.size : null,
      contentType: normalizeAttachmentType(attachment.type),
      status: 'ready',
    }))
}

// What a send will be given of the attachments: references only, those
// ready (an upload still going or failed isn't one).
export function attachmentReferences(items) {
  return (Array.isArray(items) ? items : []).filter((item) => item.status === 'ready').map((item) => (
    item.source === 'message'
      ? { source: 'message', messageId: item.messageId, part: item.part }
      : { source: 'upload', aid: item.aid }
  ))
}

// An item refused before it was sent (checkNewAttachments) doesn't count
// against the mail's limits: it won't go. One that failed on the way does
// (it's retried).
const REFUSALS = new Set(['empty', 'too-large', 'total', 'too-many'])
const isCounted = (item) => !(item?.status === 'error' && REFUSALS.has(item.error))

export function isRefusedAttachment(item) {
  return !isCounted(item)
}

export function attachmentsTotalSize(items) {
  return (Array.isArray(items) ? items : []).filter(isCounted).reduce((sum, item) => sum + (item.size ?? 0), 0)
}

// Files picked, dropped or pasted, checked before a byte leaves: for each,
// null when it may be uploaded, else why not ('empty', 'too-large' past
// one file's limit, 'total' past the mail's with what's there already,
// 'too-many' past MAX_ATTACHMENTS). Taken in order: a file refused leaves
// its room to the next.
export function checkNewAttachments(files, current, limits) {
  let total = attachmentsTotalSize(current)
  let count = (Array.isArray(current) ? current : []).filter(isCounted).length
  return files.map((file) => {
    const size = Number(file?.size) || 0
    if (count >= MAX_ATTACHMENTS) return 'too-many'
    if (size <= 0) return 'empty'
    if (size > limits.maxFileBytes) return 'too-large'
    if (total + size > limits.maxTotalBytes) return 'total'
    total += size
    count += 1
    return null
  })
}

// ── How an attachment shows (the reader's list, the composer's chips) ──

export function formatAttachmentSize(bytes) {
  if (!bytes) return null
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}

// A limit as said to the student: whole megabytes, rounded down (« 18 Mo »).
export function formatAttachmentLimit(bytes) {
  return `${Math.max(1, Math.floor(bytes / (1024 * 1024)))} Mo`
}

// What the file is: its extension in capitals (PDF, DOCX), else its type's kind.
export function getAttachmentKind(attachment) {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(attachment?.name ?? '')?.[1]
  if (extension) return extension.toUpperCase()
  if (attachment?.type?.startsWith('image/')) return 'Image'
  return null
}

export function getAttachmentIcon(type) {
  if (!type) return 'carbon:document'
  if (type.startsWith('image/')) return 'carbon:image'
  if (type === 'application/pdf') return 'carbon:document-pdf'
  if (type.startsWith('audio/')) return 'carbon:music'
  if (type.startsWith('video/')) return 'carbon:video'
  if (/zip|compressed|tar|rar|7z/.test(type)) return 'carbon:archive'
  if (type === 'text/calendar') return 'carbon:calendar'
  if (type === 'message/rfc822') return 'carbon:email'
  return 'carbon:document'
}
