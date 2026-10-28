import { attachmentReferences } from './mailAttachments.js'
import { isValidAddress } from './mailCompose.js'
import { isSignatureKind } from './mailSignatureChoice.js'

// What the composer sends to POST /__ent_auth/mail/send and /mail/draft
// (server/mailSend.js's normalizeComposePayload checks all of it again).
// Pure, so it can be tested without a DOM. Never a From address (an
// identity's id: the server sets the address) nor the signature's HTML
// (its kind and two short choices: the server builds it).

// The composer's kinds of answer, as the server names them.
const ORIGIN_KINDS = { reply: 'reply', 'reply-all': 'replyAll', forward: 'forward' }

// The mail a reply or a forward is of: the original's id (MailComposer's
// `message`), or the one a resumed draft remembered.
export function composeOrigin(kind, message, savedOrigin = null) {
  if (message?.id && ORIGIN_KINDS[kind]) return { kind: ORIGIN_KINDS[kind], messageId: message.id }
  return savedOrigin?.messageId ? { kind: savedOrigin.kind === 'forward' ? 'forward' : savedOrigin.kind === 'replyAll' ? 'replyAll' : 'reply', messageId: savedOrigin.messageId } : null
}

const recipientsOf = (list) => (Array.isArray(list) ? list : [])
  .filter((address) => !address.invalid && isValidAddress(address.email))
  .map((address) => ({ name: address.name || '', email: address.email }))

// `state`: the draft as the composer holds it ({ to, cc, bcc, subject,
// html, attachments (its items), origin, identityId, signature }), `refs`
// a Map of item key → { messageId, part }: what a saved draft made of its
// files (createDraftSaver), named instead of their uploads. A token marked
// invalid isn't sent (a send refuses it before, a draft leaves it out).
export function buildComposePayload(state, { refs = null, draftId = null, sendUid = null } = {}) {
  const ready = (Array.isArray(state.attachments) ? state.attachments : []).filter((item) => item.status === 'ready')
  const references = attachmentReferences(ready).map((reference, index) => {
    const saved = refs?.get(ready[index].key)
    return saved ? { source: 'message', messageId: saved.messageId, part: saved.part } : reference
  })
  return {
    to: recipientsOf(state.to),
    cc: recipientsOf(state.cc),
    bcc: recipientsOf(state.bcc),
    subject: String(state.subject ?? ''),
    html: String(state.html ?? ''),
    attachments: references,
    origin: state.origin ?? null,
    identityId: state.identityId ?? null,
    signature: {
      include: Boolean(state.signature?.include),
      // Which one (src/mailSignatureChoice.js): the server reads the
      // student's own from the webmail itself.
      ...(isSignatureKind(state.signature?.mode) ? { mode: state.signature.mode } : null),
      ...(state.signature?.group ? { group: state.signature.group } : null),
      ...(state.signature?.establishment ? { establishment: state.signature.establishment } : null),
    },
    ...(draftId ? { draftId } : null),
    ...(sendUid ? { sendUid } : null),
  }
}

// A draft's content, to tell whether it changed since its last save: the
// attachments by their key (a file keeps its key once it's a part of the
// draft), not by their reference.
export function draftStateKey(state) {
  return JSON.stringify([
    recipientsOf(state.to), recipientsOf(state.cc), recipientsOf(state.bcc),
    String(state.subject ?? ''), String(state.html ?? ''),
    (state.attachments ?? []).filter((item) => item.status === 'ready').map((item) => item.key),
    state.origin ?? null, state.identityId ?? null, state.signature ?? null,
  ])
}

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()

// The identity « De : » starts on: for a reply or a forward, the one the
// original was sent to (in its À or Cc), else the default (the list's
// first, as /mail/prefs gives it).
export function pickDefaultIdentity(identities, message = null) {
  const list = Array.isArray(identities) ? identities : []
  if (message) {
    const addressed = new Set([...(message.to ?? []), ...(message.cc ?? [])].map((address) => normalizeEmail(address?.email)))
    const match = list.find((identity) => addressed.has(normalizeEmail(identity.email)))
    if (match) return match.id
  }
  return list[0]?.id ?? null
}

// What a failed send says (the composer's notice, reopened). `result`:
// sendMail's ({ code, retryAfter, invalid }).
export function sendFailureText(result) {
  switch (result?.code) {
    case 'invalid-recipients':
      return result.invalid?.length > 1 ? 'Des adresses ont été refusées' : 'Une adresse a été refusée'
    case 'no-recipient':
      return 'Aucun destinataire'
    case 'too-many-recipients':
      return 'Trop de destinataires'
    case 'upload-expired':
      return 'Une pièce jointe est à joindre de nouveau'
    case 'missing-reference':
      return 'Une pièce jointe n’est plus disponible'
    case 'too-large':
      return 'Le message est trop volumineux'
    case 'quota':
      return 'Ta boîte mail est pleine'
    case 'rate':
      return result.retryAfter && result.retryAfter < 120 ? `Trop d’envois, réessaie dans ${result.retryAfter} s` : 'Trop d’envois, réessaie plus tard'
    case 'expired':
      return 'Session expirée, reconnecte-toi'
    case 'identity':
      return 'Cette adresse d’envoi n’est plus disponible'
    default:
      return 'Le message n’est pas parti, réessaie'
  }
}

// A send's unique id (Zimbra's suid): the same for a request tried again,
// so the mail never goes twice.
export function createSendUid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
