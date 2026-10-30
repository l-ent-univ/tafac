// A class's teachers as recipients (« Écrire au sujet de ce cours », the
// trombone's « Un cours… »): the planning names them (ADE's « M. Lemoine »,
// « LEMOINE Thomas », TEMPO's « Martin C. », several joined by « - »), never
// with an address. Each name is looked up in the composer's own recipient
// suggestions (GET /mail/autocomplete: the student's contacts, past
// correspondents and the directory), client side only: the name is never
// logged nor kept. An address is never guessed:
// - one teacher, one suggestion matching every piece of the name (its
//   surname and its first name or initial), with the name sure of itself
//   (a civility, a first name or an initial along with the surname) and
//   the suggestions not cut short: À is filled with it;
// - otherwise the matching suggestions are offered under À, to add with
//   one click (one or all), and nothing else is shown.
// Pure but for lookupTeacherRecipients (its `search` given), see
// tests/teacherRecipients.test.js.

import { MAX_RECIPIENT_SUGGESTIONS, RECIPIENT_QUERY_MIN_LENGTH, normalizeRecipientQuery } from './mailCompose.js'

// At most this many teachers looked up for a class.
export const MAX_TEACHERS = 3
const CIVILITY = /^(?:m|mr|mme|mmes|mlle|melle|dr|pr|prof|monsieur|madame|mademoiselle|docteur|professeur)\.?$/i
// « C. », « C », « J.-P. ».
const INITIALS = /^\p{L}\.?$|^(?:\p{L}\.-?)+$/u
// Between two teachers: « - » with spaces (« Ménard A. - Le Goff B. »), a
// line, a comma, a semicolon, « / », « & », « et ».
const SEPARATORS = /\s+-\s+|\s*[\n;,]\s*|\s+[/&]\s+|\s+et\s+/i

const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
// The words of a name, folded, without hyphens or apostrophes (« Le-Gall »,
// « d'Arc »).
const nameWords = (text) => fold(text).split(/[^\p{L}]+/u).filter(Boolean)
const isUpperWord = (word) => /\p{L}{2,}/u.test(word) && word === word.toLocaleUpperCase('fr') && word !== word.toLocaleLowerCase('fr')

// One teacher's name, read: `display` as the planning writes it,
// `surname` / `given` its words (folded), `initials` its first names'
// letters, `certain` whether it's more than a lone word (a civility, a
// first name or an initial beside the surname, or two words matched
// together: « Dupont Marie »), `queries` what to ask the suggestions for,
// best first. Null for what isn't a name (a group, an export date).
export function parseTeacherName(text) {
  const display = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!display || display.length > 80 || /[\d()@<>[\]]/.test(display)) return null
  const words = display.split(' ')
  let civility = false
  while (words.length && CIVILITY.test(words[0])) {
    words.shift()
    civility = true
  }
  if (!words.length || words.length > 5) return null
  const initials = words.filter((word) => INITIALS.test(word))
  const full = words.filter((word) => !initials.includes(word))
  if (!full.length) return null
  // « LEMOINE Thomas », « Thomas LEMOINE »: the capitals are the surname.
  const upper = full.filter(isUpperWord)
  let surname = full
  let given = []
  if (upper.length && upper.length < full.length) {
    surname = upper
    given = full.filter((word) => !upper.includes(word))
  }
  const ambiguous = !civility && !initials.length && !given.length && full.length > 1
  const queries = []
  const add = (query) => {
    const value = normalizeRecipientQuery(query)
    if (value.length >= RECIPIENT_QUERY_MIN_LENGTH && !queries.includes(value)) queries.push(value)
  }
  // The surname alone finds the most (a directory matches its start), the
  // rest is checked here; « Dupont Marie », which is which unknown: the
  // whole name, then its first word (ADE writes the surname first; with
  // its particle: « Le Fur Anne »).
  if (ambiguous) {
    add(full.join(' '))
    add(full[0].length <= 3 ? full.slice(0, 2).join(' ') : full[0])
  } else {
    add(surname.join(' '))
  }
  return {
    display,
    surname: surname.flatMap(nameWords),
    given: given.flatMap(nameWords),
    initials: initials.flatMap((word) => nameWords(word).map((part) => part[0])),
    certain: civility || initials.length > 0 || full.length > 1,
    queries,
  }
}

