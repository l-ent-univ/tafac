// The demo account's mailbox: its sample inbox (src/demoAccount.js) and
// what a visitor does there, kept by the page. Nothing of it ever leaves:
// a mail « sent » goes to its own « Envoyés », a draft to its « Brouillons »,
// a file is read and dropped. The same checks as a real send's all the same
// (server/mailSend.js, which this follows: tests/demoMail.test.js holds the
// body's check to the server's), so the composer says what it would say.
//
// Kept for the tab: in sessionStorage, as the page keeps what belongs to
// one sign-in in one tab (src/appHistory.js). A reload finds the mails
// sent and the drafts again; closing the tab or signing out drops them, and
// what a visitor wrote never waits for the next person on a shared
// computer. A file just picked lives in memory only, until a send or a
// save takes it: after a reload the composer is told to attach it again,
// as it is when an upload has expired.
//
// Pure but for the storage and the clock passed in.
import { DEMO_ACCOUNT, buildDemoMailPayload } from './demoAccount.js'
import {
  MAX_COMPOSER_HTML_LENGTH,
  INLINE_CID_PATTERN,
  buildAutoSignature,
  buildSentHtml,
  cleanComposerHtml,
  composerHtmlToText,
  frameOwnSignature,
  plainSignatureToHtml,
  selectComposerImages,
} from './demoMailHtml.js'
import { HARD_ATTACHMENT_LIMIT_BYTES, MAX_ATTACHMENTS, deriveAttachmentLimits, normalizeAttachmentType, sanitizeAttachmentName } from './mailAttachments.js'
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_RECIPIENTS,
  MAX_RECIPIENT_SUGGESTIONS,
  RECIPIENT_QUERY_MIN_LENGTH,
  cleanRecipientSuggestions,
  isValidAddress,
  matchesRecipientQuery,
  normalizeRecipientQuery,
  recipientKey,
  sanitizeDisplayName,
} from './mailCompose.js'
import { MAX_INLINE_IMAGES } from './mailInlineImages.js'
import { foldMailSearchText, parseMailSearchWords } from './mailSearch.js'
import { CUSTOM_SIGNATURE_MAX_LENGTH, CUSTOM_SIGNATURE_NAME, isSignatureKind, normalizeCustomSignatureText } from './mailSignatureChoice.js'
import { CONTROL_CHARACTERS, capLength, escapeHtml } from './mailText.js'

export const DEMO_MAIL_STORAGE_KEY = 'l-ent:demo-mail'

// ── What the demo's mailbox holds from the start ───────────────────────────

const INBOX_FOLDER = '2'
const SENT_FOLDER = '5'
const DRAFTS_FOLDER = '6'
const TRASH_FOLDER = '3'
const JUNK_FOLDER = '4'

// Its tree: the system folders and one empty sub-folder of the inbox, so
// the « Dossiers » menu has something to show.
export const DEMO_MAIL_FOLDERS = Object.freeze([
  { id: '2', kind: 'inbox', name: 'Inbox', unread: 7, count: 5, parentId: null, path: 'Inbox', depth: 0 },
  { id: '300', kind: 'folder', name: 'Moodle', unread: 0, count: 0, parentId: '2', path: 'Inbox/Moodle', depth: 1 },
  { id: '5', kind: 'sent', name: 'Sent', unread: 0, count: 0, parentId: null, path: 'Sent', depth: 0 },
  { id: '6', kind: 'drafts', name: 'Drafts', unread: 0, count: 0, parentId: null, path: 'Drafts', depth: 0 },
  { id: '4', kind: 'junk', name: 'Junk', unread: 0, count: 0, parentId: null, path: 'Junk', depth: 0 },
  { id: '3', kind: 'trash', name: 'Trash', unread: 0, count: 0, parentId: null, path: 'Trash', depth: 0 },
])

// Its sample attachments, by message: files for a forward to carry (nothing
// behind them: no link).
const DEMO_MAIL_ATTACHMENTS = {
  'demo-mail-1': [
    { part: '2', name: 'Consignes – dossier de presse.pdf', type: 'application/pdf', size: 248_312, href: null },
    { part: '3', name: 'exemple-communique.png', type: 'image/png', size: 612_480, href: null },
  ],
}

// Its address and a second one, for « De : » to offer a choice.
export const DEMO_MAIL_IDENTITIES = Object.freeze([
  { id: 'demo-default', name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email, isDefault: true },
  { id: 'demo-etudiant', name: DEMO_ACCOUNT.name, email: 'camille.martin@etudiant.tafac.fr', isDefault: false },
])

