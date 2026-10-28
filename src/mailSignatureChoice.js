// The signature under a student's mails, as Réglages › Messagerie and the
// composer choose it, shared by the page and the server (server/mailSend.js,
// server/mailSignature.js check it again). Pure, tested on its own
// (tests/mailSignature.test.js).
//
// Three kinds: 'auto', built by the server from the account and the
// university's config; 'partage', the one the student set in the webmail;
// 'custom', their own text, written in Réglages and kept in the webmail as
// one more of their signatures (CUSTOM_SIGNATURE_NAME), so it follows them
// to every device and into the webmail itself.
export const SIGNATURE_KINDS = ['auto', 'partage', 'custom']

// The webmail signature Tafac writes, the only one it ever changes.
export const CUSTOM_SIGNATURE_NAME = 'Tafac'

// A few lines, as a signature is: past this the write is refused (not cut,
// the student sees what's kept).
export const CUSTOM_SIGNATURE_MAX_LENGTH = 2000
export const CUSTOM_SIGNATURE_MAX_LINES = 30

// Invisible characters and the like, kept out (a tab is a space, a line
// break stays).
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\u2028\u2029]/gu

export const isSignatureKind = (value) => SIGNATURE_KINDS.includes(value)

// The custom signature's text as it's kept: NFC, Unix line breaks, no
// control characters, no spaces at the end of a line, no empty lines around
// it nor more than one in a row. → { ok: true, text } ('' to remove it) or
// { ok: false, error: 'mail_signature_invalid' | 'mail_signature_too_long' }.
export function normalizeCustomSignatureText(value) {
  if (typeof value !== 'string') return { ok: false, error: 'mail_signature_invalid' }
  // Far past the limit: refused before the work below.
  if (value.length > CUSTOM_SIGNATURE_MAX_LENGTH * 4) return { ok: false, error: 'mail_signature_too_long' }
  const text = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(CONTROL_CHARACTERS, '').replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  if (Array.from(text).length > CUSTOM_SIGNATURE_MAX_LENGTH || text.split('\n').length > CUSTOM_SIGNATURE_MAX_LINES) {
    return { ok: false, error: 'mail_signature_too_long' }
  }
  return { ok: true, text }
}

// The CAS login the automatic signature names where the university asks
// for it (mail.signature.showLogin): letters, digits, « . », « - », « _ »,
// 32 at most. Anything else (an address typed to sign in, nothing) is no
// line rather than a wrong one. → the login, or null.
const LOGIN_PATTERN = /^[A-Za-z0-9._-]{1,32}$/

export function signatureLogin(user) {
  const login = typeof user === 'string' ? user.trim() : ''
  return LOGIN_PATTERN.test(login) ? login : null
}

// The line as the signature shows it.
export const signatureLoginLine = (login) => `Identifiant : ${login}`

// GET /__ent_auth/mail/signatures's answer, checked before the page draws
// it → { signatures: [{ id, name, html, text, hasImages }], identities: [{
// id, signatureId, replySignatureId }], customId, maxLength }. The HTML is
// the server's (cleaned already); the page draws it through its own
// allowlist again (src/components/MailSignatureHtml.jsx).
const ID_PATTERN = /^[A-Za-z0-9:._-]{1,64}$/
const readId = (value) => (typeof value === 'string' && ID_PATTERN.test(value) ? value : null)

export function readMailSignatures(payload) {
  const signatures = (Array.isArray(payload?.signatures) ? payload.signatures : [])
    .slice(0, 30)
    .filter((entry) => readId(entry?.id))
    .map((entry) => ({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name.slice(0, 80) : '',
      html: typeof entry.html === 'string' ? entry.html.slice(0, 20_000) : '',
      text: typeof entry.text === 'string' ? entry.text.slice(0, 4000) : '',
      hasImages: entry.hasImages === true,
    }))
  const known = new Set(signatures.map((entry) => entry.id))
  const own = (value) => (readId(value) && known.has(value) ? value : null)
  return {
    signatures,
    identities: (Array.isArray(payload?.identities) ? payload.identities : [])
      .slice(0, 20)
      .filter((entry) => readId(entry?.id))
      .map((entry) => ({ id: entry.id, signatureId: own(entry.signatureId), replySignatureId: own(entry.replySignatureId) })),
    customId: own(payload?.customId),
    maxLength: Number.isSafeInteger(payload?.maxLength) && payload.maxLength > 0 ? Math.min(payload.maxLength, CUSTOM_SIGNATURE_MAX_LENGTH) : CUSTOM_SIGNATURE_MAX_LENGTH,
  }
}

// The signature a kind shows for a draft: the custom one, or the webmail's
// that its identity takes (the first identity's when none is picked), the
// reply one for a reply or a forward. → the signature, or null.
export function pickShownSignature(data, kind, { identityId = null, reply = false } = {}) {
  if (!data) return null
  const byId = (id) => data.signatures.find((entry) => entry.id === id) ?? null
  if (kind === 'custom') return byId(data.customId)
  if (kind !== 'partage') return null
  const identity = data.identities.find((entry) => entry.id === identityId) ?? data.identities[0] ?? null
  return byId(reply ? identity?.replySignatureId : identity?.signatureId) ?? byId(identity?.signatureId)
}

// The classes of the signature's frame (src/overrides.css): the student's
// own in the text's colour, the automatic one muted.
export function signatureClassName(value) {
  return value?.kind && value.kind !== 'auto' ? 'mail-composer-signature mail-composer-signature--own' : 'mail-composer-signature'
}

// A text signature as the HTML the page draws (MailSignatureHtml), for the
// preview of one being written: a line a <div>, escaped.
export function plainSignatureHtml(text) {
  const escape = (line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return String(text ?? '').split('\n').map((line) => `<div>${line ? escape(line) : '<br>'}</div>`).join('')
}