// The class's teachers (its `teacher`, as toPlanningEvent keeps it), once
// each, MAX_TEACHERS at most.
export function parseTeacherNames(text) {
  const seen = new Set()
  const teachers = []
  for (const part of String(text ?? '').split(SEPARATORS)) {
    const teacher = parseTeacherName(part)
    if (!teacher || seen.has(fold(teacher.display))) continue
    seen.add(fold(teacher.display))
    teachers.push(teacher)
    if (teachers.length >= MAX_TEACHERS) break
  }
  return teachers
}

// A student's address (« …@etudiant.univ-rennes.fr ») is never a teacher's.
export function isStudentAddress(email) {
  const domain = String(email ?? '').split('@')[1] ?? ''
  return /(?:^|\.)etu(?:diants?)?\./i.test(domain)
}

// Whether a suggestion ({ name, email, kind }) is this teacher: each word
// of the surname and of the first name is a word of its name (the
// address's when it has none), each initial starts one more, none counted
// twice. Never a mailing list, nor a student.
export function matchesTeacher(teacher, suggestion) {
  if (!teacher || !suggestion?.email || suggestion.kind === 'group' || isStudentAddress(suggestion.email)) return false
  const words = nameWords(suggestion.name)
  const remaining = words.length ? words : nameWords(String(suggestion.email).split('@')[0])
  for (const word of [...teacher.surname, ...teacher.given]) {
    const index = remaining.indexOf(word)
    if (index < 0) return false
    remaining.splice(index, 1)
  }
  for (const letter of teacher.initials) {
    const index = remaining.findIndex((word) => word.startsWith(letter))
    if (index < 0) return false
    remaining.splice(index, 1)
  }
  return true
}

// A teacher's suggestions, sorted out. `complete`: the answer wasn't cut
// at the server's limit (a common surname: a lone match among the first
// twelve isn't the only one). → { matches, confident }.
export function resolveTeacher(teacher, suggestions, { complete = true } = {}) {
  const matches = (Array.isArray(suggestions) ? suggestions : []).filter((suggestion) => matchesTeacher(teacher, suggestion))
  return { matches, confident: Boolean(teacher?.certain) && complete && matches.length === 1 }
}

// What the composer does with the class's teachers (`resolved`: [{
// teacher, matches, confident }], in the class's order): the teachers
// found, each with its matches (`suggestions`: [{ name, matches }], name
// as the planning writes it), and À's filling (`prefill`, one recipient)
// for one teacher found surely: the composer fills À with it while À is
// empty and nothing's typed there, else offers it as the others.
// `canAddAll`: several teachers, each with one match.
export function planTeacherRecipients(resolved) {
  const list = Array.isArray(resolved) ? resolved : []
  const suggestions = list
    .filter((entry) => entry.matches.length)
    .map((entry) => ({ name: entry.teacher.display, matches: entry.matches.map((match) => ({ name: match.name, email: match.email })) }))
  const prefill = list.length === 1 && list[0].confident ? suggestions[0].matches : []
  return { prefill, suggestions, canAddAll: suggestions.length > 1 && suggestions.every((entry) => entry.matches.length === 1) }
}

// A plan that only offers (a grade's module teachers: who teaches it
// didn't necessarily grade it, a SAÉ has several): its sure match too.
export function offerOnly(plan) {
  return { ...plan, prefill: [] }
}

// The class's teachers looked up (`search(query, { signal })`:
// getMailRecipientSuggestions), side by side, each by its queries in turn
// until one finds it. A failed lookup counts as none found.
// → planTeacherRecipients's answer.
export async function lookupTeacherRecipients(text, { search, signal } = {}) {
  const teachers = parseTeacherNames(text)
  const resolved = await Promise.all(teachers.map(async (teacher) => {
    for (const query of teacher.queries) {
      if (signal?.aborted) break
      const result = await search(query, { signal })
      if (result?.status !== 'ok') continue
      const found = resolveTeacher(teacher, result.suggestions, { complete: result.suggestions.length < MAX_RECIPIENT_SUGGESTIONS })
      if (found.matches.length) return { teacher, ...found }
    }
    return { teacher, matches: [], confident: false }
  }))
  return planTeacherRecipients(resolved)
}
