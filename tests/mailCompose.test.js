import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_RECIPIENTS,
  RECIPIENT_QUERY_MAX_LENGTH,
  buildDraftFields,
  cleanRecipientSuggestions,
  formatRecipient,
  highlightRecipientMatch,
  isValidAddress,
  matchesRecipientQuery,
  mergeAddresses,
  normalizeRecipientQuery,
  parseRecipientText,
  parseTypedRecipients,
  prefixSubject,
  sanitizeDisplayName,
  quoteHeader,
  tidyQuotedText,
} from '../src/mailCompose.js'

const ME = 'camille.martin@etudiant.univ.fr'
const message = {
  id: '512',
  subject: 'Partiel de lundi',
  from: { name: 'Prof Durand', email: 'durand@univ.fr' },
  replyTo: null,
  to: [{ name: 'Camille Martin', email: 'Camille.Martin@etudiant.univ.fr' }, { name: 'Léo', email: 'leo@etudiant.univ.fr' }],
  cc: [{ name: '', email: 'scol@univ.fr' }, { name: 'Moi', email: ME }],
  receivedAt: '2026-10-12T13:15:00.000Z',
  attachments: [{ part: '2', name: 'sujet.pdf', type: 'application/pdf', size: 1200 }],
}

test('addresses: bare or named, cut at commas, semicolons and line breaks', () => {
  assert.deepEqual(parseRecipientText('a@b.fr, Léo Petit <leo@univ.fr>; c@d.fr\nE <e@f.fr>'), [
    { name: '', email: 'a@b.fr' },
    { name: 'Léo Petit', email: 'leo@univ.fr' },
    { name: '', email: 'c@d.fr' },
    { name: 'E', email: 'e@f.fr' },
  ])
  assert.deepEqual(parseRecipientText('  '), [])
  assert.deepEqual(parseRecipientText(',, ;\n'), [])
})

test('what is not an address stays, as an invalid token', () => {
  assert.deepEqual(parseRecipientText('a@b.fr, pas une adresse, Camille <camille@>'), [
    { name: '', email: 'a@b.fr' },
    { name: '', email: 'pas une adresse', invalid: true },
    { name: '', email: 'Camille <camille@>', invalid: true },
  ])
})

test('quoted names keep their commas, mailto: links and comments are read', () => {
  assert.deepEqual(parseRecipientText('"Martin, Camille" <cm@univ.fr>, "Le \\"Prof\\"" <p@univ.fr>'), [
    { name: 'Martin, Camille', email: 'cm@univ.fr' },
    { name: 'Le Prof', email: 'p@univ.fr' },
  ])
  assert.deepEqual(parseRecipientText('mailto:scol@univ.fr, <bu@univ.fr>, eve@univ.fr (Eve L.)'), [
    { name: '', email: 'scol@univ.fr' },
    { name: '', email: 'bu@univ.fr' },
    { name: 'Eve L.', email: 'eve@univ.fr' },
  ])
  // Bare addresses split by spaces (a column pasted from a sheet).
  assert.deepEqual(parseRecipientText('a@b.fr  c@d.fr\te@f.fr').map((address) => address.email), ['a@b.fr', 'c@d.fr', 'e@f.fr'])
})

test('a pasted list keeps its unfinished end in the field', () => {
  assert.deepEqual(parseTypedRecipients('A <a@x.fr>, b@y.fr; cam'), {
    recipients: [{ name: 'A', email: 'a@x.fr' }, { name: '', email: 'b@y.fr' }],
    rest: 'cam',
  })
  assert.deepEqual(parseTypedRecipients('b@y.fr,'), { recipients: [{ name: '', email: 'b@y.fr' }], rest: '' })
  // A comma inside a quote being typed isn't a cut.
  assert.deepEqual(parseTypedRecipients('"Martin, Cam'), { recipients: [], rest: '"Martin, Cam' })
  assert.deepEqual(parseTypedRecipients('camille'), { recipients: [], rest: 'camille' })
})