// Its webmail signature, as the server gives a student's once cleaned (an
// HTML one, a link kept, an image left out: `hasImages`), which its first
// identity names; the second names none (« Partage » takes the first one
// there is). Its custom one is the visitor's, kept with the mailbox.
const DEMO_PARTAGE_SIGNATURE = Object.freeze({
  id: 'demo-signature-partage',
  name: 'Signature',
  html: `<div><strong>${escapeHtml(DEMO_ACCOUNT.name)}</strong></div><div style="color:#6b625b">Étudiante · compte de démonstration</div><div><a href="https://tafac.fr">tafac.fr</a></div>`,
  text: `${DEMO_ACCOUNT.name}\nÉtudiante · compte de démonstration\ntafac.fr (https://tafac.fr)`,
  hasImages: true,
})
const DEMO_SIGNATURE_IDS = new Map([['demo-default', { signatureId: DEMO_PARTAGE_SIGNATURE.id, replySignatureId: null }]])
const DEMO_CUSTOM_SIGNATURE_ID = 'demo-signature-tafac'

// Its address book: made-up people of the demo's mails and a few more, so
// typing finds someone; the demo planning's teachers among them (« Écrire
// au sujet de ce cours »), two Le Fur for a teacher found twice.
export const DEMO_MAIL_CONTACTS = Object.freeze([
  { name: 'Thomas Lemoine', email: 'thomas.lemoine@univ-rennes.fr', kind: 'recent' },
  { name: 'Scolarité IUT de Lannion', email: 'scolarite-iut-lannion@univ-rennes.fr', kind: 'recent' },
  { name: 'BU Lannion', email: 'bu-lannion@univ-rennes.fr', kind: 'directory' },
  { name: 'BDE Info-Com Lannion', email: 'bde.infocom.lannion@gmail.com', kind: 'contact' },
  { name: 'Léa Moreau', email: 'lea.moreau@etudiant.univ-rennes.fr', kind: 'contact' },
  { name: 'Lucas Bernard', email: 'lucas.bernard@etudiant.univ-rennes.fr', kind: 'contact' },
  { name: 'Camille Lefèvre', email: 'camille.lefevre@univ-rennes.fr', kind: 'directory' },
  { name: 'Hugo Martin', email: 'hugo.martin@etudiant.univ-rennes.fr', kind: 'directory' },
  { name: 'Manon Le Gall', email: 'manon.le-gall@univ-rennes.fr', kind: 'directory' },
  { name: 'Secrétariat Info-Com', email: 'secretariat-infocom-lannion@univ-rennes.fr', kind: 'directory' },
  { name: 'Info-Com 3e année', email: 'infocom3-lannion@listes.univ-rennes.fr', kind: 'group' },
  { name: 'Service des sports', email: 'suaps@univ-rennes.fr', kind: 'directory' },
  { name: 'Anne Le Fur', email: 'anne.le-fur@univ-rennes.fr', kind: 'directory' },
  { name: 'Yann Le Fur', email: 'yann.le-fur@univ-rennes.fr', kind: 'directory' },
  { name: 'Sophie Riou', email: 'sophie.riou@univ-rennes.fr', kind: 'directory' },
  { name: 'Gwenola Kerjean', email: 'gwenola.kerjean@univ-rennes.fr', kind: 'directory' },
  { name: 'Erwan Le Goff', email: 'erwan.le-goff@univ-rennes.fr', kind: 'directory' },
  { name: 'Pierre Guillou', email: 'pierre.guillou@univ-rennes.fr', kind: 'directory' },
  { name: 'Claire Martin', email: 'claire.martin@univ-rennes.fr', kind: 'directory' },
])

// Its contacts whose name or address a word of the query starts, as the
// webmail matches.
export function searchDemoMailContacts(query, limit = MAX_RECIPIENT_SUGGESTIONS) {
  return cleanRecipientSuggestions(DEMO_MAIL_CONTACTS.filter((contact) => matchesRecipientQuery(contact, query)), limit)
}

// ── Its ids ────────────────────────────────────────────────────────────────

// demo-mail-1… (the sample inbox), demo-draft-1… and demo-sent-1… (the
// visitor's); a file picked is demo-upload-<uuid>.
export function isValidDemoMailMessageId(value) {
  return typeof value === 'string' && /^demo-(?:mail|draft|sent)-\d{1,4}$/.test(value)
}

const DEMO_UPLOAD_ID_PATTERN = /^demo-upload-[0-9a-f-]{36}$/
const isValidDemoUploadId = (aid) => typeof aid === 'string' && DEMO_UPLOAD_ID_PATTERN.test(aid)
const isValidMailFolderId = (value) => typeof value === 'string' && /^\d{1,9}$/.test(value)

// ── Its bounds ─────────────────────────────────────────────────────────────

// The list asks for its next page by offset, up to this.
const MAIL_MAX_OFFSET = 5000
// A selection is the loaded list at most.
const MAIL_ACTION_MAX_IDS = 500
const MAIL_ACTIONS = new Set(['read', 'unread', 'flag', 'unflag', 'trash', 'spam', 'inbox', 'move', 'delete', 'discard'])
const MAIL_FOLDER_ACTIONS = new Set(['read', 'empty'])
// The files a mailbox's sends may name, the oldest forgotten past this.
const MAIL_UPLOADS_KEPT = 200
// An image picked is kept (any other file is only measured) for the mail's
// copy in « Envoyés » and its drafts to show it: up to this size, so many
// bytes of them in all, and a mail's or a draft's text this long at most.
// So many drafts and sent mails, the oldest sent ones forgotten first.
const DEMO_IMAGE_KEPT_BYTES = 1024 * 1024
const DEMO_IMAGES_KEPT_BYTES = 4 * 1024 * 1024
const DEMO_MAIL_HTML_MAX = 256 * 1024
const DEMO_DRAFTS_MAX = 20
const DEMO_SENT_MAX = 50
// A send asked for twice (the same uid) gets its first answer: so many of
// the last ones are remembered.
const DEMO_SEND_UIDS_KEPT = 20

