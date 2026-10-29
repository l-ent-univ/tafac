// The composer's recipient suggestions (GET /__ent_auth/mail/autocomplete),
// read from Zimbra's AutoCompleteRequest. Kept apart from entAuthApp.js so
// they can be tested on their own (tests/mailAutocomplete.test.js); both
// universities' mail is Zimbra (RENATER Partage), so one shape serves them.
//
// AutoCompleteRequest (urn:zimbraMail) looks in the student's contacts, the
// addresses they wrote to or got mail from (Zimbra's ranking table) and the
// institution's directory (the GAL), in one request, best ranked first. Its
// answer: { match: [{ email: '"Camille Martin" <camille@univ.fr>', type:
// 'contact' | 'rankingTable' | 'gal', ranking, isGroup, full, first, last,
// display, id, l, … }], canBeCached }. Only a name, an address and a kind
// ever leave this module: no id, folder, ranking or anything else Zimbra
// says about the entry.

import {
  MAX_RECIPIENT_SUGGESTIONS,
  cleanRecipientSuggestions,
  matchesRecipientQuery,
  parseRecipientText,
} from '../src/mailCompose.js'

const ZIMBRA_KINDS = { contact: 'contact', rankingTable: 'recent', gal: 'directory' }
// An entry's `email` past this isn't one address (a contact group's
// expansion, or junk): left out unread.
const MAX_MATCH_EMAIL_LENGTH = 512

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : [])
const asText = (value) => (typeof value === 'string' ? value : '')
const isTrue = (value) => value === true || value === 1 || value === '1' || value === 'true'

// The request, fixed but for the text searched (normalizeRecipientQuery's,
// already cleaned): `t: 'account'` the directory's people and mailing
// lists, not its rooms and equipment; `includeGal` the directory along
// with the contacts.
export function buildZimbraAutoCompleteRequest(query) {
  return { name: query, t: 'account', includeGal: 1 }
}

// AutoCompleteResponse → [{ name, email, kind }], in Zimbra's order, once
// per address, `limit` at most. `kind`: 'contact', 'recent' (a past
// correspondent), 'directory' (the GAL) or 'group' (a mailing list). A
// contact group has no address of its own (only its members): left out.
export function normalizeZimbraAutoComplete(response, limit = MAX_RECIPIENT_SUGGESTIONS) {
  const candidates = []
  for (const match of asArray(response?.match)) {
    if (candidates.length >= limit * 2) break
    const raw = asText(match?.email)
    if (!raw || raw.length > MAX_MATCH_EMAIL_LENGTH) continue
    const parsed = parseRecipientText(raw)
    if (parsed.length !== 1 || parsed[0].invalid) continue
    const [address] = parsed
    const fullName = asText(match.full) || [asText(match.first), asText(match.last)].filter(Boolean).join(' ')
    candidates.push({
      name: address.name || fullName || asText(match.display),
      email: address.email,
      kind: isTrue(match.isGroup) ? 'group' : ZIMBRA_KINDS[match.type] ?? 'contact',
    })
  }
  return cleanRecipientSuggestions(candidates, limit)
}

// The demo account's address book: made-up people of the demo's mails
// (src/demoAccount.js) and a few more, so typing finds someone; the demo
// planning's teachers among them (« Écrire au sujet de ce cours »), two
// Le Fur for a teacher found twice.
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

// The demo's answer to a query: its contacts whose name or address a word
// of the query starts, as Zimbra matches.
export function searchDemoMailContacts(query, limit = MAX_RECIPIENT_SUGGESTIONS) {
  return cleanRecipientSuggestions(DEMO_MAIL_CONTACTS.filter((contact) => matchesRecipientQuery(contact, query)), limit)
}