test('addresses are held strictly: no header injection, sane lengths', () => {
  for (const valid of ['a@b.fr', 'prenom.nom@etudiant.univ-rennes.fr', "o'brien+td@univ.fr", 'élise@université.fr', 'x@xn--univ-9ra.fr']) {
    assert.equal(isValidAddress(valid), true, valid)
  }
  for (const invalid of [
    'a@b', 'a b@c.fr', 'a@b.c', '.a@b.fr', 'a.@b.fr', 'a..b@c.fr', 'a@-b.fr', 'a@b-.fr', 'a@b..fr', '@b.fr', 'a@',
    'a@b.fr\r\nBcc: x@y.fr', 'a\u0000@b.fr', 'a@b.fr‮', '"a"@b.fr', 'a<b@c.fr', 'a,b@c.fr', 'a;b@c.fr', 'a@[127.0.0.1]', 'a(b)@c.fr',
    `${'a'.repeat(65)}@b.fr`, `a@${'b'.repeat(250)}.fr`, `a@${'b'.repeat(64)}.fr`,
  ]) {
    assert.equal(isValidAddress(invalid), false, JSON.stringify(invalid))
  }
  // A line break always cuts: what follows can never ride along as a header.
  assert.deepEqual(parseRecipientText('Camille\r\nBcc: x@y.fr <a@b.fr>'), [
    { name: '', email: 'Camille', invalid: true },
    { name: '', email: 'a@b.fr' },
  ])
  const longest = parseRecipientText(`x${'y'.repeat(400)}`)[0]
  assert.equal(longest.invalid, true)
  assert.ok(longest.email.length <= 254)
})

test('display names are made inert', () => {
  assert.equal(sanitizeDisplayName('  Camille\t\u0000 "Cam"  <Martin>\\ '), 'Camille Cam Martin')
  assert.equal(sanitizeDisplayName('Camille\r\nBcc: x'), 'Camille Bcc: x')
  assert.equal(sanitizeDisplayName('‮elliMaC'), 'elliMaC')
  // A name holding an address (someone else's, pretending) is dropped, as one repeating it.
  assert.equal(sanitizeDisplayName('boss@univ.fr', 'evil@x.fr'), '')
  assert.equal(sanitizeDisplayName('A@B.fr', 'a@b.fr'), '')
  assert.equal(sanitizeDisplayName('x'.repeat(300)).length, MAX_DISPLAY_NAME_LENGTH)
  assert.deepEqual(parseRecipientText('"boss@univ.fr" <evil@x.fr>'), [{ name: '', email: 'evil@x.fr' }])
})

test('a token as text again reads back the same', () => {
  for (const address of [{ name: 'Martin, Camille', email: 'cm@univ.fr' }, { name: 'Léo', email: 'leo@univ.fr' }, { name: '', email: 'a@b.fr' }]) {
    assert.deepEqual(parseRecipientText(formatRecipient(address)), [address])
  }
  assert.equal(formatRecipient({ name: '', email: 'pas une adresse', invalid: true }), 'pas une adresse')
})

test('tokens are added once, whatever the case, and not when in the other field', () => {
  const merged = mergeAddresses([{ name: '', email: 'a@b.fr' }], [{ name: '', email: 'A@B.fr' }, { name: '', email: 'c@d.fr' }, { name: '', email: 'x@y.fr' }], [{ email: 'x@y.fr' }])
  assert.deepEqual(merged.map((address) => address.email), ['a@b.fr', 'c@d.fr'])
})

test('recipients are capped across the fields', () => {
  const many = Array.from({ length: 150 }, (_, index) => ({ name: '', email: `etu${index}@univ.fr` }))
  const other = [{ name: '', email: 'prof@univ.fr' }]
  const merged = mergeAddresses([], many, other)
  assert.equal(merged.length, MAX_RECIPIENTS - 1)
  // Names coming in are cleaned on the way, invalid ones kept as such.
  assert.deepEqual(mergeAddresses([], [{ name: 'A <x>', email: ' a@b.fr ' }, { email: 'oops', invalid: true }]), [
    { name: 'A x', email: 'a@b.fr' },
    { name: '', email: 'oops', invalid: true },
  ])
})

test('the suggestions query keeps letters, digits and @ . _ + \' - only', () => {
  assert.equal(normalizeRecipientQuery('  Ca*mi(lle)\u0000  O’Brien  '), "Ca mi lle O'Brien")
  assert.equal(normalizeRecipientQuery('a@b.fr"; DROP'), 'a@b.fr DROP')
  assert.equal(normalizeRecipientQuery(['cam']), '')
  assert.equal(normalizeRecipientQuery(undefined), '')
  assert.equal(normalizeRecipientQuery('x'.repeat(1000)).length, RECIPIENT_QUERY_MAX_LENGTH)
})