// ── A send's or a draft's body, checked ────────────────────────────────────

// As the server takes them (server/mailSend.js: normalizeComposePayload
// and what it reads with).
const MAX_SUBJECT_LENGTH = 255
const MAX_SIGNATURE_GROUP_LENGTH = 80
const MAX_INLINE_IMAGE_WIDTH = 560
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])
const SEND_UID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
const IDENTITY_ID_PATTERN = /^[A-Za-z0-9:._-]{1,64}$/
const ESTABLISHMENT_ID_PATTERN = /^[a-z0-9-]{1,40}$/
const PART_ID_PATTERN = /^\d+(?:\.\d+)*$/
const ORIGIN_KINDS = { reply: 'r', replyAll: 'r', forward: 'w' }

function sanitizeSubject(value) {
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

// A file as a send names it: one picked in this tab, or a part of a mail
// of the demo's (a forwarded mail's, a draft's). Null for any other.
function readPartReference(entry) {
  if (entry?.source === 'upload' && isValidDemoUploadId(entry.aid)) return { source: 'upload', aid: entry.aid }
  if (entry?.source === 'message' && isValidDemoMailMessageId(entry.messageId)
    && typeof entry.part === 'string' && entry.part.length <= 40 && PART_ID_PATTERN.test(entry.part)) {
    return { source: 'message', messageId: entry.messageId, part: entry.part }
  }
  return null
}

const referenceKey = (reference) => (reference.source === 'upload' ? reference.aid : `${reference.messageId}/${reference.part}`)

function readInlineImages(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_INLINE_IMAGES) return null
  const images = []
  for (const entry of value) {
    const cid = typeof entry?.cid === 'string' ? entry.cid.toLowerCase() : ''
    const reference = readPartReference(entry)
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

// The composer's body (src/mailSendPayload.js), checked as the server
// checks a real one. A draft takes what a send would refuse (no recipient,
// an address not yet right: left out of the saved draft).
// → { ok: true, value: { to, cc, bcc, subject, html, attachments,
//      inlineImages, origin, identityId, draftId, sendUid, signature } }
//   or { ok: false, error, invalid? } (error: the server's code).
export function readDemoComposeBody(body, { draft = false } = {}) {
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

  // Attachments: references only, of the demo's kinds, each once.
  const rawAttachments = body.attachments ?? []
  if (!Array.isArray(rawAttachments) || rawAttachments.length > MAX_ATTACHMENTS) return { ok: false, error: 'mail_send_invalid' }
  const attachments = []
  const attachmentKeys = new Set()
  for (const entry of rawAttachments) {
    const reference = readPartReference(entry)
    if (!reference) return { ok: false, error: 'mail_send_invalid' }
    const key = referenceKey(reference)
    if (attachmentKeys.has(key)) continue
    attachmentKeys.add(key)
    attachments.push(reference)
  }

  // The text's images, none of them a file attached as well.
  const listedImages = readInlineImages(body.inlineImages)
  if (!listedImages || listedImages.some((image) => attachmentKeys.has(referenceKey(image)))) return { ok: false, error: 'mail_send_invalid' }
  const { html, images: inlineImages } = selectComposerImages(cleanComposerHtml(body.html ?? ''), listedImages)

  let origin = null
  if (body.origin !== undefined && body.origin !== null) {
    const kind = body.origin?.kind
    if (!Object.hasOwn(ORIGIN_KINDS, kind) || !isValidDemoMailMessageId(body.origin.messageId)) {
      return { ok: false, error: 'mail_send_invalid' }
    }
    origin = { kind, messageId: body.origin.messageId, replyType: ORIGIN_KINDS[kind] }
  }

  const identityId = body.identityId === undefined || body.identityId === null ? null : body.identityId
  if (identityId !== null && (typeof identityId !== 'string' || !IDENTITY_ID_PATTERN.test(identityId))) return { ok: false, error: 'mail_send_invalid' }

  const draftId = body.draftId === undefined || body.draftId === null ? null : body.draftId
  if (draftId !== null && !isValidDemoMailMessageId(draftId)) return { ok: false, error: 'mail_send_invalid' }

  const sendUid = draft ? null : body.sendUid
  if (!draft && (typeof sendUid !== 'string' || !SEND_UID_PATTERN.test(sendUid))) return { ok: false, error: 'mail_send_invalid' }

  const rawSignature = body.signature ?? {}
  if (typeof rawSignature !== 'object' || Array.isArray(rawSignature)) return { ok: false, error: 'mail_send_invalid' }
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

// ── The mailbox ────────────────────────────────────────────────────────────

// A send or a save the mailbox refuses, with the server's status and code.
class Refusal extends Error {
  constructor(status, code, extra = null) {
    super(code)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

const answer = (status, body) => ({ status, body })

const TEXT_LINK_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi

// A plain text body as the reader is given it (the server's
// mailTextToHtml): escaped, links clickable (trailing punctuation left out
// of them), lines kept.
function mailTextToHtml(text) {
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

function bytesToBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function readStored(storage) {
  try {
    const stored = JSON.parse(storage?.getItem(DEMO_MAIL_STORAGE_KEY) ?? 'null')
    if (!stored || typeof stored !== 'object') return null
    return {
      drafts: new Map(Array.isArray(stored.drafts) ? stored.drafts.filter((entry) => isValidDemoMailMessageId(entry?.[0]) && entry[1]?.row && entry[1]?.draft) : []),
      sent: Array.isArray(stored.sent) ? stored.sent.filter((entry) => entry?.row && entry?.message) : [],
      flags: new Map(Array.isArray(stored.flags) ? stored.flags.filter((entry) => isValidDemoMailMessageId(entry?.[0])) : []),
      next: Number.isSafeInteger(stored.next) && stored.next > 0 ? stored.next : 1,
      customSignature: typeof stored.customSignature === 'string' ? stored.customSignature : '',
    }
  } catch {
    return null
  }
}

// The identity a send uses: the one asked for, or the default when none
// is; null for an id the account doesn't have.
function pickIdentity(identityId) {
  if (!identityId) return DEMO_MAIL_IDENTITIES[0]
  return DEMO_MAIL_IDENTITIES.find((identity) => identity.id === identityId) ?? null
}

// The webmail signature « Partage » takes: the identity's own (the reply
// one for a reply or a forward when it names one), else the first one
// there is besides the custom one.
function pickPartageSignature(signatures, ids, { reply = false } = {}) {
  const byId = (id) => (id ? signatures.find((signature) => signature.id === id) ?? null : null)
  return (reply ? byId(ids?.replySignatureId) : null)
    ?? byId(ids?.signatureId)
    ?? signatures.find((signature) => signature.name !== CUSTOM_SIGNATURE_NAME && signature.text)
    ?? null
}

const findCustomSignature = (signatures) => signatures.find((signature) => signature.name === CUSTOM_SIGNATURE_NAME) ?? null

// The order the files end up in a mail: those picked first, then the parts
// of other mails, whatever order the composer had them in.
function attachmentOrder(attachments) {
  const indices = attachments.map((entry, index) => ({ entry, index }))
  return [
    ...indices.filter(({ entry }) => entry.source === 'upload').map(({ index }) => index),
    ...indices.filter(({ entry }) => entry.source !== 'upload').map(({ index }) => index),
  ]
}

const uploadAids = (payload) => [
  ...payload.attachments.filter((entry) => entry.source === 'upload').map((entry) => entry.aid),
  ...payload.inlineImages.filter((entry) => entry.source === 'upload').map((entry) => entry.aid),
]

// options:
//   storage    where the mailbox is kept (sessionStorage; none: memory only)
//   now        the clock
//   config     the university's client config: what the automatic signature
//              shows (mail.signature.showLogin, the establishments' labels,
//              the university's name), as the composer draws it
//   login      the login that signature names where the university shows it
//   readLogos  (establishmentId) → the signature's logos, [{ src (a data:
//              URL), width, height, alt }], or a promise of them
//   makeId     a new file's id
export function createDemoMailbox({
  storage = null,
  now = () => Date.now(),
  config = {},
  login = null,
  readLogos = () => [],
  makeId = () => globalThis.crypto.randomUUID(),
} = {}) {
  let state = readStored(storage) ?? { drafts: new Map(), sent: [], flags: new Map(), next: 1, customSignature: '' }
  // aid → { size, name, contentType, data? }: the files picked, in order.
  const uploads = new Map()
  // sendUid → the answer it got.
  const sends = new Map()

  function persist() {
    try {
      storage?.setItem(DEMO_MAIL_STORAGE_KEY, JSON.stringify({
        drafts: [...state.drafts],
        sent: state.sent,
        flags: [...state.flags],
        next: state.next,
        customSignature: state.customSignature,
      }))
    } catch {
      // Storage full or unavailable: the mailbox lasts until a reload.
    }
  }

  const inbox = () => buildDemoMailPayload({ now: now() })

  // The list's rows with what the composer did: replied to, forwarded (the
  // reply arrow), its drafts and sent mails in their folders.
  function withState(mail, folder = INBOX_FOLDER) {
    if (folder === DRAFTS_FOLDER) return { ...mail, unreadCount: 0, messages: [...state.drafts.values()].map((entry) => entry.row).reverse(), hasMore: false }
    if (folder === SENT_FOLDER) return { ...mail, unreadCount: 0, messages: state.sent.map((entry) => entry.row), hasMore: false }
    if (!state.flags.size) return mail
    return {
      ...mail,
      messages: mail.messages.map((message) => {
        const flag = state.flags.get(message.id)
        return flag ? { ...message, replied: message.replied || flag === 'r', forwarded: message.forwarded || flag === 'w' } : message
      }),
    }
  }

  const findRow = (id) => state.drafts.get(id)?.row ?? state.sent.find((entry) => entry.row.id === id)?.row ?? null

  // A sample message: its preview, as a plain text mail.
  function sampleMessage(id) {
    const message = inbox().messages.find((entry) => entry.id === id)
    if (!message) return null
    return {
      id,
      subject: message.subject,
      from: message.from,
      replyTo: null,
      to: [],
      cc: [],
      receivedAt: message.receivedAt,
      unread: Boolean(message.unread),
      format: 'text',
      html: mailTextToHtml(message.snippet),
      remoteImages: 0,
      truncated: false,
      attachments: DEMO_MAIL_ATTACHMENTS[id] ?? [],
    }
  }

  function signatures() {
    const custom = state.customSignature
    return [
      DEMO_PARTAGE_SIGNATURE,
      ...(custom ? [{ id: DEMO_CUSTOM_SIGNATURE_ID, name: CUSTOM_SIGNATURE_NAME, html: plainSignatureToHtml(custom), text: custom, hasImages: false }] : []),
    ]
  }

  // What the page is given of them (GET /mail/signatures).
  function describeSignatures() {
    const list = signatures()
    return {
      signatures: list.map(({ id, name, html, text, hasImages }) => ({ id, name, html, text, hasImages })),
      identities: DEMO_MAIL_IDENTITIES.map((identity) => {
        const ids = DEMO_SIGNATURE_IDS.get(identity.id) ?? null
        return {
          id: identity.id,
          signatureId: pickPartageSignature(list, ids)?.id ?? null,
          replySignatureId: pickPartageSignature(list, ids, { reply: true })?.id ?? null,
        }
      }),
      customId: findCustomSignature(list)?.id ?? null,
      maxLength: CUSTOM_SIGNATURE_MAX_LENGTH,
    }
  }

  // The signature a mail takes → { html, text }: the student's own
  // (« Partage », « Personnalisée »), or the automatic one, with what the
  // composer shows of the university.
  async function buildSignature(payload, identity) {
    if (!payload.signature.include) return { html: '', text: '' }
    if (payload.signature.mode !== 'auto') {
      const list = signatures()
      const picked = payload.signature.mode === 'custom'
        ? findCustomSignature(list)
        : pickPartageSignature(list, DEMO_SIGNATURE_IDS.get(identity.id) ?? null, { reply: Boolean(payload.origin) })
      return frameOwnSignature(picked)
    }
    const establishment = payload.signature.establishment ? config.establishments?.byId?.[payload.signature.establishment] ?? null : null
    let logos = []
    try {
      logos = (await readLogos(establishment ? payload.signature.establishment : null)) ?? []
    } catch {
      // A logo that can't be read is left out: the signature's text stays.
    }
    return buildAutoSignature({
      name: identity.name,
      login: config.mail?.signature?.showLogin === true ? login : null,
      group: payload.signature.group ?? '',
      establishment: establishment?.label ?? '',
      university: config.university?.name ?? '',
      logos,
    })
  }

  // A mail's or a draft's text too long: refused, as the webmail refuses a
  // mail too big.
  function checkSize(payload) {
    if (String(payload.html ?? '').length > DEMO_MAIL_HTML_MAX) throw new Refusal(413, 'mail_send_too_large', { maxBytes: DEMO_MAIL_HTML_MAX })
  }

  // A file named that this tab no longer has (a reload since): to attach
  // again.
  function checkUploads(payload) {
    const unknown = uploadAids(payload).filter((aid) => !uploads.has(aid))
    if (unknown.length) throw new Refusal(409, 'mail_send_upload_expired', { aids: unknown })
  }

  // A reference's file, or null when there's none: a sample attachment, a
  // part of a draft, a file picked.
  function readFile(reference) {
    if (reference.source === 'upload') {
      const upload = uploads.get(reference.aid)
      return upload ? { name: upload.name, size: upload.size, contentType: upload.contentType } : null
    }
    const parts = DEMO_MAIL_ATTACHMENTS[reference.messageId]?.map((entry) => ({ ...entry, contentType: entry.type }))
      ?? state.drafts.get(reference.messageId)?.draft.attachments
    const part = parts?.find((entry) => entry.part === reference.part)
    return part ? { name: part.name, size: part.size, contentType: part.contentType } : null
  }

  function resolveFiles(attachments) {
    const files = attachments.map(readFile)
    if (files.some((file) => !file)) throw new Refusal(409, 'mail_send_missing_reference')
    const total = files.reduce((sum, file, index) => sum + (attachments[index].source === 'upload' ? file.size : 0), 0)
    const limits = deriveAttachmentLimits(null)
    if (total > limits.maxTotalBytes) throw new Refusal(413, 'mail_send_too_large', { maxBytes: limits.maxTotalBytes })
    return files
  }

  // The text's images, with their bytes: a file picked and kept, or a part
  // of a draft.
  function resolveImages(payload, files) {
    const images = payload.inlineImages.map((image) => {
      const file = image.source === 'upload'
        ? uploads.get(image.aid)
        : state.drafts.get(image.messageId)?.draft.inlineImages?.find((entry) => entry.part === image.part)
      return file?.data && INLINE_IMAGE_TYPES.has(file.contentType) ? { ...image, name: file.name, size: file.size, contentType: file.contentType, data: file.data } : null
    })
    if (images.some((image) => !image)) throw new Refusal(409, 'mail_send_missing_reference')
    const total = [...files.filter((file, index) => payload.attachments[index].source === 'upload'), ...images].reduce((sum, file) => sum + file.size, 0)
    const limits = deriveAttachmentLimits(null)
    if (total > limits.maxTotalBytes) throw new Refusal(413, 'mail_send_too_large', { maxBytes: limits.maxTotalBytes })
    return images
  }

  function row(id, identity, payload, text, date) {
    const first = payload.to[0] ?? payload.cc[0] ?? payload.bcc[0] ?? null
    return {
      id,
      from: { name: identity.name, email: identity.email },
      to: first ? { name: first.name || first.email, email: first.email } : null,
      subject: payload.subject,
      snippet: text.replace(/\s+/g, ' ').trim().slice(0, 280),
      receivedAt: new Date(date).toISOString(),
      unread: false,
      flagged: false,
      messageIds: [id],
      count: 1,
      href: null,
    }
  }

  const forgetUploads = (aids) => {
    for (const aid of aids) uploads.delete(aid)
  }

  async function sendMail(payload) {
    checkSize(payload)
    const identity = pickIdentity(payload.identityId)
    if (!identity) throw new Refusal(400, 'mail_send_invalid_identity')
    checkUploads(payload)
    const files = resolveFiles(payload.attachments)
    const images = resolveImages(payload, files)
    const signature = await buildSignature(payload, identity)
    const text = composerHtmlToText(payload.html, { signatureText: signature.text })
    const id = `demo-sent-${state.next}`
    state.next += 1
    const date = now()
    state.sent.unshift({
      row: row(id, identity, payload, text, date),
      message: {
        id,
        subject: payload.subject,
        from: { name: identity.name, email: identity.email },
        replyTo: null,
        to: payload.to.map((entry) => ({ name: entry.name || entry.email, email: entry.email })),
        cc: payload.cc.map((entry) => ({ name: entry.name || entry.email, email: entry.email })),
        receivedAt: new Date(date).toISOString(),
        unread: false,
        format: 'html',
        html: buildSentHtml(payload.html, {
          signatureHtml: signature.html,
          images: new Map(images.map((image) => [image.cid, { src: `data:${image.contentType};base64,${image.data}`, width: image.width, height: image.height, alt: image.alt }])),
        }),
        remoteImages: 0,
        truncated: false,
        attachments: files.map((file, index) => ({ part: String(index + 2), name: file.name, type: file.contentType, size: file.size, href: null })),
      },
    })
    state.sent.length = Math.min(state.sent.length, DEMO_SENT_MAX)
    if (payload.origin) state.flags.set(payload.origin.messageId, payload.origin.replyType)
    if (payload.draftId) state.drafts.delete(payload.draftId)
    forgetUploads(uploadAids(payload))
    persist()
  }

  function saveDraft(payload) {
    checkSize(payload)
    const identity = pickIdentity(payload.identityId) ?? DEMO_MAIL_IDENTITIES[0]
    checkUploads(payload)
    const files = resolveFiles(payload.attachments)
    const images = resolveImages(payload, files)
    let id = payload.draftId && state.drafts.has(payload.draftId) ? payload.draftId : null
    if (!id) {
      if (state.drafts.size >= DEMO_DRAFTS_MAX) throw new Refusal(413, 'mail_send_quota')
      id = `demo-draft-${state.next}`
      state.next += 1
    }
    const order = attachmentOrder(payload.attachments)
    const attachments = order.map((index, position) => ({ part: String(position + 2), ...files[index] }))
    // The text's images after them, each its part.
    const inlineImages = images.map((image, index) => ({
      cid: image.cid,
      part: String(attachments.length + 2 + index),
      name: image.name,
      size: image.size,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      data: image.data,
    }))
    state.drafts.set(id, {
      row: row(id, identity, payload, composerHtmlToText(payload.html), now()),
      draft: {
        id,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: payload.subject,
        html: payload.html,
        attachments,
        inlineImages,
        identityId: identity.id,
        origin: payload.origin ? { kind: payload.origin.replyType === 'w' ? 'forward' : 'reply', messageId: payload.origin.messageId } : null,
      },
    })
    forgetUploads(uploadAids(payload))
    persist()
    // Each of the composer's references as a part of the draft, in its order.
    const references = payload.attachments.map(() => null)
    order.forEach((index, position) => {
      references[index] = { messageId: id, part: attachments[position].part }
    })
    return {
      id,
      attachments: references,
      inlineImages: inlineImages.map((image) => ({ cid: image.cid, messageId: id, part: image.part })),
    }
  }

  const refused = (error) => {
    if (error instanceof Refusal) return answer(error.status, { error: error.code, ...error.extra })
    throw error
  }

  function readBody(body, { draft }) {
    const parsed = readDemoComposeBody(body, { draft })
    if (parsed.ok) return { payload: parsed.value }
    const status = parsed.error === 'mail_send_invalid' ? 400 : parsed.error === 'mail_send_too_large' ? 413 : 422
    return { refusal: answer(status, { error: parsed.error, ...(parsed.invalid ? { invalid: parsed.invalid } : null) }) }
  }

  // Each answers { status, body } as the server's route of the same name
  // answered the demo account (src/demoServer.js writes the response).
  return {
    // GET /mail/recent
    recent({ offset: rawOffset = '', q = '', folder: rawFolder = '' } = {}) {
      const offset = Math.min(Math.max(Number.parseInt(String(rawOffset ?? ''), 10) || 0, 0), MAIL_MAX_OFFSET)
      const words = parseMailSearchWords(q)
      const folder = isValidMailFolderId(String(rawFolder ?? '')) ? String(rawFolder) : INBOX_FOLDER
      if (folder !== INBOX_FOLDER) {
        // Its inbox, and what its composer saved and sent.
        const empty = { ...inbox(), unreadCount: 0, messages: [], hasMore: false }
        const mail = withState(empty, offset === 0 && !words.length ? folder : null)
        return answer(200, { authenticated: true, sessionMode: 'demo', mail: words.length ? { ...mail, unreadCount: null } : mail })
      }
      if (words.length) {
        // Its mails holding every word (accents, case and apostrophe styles
        // aside, as the page's local filter), one page.
        const folded = words.map(foldMailSearchText)
        const payload = inbox()
        const messages = offset > 0 ? [] : payload.messages.filter((message) => {
          const text = foldMailSearchText([message.from?.name, message.from?.email, message.subject, message.snippet].join(' '))
          return folded.every((word) => text.includes(word))
        })
        return answer(200, { authenticated: true, sessionMode: 'demo', mail: { ...payload, messages, hasMore: false, unreadCount: null } })
      }
      const mail = withState(inbox())
      return answer(200, {
        authenticated: true,
        sessionMode: 'demo',
        mail: offset === 0 ? mail : { ...mail, unreadCount: null, messages: [], hasMore: false },
      })
    },

    // GET /mail/message
    message(id) {
      if (!isValidDemoMailMessageId(id)) return answer(400, { error: 'Invalid message id.' })
      const message = sampleMessage(id) ?? state.sent.find((entry) => entry.row.id === id)?.message ?? null
      return message ? answer(200, { message }) : answer(404, { error: 'No such message.' })
    },

    // GET /mail/thread
    thread(id, rawFolder = '') {
      if (!isValidDemoMailMessageId(id)) return answer(400, { error: 'Invalid thread id.' })
      const folder = isValidMailFolderId(String(rawFolder ?? '')) ? String(rawFolder) : INBOX_FOLDER
      const messages = [...withState(inbox()).messages.filter((message) => message.id === id), ...[findRow(id)].filter(Boolean)]
        .map((message) => ({ ...message, messageIds: [message.id], count: 1, folder }))
      return answer(200, { messages })
    },

    // GET /mail/folders
    folders() {
      return answer(200, { folders: DEMO_MAIL_FOLDERS })
    },

    // POST /mail/action: nothing moves in the demo, but the same rules;
    // its drafts go when discarded, trashed or deleted.
    action(body) {
      const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
      if (!ids.length || ids.length > MAIL_ACTION_MAX_IDS || !ids.every(isValidDemoMailMessageId)) return answer(400, { error: 'Invalid message ids.' })
      if (!MAIL_ACTIONS.has(body?.action)) return answer(400, { error: 'Invalid action.' })
      if (body.action === 'move') {
        const folder = String(body?.folder ?? '')
        if (!isValidMailFolderId(folder) || !DEMO_MAIL_FOLDERS.some((entry) => entry.id === folder)) return answer(400, { error: 'Invalid folder.' })
      }
      if (['discard', 'trash', 'delete'].includes(body.action) && ids.some((id) => state.drafts.delete(id))) persist()
      return answer(200, { ok: true })
    },

    // POST /mail/folder-action: a demo folder doesn't change.
    folderAction(body) {
      const action = typeof body?.action === 'string' && MAIL_FOLDER_ACTIONS.has(body.action) ? body.action : null
      if (!action) return answer(400, { error: 'Invalid action.' })
      const folder = String(body?.folder ?? '')
      const emptiable = folder === TRASH_FOLDER || folder === JUNK_FOLDER
      if (!isValidMailFolderId(folder) || Number(folder) < 2 || (action === 'empty' && !emptiable) || !DEMO_MAIL_FOLDERS.some((entry) => entry.id === folder)) {
        return answer(400, { error: 'Invalid folder.' })
      }
      return answer(200, { ok: true })
    },

    // GET /mail/prefs: an open mail is marked read at once, the fallback
    // limits, its two addresses.
    prefs() {
      const limits = deriveAttachmentLimits(null)
      return answer(200, {
        markRead: 0,
        attachments: { maxFileBytes: limits.maxFileBytes, maxTotalBytes: limits.maxTotalBytes },
        identities: DEMO_MAIL_IDENTITIES.map(({ id, name, email }) => ({ id, name, email })),
      })
    },

    // GET /mail/autocomplete
    autocomplete(q) {
      const query = normalizeRecipientQuery(q)
      return answer(200, { suggestions: query.length < RECIPIENT_QUERY_MIN_LENGTH ? [] : searchDemoMailContacts(query) })
    },

    // POST /mail/upload: a file picked. `bytes`: read only when asked for
    // (`keeps(type, size)` says so: a small image).
    keepsUpload(contentType, size) {
      let kept = 0
      for (const entry of uploads.values()) kept += entry.data ? entry.size : 0
      return INLINE_IMAGE_TYPES.has(normalizeAttachmentType(contentType)) && size <= DEMO_IMAGE_KEPT_BYTES && kept + size <= DEMO_IMAGES_KEPT_BYTES
    },
    upload({ name, contentType, size, bytes = null }) {
      if (!Number.isSafeInteger(size) || size < 0) return answer(411, { error: 'mail_upload_length_required' })
      if (size === 0) return answer(400, { error: 'mail_upload_empty' })
      if (size > HARD_ATTACHMENT_LIMIT_BYTES) return answer(413, { error: 'mail_upload_too_large', maxBytes: HARD_ATTACHMENT_LIMIT_BYTES })
      const limits = deriveAttachmentLimits(null)
      if (size > limits.maxFileBytes) return answer(413, { error: 'mail_upload_too_large', maxBytes: limits.maxFileBytes })
      const file = { size, name: sanitizeAttachmentName(name), contentType: normalizeAttachmentType(contentType) }
      const aid = `demo-upload-${makeId()}`
      uploads.set(aid, { ...file, ...(bytes ? { data: bytesToBase64(bytes) } : null) })
      while (uploads.size > MAIL_UPLOADS_KEPT) uploads.delete(uploads.keys().next().value)
      return answer(200, { attachment: { aid, ...file } })
    },

    // POST /mail/send. A send uid already answered gets its first answer.
    async send(body) {
      const { payload, refusal } = readBody(body, { draft: false })
      if (refusal) return refusal
      if (sends.has(payload.sendUid)) return sends.get(payload.sendUid)
      try {
        await sendMail(payload)
      } catch (error) {
        return refused(error)
      }
      const sent = answer(200, { ok: true })
      sends.set(payload.sendUid, sent)
      while (sends.size > DEMO_SEND_UIDS_KEPT) sends.delete(sends.keys().next().value)
      return sent
    },

    // POST /mail/draft
    saveDraft(body) {
      const { payload, refusal } = readBody(body, { draft: true })
      if (refusal) return refusal
      try {
        return answer(200, { draft: saveDraft(payload) })
      } catch (error) {
        return refused(error)
      }
    },

    // GET /mail/draft: a draft, to resume it in the composer; its images
    // where the composer shows them from (a data: URL).
    draft(id) {
      if (!isValidDemoMailMessageId(id)) return answer(400, { error: 'Invalid message id.' })
      const draft = state.drafts.get(id)?.draft ?? null
      if (!draft) return answer(404, { error: 'No such draft.' })
      const inlineImages = (draft.inlineImages ?? []).map(({ data, ...image }) => ({ ...image, href: `data:${image.contentType};base64,${data}` }))
      return answer(200, { draft: { ...draft, html: cleanComposerHtml(draft.html), inlineImages, droppedImages: 0 } })
    },

    // GET /mail/signatures
    signatures() {
      return answer(200, describeSignatures())
    },

    // POST /mail/signature: the custom signature written ('' removes it).
    saveSignature(body) {
      const parsed = normalizeCustomSignatureText(body?.text)
      if (!parsed.ok) return answer(parsed.error === 'mail_signature_too_long' ? 413 : 400, { error: parsed.error })
      state.customSignature = parsed.text
      persist()
      return answer(200, describeSignatures())
    },

    // Signed out of the demo: nothing of it stays.
    clear() {
      state = { drafts: new Map(), sent: [], flags: new Map(), next: 1, customSignature: '' }
      uploads.clear()
      sends.clear()
      try {
        storage?.removeItem(DEMO_MAIL_STORAGE_KEY)
      } catch {
        // Nothing was kept there.
      }
    },
  }
}
