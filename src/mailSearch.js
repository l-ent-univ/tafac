// The mail page's search words, shared by the page (its local filter, and
// whether the server is asked at all) and the server (the Zimbra query, the
// demo account's search). Pure data (no browser or @university import), as
// evaluationDistribution.js: the server imports it from src/.
//
// How Zimbra (RENATER Partage) indexes text, from its sources
// (zm-mailbox store/…/index/analysis: UniversalAnalyzer, NormalizeTokenFilter,
// UniversalLexer.jflex):
// - every character goes through NormalizeTokenFilter first, which lowercases
//   and folds accents (é → e, ñ → n…), as Lucene's ASCIIFoldingFilter;
// - a word with straight apostrophes between letters is ONE token
//   (APOSTROPHE = ALPHA ("'" ALPHA)+: « l'examen » stays « l'examen », only a
//   trailing 's is cut). A typographic apostrophe (’, what most mail editors
//   write) isn't a letter: « l’examen » is two tokens, « l » and « examen ».
// - its query grammar (query/parser/Parser.jjt) reads a term as anything but
//   whitespace and { } : + - " ( ), and a term can't start with - or +.
// So each word is sent in the forms that can match those tokens (see
// getMailSearchVariants), each with a trailing * (a prefix: « mood » finds
// Moodle), and only letters, digits and @ . _ ' - ever reach the query.

export const MAIL_SEARCH_MAX_WORDS = 8
export const MAIL_SEARCH_MAX_WORD_LENGTH = 64
const MAIL_SEARCH_MAX_QUERY_LENGTH = 300

// ’ ‘ ʼ as the ' they stand for, on both sides of a comparison.
const APOSTROPHE_VARIANTS = /[‘’ʼ]/g
// Anything else splits words: « TD#2 », « (urgent) », « from:x »…
const WORD_SEPARATORS = /[^\p{L}\p{M}\p{N}@._'-]+/u
// What a word may not start or end with: a leading - is Zimbra's « not ».
const WORD_EDGES = /^[-.']+|[-.']+$/g
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu
// French elisions, dropped in front of an apostrophe: l', d', j', qu'…
const ELISIONS = new Set(['qu', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu'])
// A query term as Zimbra's grammar reads it, and nothing that could be an
// operator: no whitespace, : ( ) { } " + *, no leading -.
const SAFE_TERM = /^[\p{L}\p{M}\p{N}@._'][\p{L}\p{M}\p{N}@._'-]*$/u
const MAIL_FOLDER_ID = /^\d{1,9}$/

const countLettersAndDigits = (value) => (value.match(LETTER_OR_DIGIT) ?? []).length

// Lowercase, accents and apostrophe styles aside: « etude » finds « Étude »,
// « l'examen » finds « l’examen ». The page's local filter and the demo
// account's search compare words and mails folded this way.
export function foldMailSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .replace(APOSTROPHE_VARIANTS, "'")
    .toLowerCase()
}

// A word's parts between apostrophes, its leading elisions (one letter, or
// qu, jusqu…) left out: « l'examen » → ['examen'], « aujourd'hui » →
// ['aujourd', 'hui'], « qu'il » → ['il'].
function getMeaningfulParts(word) {
  const parts = word.split("'").filter(Boolean)
  while (parts.length > 1 && (countLettersAndDigits(parts[0]) <= 1 || ELISIONS.has(parts[0].toLowerCase()))) {
    parts.shift()
  }
  return parts
}

// The search field's text as search words: split on whitespace and on any
// punctuation but @ . _ ' - (an address, « TD-2 », « l'examen » stay whole),
// typographic apostrophes as straight ones. A word needs two letters or
// digits once its elision is left out: « a », « l' », « l'a » are dropped,
// so no single-letter prefix (a*, a scan of the whole index) is ever asked
// for. The page searches the server only when a word is left; a single
// character still filters the loaded list.
export function parseMailSearchWords(query) {
  return String(query ?? '')
    .slice(0, MAIL_SEARCH_MAX_QUERY_LENGTH)
    .normalize('NFC')
    .replace(APOSTROPHE_VARIANTS, "'")
    .split(WORD_SEPARATORS)
    .map((word) => word.replace(WORD_EDGES, '').slice(0, MAIL_SEARCH_MAX_WORD_LENGTH).replace(WORD_EDGES, ''))
    .filter((word) => countLettersAndDigits(getMeaningfulParts(word).join("'")) >= 2)
    .slice(0, MAIL_SEARCH_MAX_WORDS)
}

// The forms one word is looked for in, lowercase, any of them matching:
// - the word itself, apostrophes kept (« l'examen », one token in a mail
//   written with a straight apostrophe);
// - without its elision (« examen »: the token after a typographic one);
// - its first part (« aujourd » of « aujourd'hui », written either way);
// - each of these without accents too. Zimbra folds accents when it indexes
//   (NormalizeTokenFilter), but a prefix term may reach the index as typed,
//   so « étude* » alone could miss « Étude »: « etude* » can't.
// A form another one starts with is left out, the shorter prefix finding it
// already (« aujourd'hui » goes, « aujourd » stays).
export function getMailSearchVariants(word) {
  const lower = String(word ?? '').toLowerCase()
  const parts = getMeaningfulParts(lower)
  const forms = [lower, parts.join("'"), parts[0] ?? '']
    .flatMap((form) => [form, foldMailSearchText(form)])
    .filter((form) => countLettersAndDigits(form) >= 2 && SAFE_TERM.test(form))
  const unique = [...new Set(forms)]
  return unique.filter((form) => !unique.some((other) => other !== form && form.startsWith(other)))
}

// The Zimbra query for the words (parseMailSearchWords) in a folder (an id:
// 2 the inbox): every word needed, each found as a prefix in the sender,
// the recipients, the subject or the text, in any of its forms:
// inid:2 (from:examen* OR to:examen* OR … OR content:l'examen*) (…)
// The folder must be an id and every form passes SAFE_TERM, so nothing
// typed can become an operator, a field or a phrase.
export function buildZimbraSearchQuery(words, folder = '2') {
  const folderId = String(folder)
  if (!MAIL_FOLDER_ID.test(folderId)) {
    throw new TypeError('Invalid mail folder id.')
  }
  const groups = words
    .map(getMailSearchVariants)
    .filter((variants) => variants.length > 0)
    .map((variants) => `(${['from', 'to', 'subject', 'content']
      .flatMap((field) => variants.map((variant) => `${field}:${variant}*`))
      .join(' OR ')})`)
  return [`inid:${folderId}`, ...groups].join(' ')
}