test('a suggestion matches at word starts, accents and case aside', () => {
  const scolarite = { name: 'Scolarité IUT de Lannion', email: 'scolarite-iut-lannion@univ-rennes.fr' }
  assert.equal(matchesRecipientQuery(scolarite, 'lan sco'), true)
  assert.equal(matchesRecipientQuery(scolarite, 'SCOLARITE'), true)
  assert.equal(matchesRecipientQuery(scolarite, 'annion'), false)
  assert.equal(matchesRecipientQuery({ name: '', email: 'camille.martin@univ.fr' }, 'mart'), true)
  assert.deepEqual(highlightRecipientMatch('Élise Durand', 'eli du'), [
    { text: 'Éli', match: true },
    { text: 'se ', match: false },
    { text: 'Du', match: true },
    { text: 'rand', match: false },
  ])
  assert.deepEqual(highlightRecipientMatch('Élise Durand', 'zz'), [{ text: 'Élise Durand', match: false }])
  assert.deepEqual(highlightRecipientMatch('', 'a'), [])
})

test('suggestions are checked again before they are shown', () => {
  assert.deepEqual(cleanRecipientSuggestions([
    { name: 'Camille <x>', email: 'camille@univ.fr', kind: 'directory' },
    { name: 'Again', email: 'CAMILLE@univ.fr', kind: 'contact' },
    { name: 'Bad', email: 'bad\r\n@univ.fr' },
    { name: 'Odd kind', email: 'odd@univ.fr', kind: '<script>' },
    null,
    'text',
  ]), [
    { name: 'Camille x', email: 'camille@univ.fr', kind: 'directory' },
    { name: 'Odd kind', email: 'odd@univ.fr', kind: 'contact' },
  ])
  assert.equal(cleanRecipientSuggestions(Array.from({ length: 50 }, (_, index) => ({ email: `a${index}@b.fr` }))).length, 12)
  assert.deepEqual(cleanRecipientSuggestions({ email: 'a@b.fr' }), [])
})

test('subjects take one prefix', () => {
  assert.equal(prefixSubject('Partiel', 'reply'), 'Re: Partiel')
  assert.equal(prefixSubject('RE: Partiel', 'reply'), 'RE: Partiel')
  assert.equal(prefixSubject('Fwd: Partiel', 'forward'), 'Fwd: Partiel')
  assert.equal(prefixSubject('TR : Partiel', 'forward'), 'TR : Partiel')
  assert.equal(prefixSubject('', 'reply'), 'Re:')
})

test('a reply goes to the sender, or the reply-to address when there is one', () => {
  assert.deepEqual(buildDraftFields('reply', message, ME).to, [message.from])
  const withReplyTo = { ...message, replyTo: { name: 'Liste', email: 'liste@univ.fr' } }
  assert.deepEqual(buildDraftFields('reply', withReplyTo, ME).to.map((address) => address.email), ['liste@univ.fr'])
  assert.equal(buildDraftFields('reply', message, ME).subject, 'Re: Partiel de lundi')
})

test('reply all leaves the student out, Cc without what À already has', () => {
  const fields = buildDraftFields('reply-all', message, ME)
  assert.deepEqual(fields.to.map((address) => address.email), ['durand@univ.fr', 'leo@etudiant.univ.fr'])
  assert.deepEqual(fields.cc.map((address) => address.email), ['scol@univ.fr'])
})

test('a reply to one\'s own mail goes to its recipients', () => {
  const sent = { ...message, from: { name: 'Camille', email: ME }, to: [{ name: 'Léo', email: 'leo@etudiant.univ.fr' }] }
  assert.deepEqual(buildDraftFields('reply', sent, ME).to.map((address) => address.email), ['leo@etudiant.univ.fr'])
})

test('a forward starts with no recipient and lists the attachments', () => {
  const fields = buildDraftFields('forward', message, ME)
  assert.deepEqual(fields.to, [])
  assert.equal(fields.subject, 'Fwd: Partiel de lundi')
  assert.equal(fields.attachments.length, 1)
  assert.deepEqual(buildDraftFields('new', message, ME), { to: [], cc: [], subject: '', attachments: [] })
})

test('the quote header names the sender and the date', () => {
  assert.match(quoteHeader(message, 'reply'), /^Le 12 octobre 2026 à \d{2}:\d{2}, Prof Durand <durand@univ\.fr> a écrit :$/)
  assert.equal(quoteHeader({ from: { name: '', email: 'a@b.fr' } }, 'reply'), 'a@b.fr a écrit :')
  assert.match(quoteHeader(message, 'forward'), /^Début du message réexpédié :\nDe : Prof Durand <durand@univ\.fr>\nObjet : Partiel de lundi\n/)
})

test('quoted text loses runs of empty lines', () => {
  assert.equal(tidyQuotedText('\n\nBonjour,\u00a0 \n\n\n\nÀ lundi\n'), 'Bonjour,\n\nÀ lundi')
})
