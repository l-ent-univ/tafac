import { messageAttachmentItems } from './mailAttachments.js'

// The composer's prefill (MailComposer): who a reply goes to, its subject,
// the line over the quoted mail. Pure, so it can be tested without a DOM;
// the mail's text itself is pulled out of its html by the component (it
// needs a DOMParser).

// The recipients (À, Cc, Cci) are what a send route will one day write into
// a mail's headers, so they are held strictly here, before anything leaves:
// an address is a plain addr-spec (a dot-atom local part, a domain of
// dot-separated labels, RFC 5321's lengths), never a quoted or commented
// form, and nothing that could end a header line (CR, LF, any control
// character) or open another address (< > , ; " and spaces) gets through.
// Accented letters are allowed (internationalised addresses). What fails
// stays a token marked `invalid`, shown as such, for the student to fix.
const LOCAL_PART = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u
const TOP_LEVEL_DOMAIN = /^(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu
export const MAX_ADDRESS_LENGTH = 254
const MAX_LOCAL_PART_LENGTH = 64
// A display name past this is cut: no real name is that long.
export const MAX_DISPLAY_NAME_LENGTH = 128
// Across À, Cc and Cci together: a mail to more is a mailing list's job,
// and a paste of thousands of lines stays bounded.
export const MAX_RECIPIENTS = 100
// What one paste or one field's text is read up to (MAX_RECIPIENTS
// addresses, named, fit in it many times over).
export const MAX_RECIPIENT_TEXT_LENGTH = 20_000

// Control and format characters (CR, LF, tabs, NUL, the bidi overrides that
// can turn « moc.vinu » around…), the line and paragraph separators.
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\u2028\u2029]/gu

// At most `max` characters, never cutting a surrogate pair in half.
const capLength = (text, max) => (text.length > max ? Array.from(text).slice(0, max).join('') : text)

export function isValidAddress(email) {
  const value = String(email ?? '').trim().normalize('NFC')
  if (!value || value.length > MAX_ADDRESS_LENGTH) return false
  const at = value.lastIndexOf('@')
  if (at < 1) return false
  const local = value.slice(0, at)
  const labels = value.slice(at + 1).split('.')
  return local.length <= MAX_LOCAL_PART_LENGTH
    && LOCAL_PART.test(local)
    && labels.length >= 2
    && labels.every((label) => DOMAIN_LABEL.test(label))
    && TOP_LEVEL_DOMAIN.test(labels[labels.length - 1])
}

const normalizeEmail = (email) => String(email ?? '').trim().normalize('NFC').toLowerCase()

// A name to show beside an address, safe to put in a header later: no
// control character, none of < > " \ (that would close or quote it), one
// space between words, MAX_DISPLAY_NAME_LENGTH at most. A name holding an
// @ is dropped (« boss@univ.fr » over somebody else's address is how a
// mail pretends to be from someone), as is one that only repeats the
// address.
export function sanitizeDisplayName(name, email = '') {
  const text = capLength(
    String(name ?? '').normalize('NFC').replace(CONTROL_CHARACTERS, ' ').replace(/[<>"\\]/g, ' ').replace(/\s+/g, ' ').trim(),
    MAX_DISPLAY_NAME_LENGTH,
  ).trim()
  if (!text || text.includes('@') || text.toLowerCase() === normalizeEmail(email)) return ''
  return text
}

// What an invalid token shows: the text as typed, made inert the same way.
function sanitizeInvalidText(text) {
  return capLength(String(text ?? '').normalize('NFC').replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim(), MAX_ADDRESS_LENGTH).trim()
}

// A recipient as the fields hold it: { name, email } when the address is
// valid, { name: '', email: <the text>, invalid: true } when it isn't.
export function normalizeRecipient(address) {
  const email = String(address?.email ?? '').trim().normalize('NFC')
  if (!address?.invalid && isValidAddress(email)) return { name: sanitizeDisplayName(address?.name, email), email }
  const text = sanitizeInvalidText(address?.email)
  return text ? { name: '', email: text, invalid: true } : null
}

// One token's identity: its address whatever the case (an invalid one's text).
export const recipientKey = (address) => normalizeEmail(address?.email)

// What's typed or pasted, cut into pieces at commas, semicolons and line
// breaks, but not inside "a quoted name" or <an address>. A line break
// always cuts (and ends a quote left open): no piece ever holds one.
function splitRecipientText(text) {
  const pieces = []
  let current = ''
  let quoted = false
  let angled = false
  let escaped = false
  for (const char of text) {
    if (char === '\n' || char === '\r') {
      pieces.push(current)
      current = ''
      quoted = false
      angled = false
      continue
    }
    if (escaped) escaped = false
    else if (quoted && char === '\\') escaped = true
    else if (char === '"' && !angled) quoted = !quoted
    else if (char === '<' && !quoted) angled = true
    else if (char === '>' && !quoted) angled = false
    else if ((char === ',' || char === ';') && !quoted && !angled) {
      pieces.push(current)
      current = ''
      continue
    }
    current += char
  }
  pieces.push(current)
  return pieces
}

const stripMailto = (text) => text.replace(/^mailto:/i, '')

// A quoted name loses its quotes and its escapes (« \" » is a quote).
function unquoteName(name) {
  const trimmed = name.trim()
  const inner = /^"[\s\S]*"$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed.replace(/^'(.*)'$/, '$1')
  return inner.replace(/\\(.)/g, '$1')
}

// One piece: « Camille Martin <camille@univ.fr> », « "Martin, Camille"
// <…> », « <camille@univ.fr> », « camille@univ.fr (Camille Martin) », a
// bare address, a mailto: link; several bare addresses split by spaces are
// several recipients.
function parseRecipientPiece(piece) {
  const trimmed = piece.trim()
  if (!trimmed) return []
  const named = trimmed.match(/^([\s\S]*?)<([^<>]*)>$/)
  if (named) {
    const email = stripMailto(named[2].trim())
    return [isValidAddress(email) ? { name: sanitizeDisplayName(unquoteName(named[1]), email), email } : { email: trimmed, invalid: true }]
  }
  const commented = trimmed.match(/^(\S+@\S+)\s*\(([^()]*)\)$/)
  if (commented && isValidAddress(stripMailto(commented[1]))) {
    const email = stripMailto(commented[1])
    return [{ name: sanitizeDisplayName(commented[2], email), email }]
  }
  const words = trimmed.split(/\s+/).map(stripMailto)
  if (words.length > 1 && words.every((word) => isValidAddress(word))) return words.map((email) => ({ name: '', email }))
  const email = stripMailto(trimmed)
  return [isValidAddress(email) ? { name: '', email } : { email: trimmed, invalid: true }]
}

// What the student typed or pasted in À, Cc or Cci, as tokens (valid or
// not, see normalizeRecipient), in order. Read up to
// MAX_RECIPIENT_TEXT_LENGTH characters.
export function parseRecipientText(text) {
  const source = String(text ?? '').slice(0, MAX_RECIPIENT_TEXT_LENGTH)
  return splitRecipientText(source).flatMap(parseRecipientPiece).map(normalizeRecipient).filter(Boolean)
}

// The same as it's being typed (or pasted into the field): what comes
// before the last comma, semicolon or line break becomes tokens, what comes
// after stays in the field (`rest`), still being written. Text without one
// (a comma inside "a quoted name" isn't one) is left as it is.
export function parseTypedRecipients(text) {
  const source = String(text ?? '').slice(0, MAX_RECIPIENT_TEXT_LENGTH)
  const pieces = splitRecipientText(source)
  if (pieces.length < 2) return { recipients: [], rest: source }
  return {
    recipients: pieces.slice(0, -1).flatMap(parseRecipientPiece).map(normalizeRecipient).filter(Boolean),
    rest: pieces[pieces.length - 1].trimStart(),
  }
}

// Tokens added to a field, once each (by address, whatever its case), and
// never one already in `exclude` (the other fields'); MAX_RECIPIENTS in all
// the fields at most, past which what's added is left out.
export function mergeAddresses(current, added, exclude = []) {
  const seen = new Set([...current, ...exclude].map(recipientKey))
  const merged = [...current]
  let room = MAX_RECIPIENTS - current.length - exclude.length
  for (const raw of added) {
    if (room <= 0) break
    const address = normalizeRecipient(raw)
    const key = recipientKey(address)
    if (!address || seen.has(key)) continue
    seen.add(key)
    merged.push(address)
    room -= 1
  }
  return merged
}

// A token as text again (a double click edits it): « Camille Martin
// <camille@univ.fr> », the name quoted when it holds a comma or a
// semicolon so parseRecipientText reads it back whole.
export function formatRecipient(address) {
  if (!address) return ''
  if (address.invalid || !address.name) return address.email
  const name = /[,;]/.test(address.name) ? `"${address.name}"` : address.name
  return `${name} <${address.email}>`
}

// ── Suggestions (the composer's autocomplete, server/mailAutocomplete.js) ──

// What a field's text is searched for: letters, digits and @ . _ + ' -
// only (no wildcard or operator ever reaches the webmail's directory), one
// space between words, RECIPIENT_QUERY_MAX_LENGTH at most. Under
// RECIPIENT_QUERY_MIN_LENGTH characters, nothing is asked.
export const RECIPIENT_QUERY_MIN_LENGTH = 2
export const RECIPIENT_QUERY_MAX_LENGTH = 64
export const MAX_RECIPIENT_SUGGESTIONS = 12
const RECIPIENT_KINDS = new Set(['contact', 'recent', 'directory', 'group'])

export function normalizeRecipientQuery(text) {
  if (typeof text !== 'string') return ''
  return capLength(
    text.slice(0, 256).normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[^\p{L}\p{M}\p{N}@._+'-]+/gu, ' ').replace(/\s+/g, ' ').trim(),
    RECIPIENT_QUERY_MAX_LENGTH,
  ).trim()
}

// Lowercased, without accents, char by char: `map[i]` is where the folded
// text's i-th character starts in the original (and `map[folded.length]`
// its end), to show a match found in the folded text on the original.
function foldWithMap(text) {
  let folded = ''
  const map = []
  let offset = 0
  for (const char of String(text ?? '')) {
    const piece = char.normalize('NFD').replace(/\p{M}/gu, '').replace(/[‘’ʼ]/g, "'").toLowerCase()
    for (let index = 0; index < piece.length; index += 1) map.push(offset)
    folded += piece
    offset += char.length
  }
  map.push(offset)
  return { folded, map }
}

const isWordCharacter = (char) => /[\p{L}\p{N}]/u.test(char ?? '')

// Where each word of `query` starts a word of `folded` (at its start, or
// after a space, a dot, an @…): [start, end) ranges, or null when a word
// starts none.
function findWordStarts(folded, query) {
  const words = foldWithMap(query).folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (!words.length) return null
  const ranges = []
  for (const word of words) {
    let found = -1
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
      const taken = ranges.some(([start, end]) => at < end && at + word.length > start)
      if (!taken && !isWordCharacter(folded[at - 1])) {
        found = at
        break
      }
    }
    if (found === -1) return null
    ranges.push([found, found + word.length])
  }
  return ranges.sort((a, b) => a[0] - b[0])
}

// `text` cut into [{ text, match }] pieces, the parts the query's words
// start marked (accents and case aside), for a suggestion to show them in
// bold. All of it unmarked when they don't all match.
export function highlightRecipientMatch(text, query) {
  const source = String(text ?? '')
  const { folded, map } = foldWithMap(source)
  const ranges = findWordStarts(folded, query)
  if (!source || !ranges) return source ? [{ text: source, match: false }] : []
  const pieces = []
  let cursor = 0
  for (const [start, end] of ranges) {
    const from = map[start]
    const to = map[end]
    if (from > cursor) pieces.push({ text: source.slice(cursor, from), match: false })
    if (to > from) pieces.push({ text: source.slice(from, to), match: true })
    cursor = Math.max(cursor, to)
  }
  if (cursor < source.length) pieces.push({ text: source.slice(cursor), match: false })
  return pieces
}

// Whether every word of `query` starts a word of the name or the address
// (« cam mar » finds Camille Martin, « lannion » scolarite-iut-lannion@…).
export function matchesRecipientQuery(suggestion, query) {
  const { folded } = foldWithMap(`${suggestion?.name ?? ''} ${suggestion?.email ?? ''}`)
  return Boolean(findWordStarts(folded, query))
}

// Suggestions as the composer may show them, whoever made them (the
// server's answer is checked again here): a valid address, a safe name, a
// known kind ('contact', 'recent', 'directory' or 'group'), once each, in
// order, MAX_RECIPIENT_SUGGESTIONS at most.
export function cleanRecipientSuggestions(list, limit = MAX_RECIPIENT_SUGGESTIONS) {
  const seen = new Set()
  const result = []
  for (const entry of Array.isArray(list) ? list : []) {
    if (result.length >= limit) break
    const email = typeof entry?.email === 'string' ? entry.email.trim().normalize('NFC') : ''
    const key = normalizeEmail(email)
    if (!isValidAddress(email) || seen.has(key)) continue
    seen.add(key)
    result.push({
      name: sanitizeDisplayName(typeof entry.name === 'string' ? entry.name : '', email),
      email,
      kind: RECIPIENT_KINDS.has(entry.kind) ? entry.kind : 'contact',
    })
  }
  return result
}

// « Re: » once: a reply to a reply keeps its subject. « Fwd: » the same way
// (« Tr: » is what French clients put, read as one too).
export function prefixSubject(subject, kind) {
  const text = String(subject ?? '').trim()
  if (kind === 'forward') return /^(fwd?|tr)\s*:/i.test(text) ? text : `Fwd: ${text}`.trim()
  return /^(re|ré)\s*:/i.test(text) ? text : `Re: ${text}`.trim()
}

const quoteDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' })

function addressLabel(address) {
  const name = address?.name?.trim() || ''
  const email = address?.email?.trim() || ''
  if (name && email && name !== email) return `${name} <${email}>`
  return name || email
}

// The line over the quoted mail, as Apple Mail writes it in French: « Le
// 12 octobre 2026 à 15:15, Camille Martin <camille@univ.fr> a écrit : ».
// A forward opens with the original's headers instead.
export function quoteHeader(message, kind) {
  const date = message?.receivedAt ? new Date(message.receivedAt) : null
  const when = date && !Number.isNaN(date.getTime()) ? quoteDateFormatter.format(date) : null
  if (kind === 'forward') {
    return [
      'Début du message réexpédié :',
      message?.from ? `De : ${addressLabel(message.from)}` : null,
      `Objet : ${message?.subject?.trim() || '(Sans objet)'}`,
      when ? `Date : ${when}` : null,
      message?.to?.length ? `À : ${message.to.map(addressLabel).join(', ')}` : null,
    ].filter(Boolean).join('\n')
  }
  const who = addressLabel(message?.from) || 'L’expéditeur'
  return when ? `Le ${when}, ${who} a écrit :` : `${who} a écrit :`
}

// The fields a new draft opens with. `kind`: 'new', 'reply', 'reply-all'
// or 'forward'; `message` the mail answered (the thread's newest), as
// getMailMessage gives it; `ownEmail` the student's address, never among
// the recipients of a « Répondre à tous ». A reply to one's own mail (from
// the Sent folder) goes to its recipients rather than back to oneself.
export function buildDraftFields(kind, message, ownEmail = '') {
  if (kind === 'new' || !message) return { to: [], cc: [], subject: '', attachments: [] }
  const own = normalizeEmail(ownEmail)
  const isOwn = (address) => Boolean(own) && normalizeEmail(address?.email) === own
  const withEmail = (list) => (list ?? []).filter((address) => isValidAddress(address?.email))
  if (kind === 'forward') {
    // Its attachments go along, by reference (messageAttachmentItems): they're
    // in the mailbox already, nothing is uploaded again. A reply has none,
    // as in Apple Mail (the composer can add them back).
    return { to: [], cc: [], subject: prefixSubject(message.subject, 'forward'), attachments: messageAttachmentItems(message) }
  }
  const author = message.replyTo?.email ? message.replyTo : message.from
  const fromSelf = isOwn(author)
  const primary = fromSelf ? withEmail(message.to) : withEmail([author])
  let to = mergeAddresses([], primary)
  let cc = []
  if (kind === 'reply-all') {
    to = mergeAddresses([], [...primary, ...withEmail(message.to)].filter((address) => !isOwn(address)))
    cc = mergeAddresses([], withEmail(message.cc).filter((address) => !isOwn(address)), to)
  }
  return { to, cc, subject: prefixSubject(message.subject, 'reply'), attachments: [] }
}

// Text pulled out of a mail's html, tidied: no run of more than one empty
// line, no blank edges.
export function tidyQuotedText(text) {
  return String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
