// A grade's possible teachers, from the timetable (« Écrire au sujet de
// cette note », « Une note… »): the relevé names no grader, but the
// module's classes in the planning (ADE's « R5.11 Développement Front »,
// a code in their titles) name who teaches it. Those names are only ever
// offered under À (src/teacherRecipients.js's lookup), never put there:
// who teaches a module didn't necessarily grade it, and a SAÉ has several.
// Pure, see tests/moduleTeachers.test.js.

import { addDays, startOfWeek } from './planningDates.js'
import { MAX_TEACHERS, parseTeacherNames } from './teacherRecipients.js'

// The classes looked through: the last three weeks and the next one.
export const MODULE_PAST_DAYS = 21
export const MODULE_AHEAD_DAYS = 7

// A module code as one string to compare: capitals, no accent, no
// separator (« R5.11 », « R511 », « r5-11 » → « R511 »; « SAÉ 3.01 »,
// « SAE3.01 » → « SAE301 »). Empty for what isn't one (letters then
// digits).
export function normalizeModuleCode(code) {
  const value = String(code ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[\s._-]+/g, '')
  return /^[A-Z]{1,4}\d[A-Z0-9]*$/.test(value) && /\d/.test(value) ? value : ''
}

// The codes a class's title carries, normalised: a word of a few letters
// then a digit, on to the next space (« R5.11 », « SAÉ 5.01 », « R5.A.11 »,
// « R511-TP » → « R511TP »).
export function titleModuleCodes(title) {
  const text = String(title ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  const codes = []
  for (const match of text.matchAll(/(?:^|[^\p{L}\p{N}])([A-Za-z]{1,4}\s?\d(?:[._-]?[A-Za-z0-9])*)/gu)) {
    const code = normalizeModuleCode(match[1])
    if (code) codes.push(code)
  }
  return codes
}

// Whether a title's code is the module's: the same, or it with a suffix
// that isn't a digit (« R511TP » is R5.11's, « R5110 » isn't, nor « R511 »
// R5.1's).
export function isModuleCode(titleCode, code) {
  return Boolean(code) && titleCode.startsWith(code) && !/\d/.test(titleCode.charAt(code.length))
}

// The Mondays of the weeks looked through (usePlanningWeeks' requests).
export function moduleWindowMondays(todayKey) {
  const last = addDays(todayKey, MODULE_AHEAD_DAYS)
  const mondays = []
  for (let monday = startOfWeek(addDays(todayKey, -MODULE_PAST_DAYS)); monday <= last; monday = addDays(monday, 7)) mondays.push(monday)
  return mondays
}

// The module's teachers as the planning names them (`events`:
// toPlanningEvent's), from its classes within the window: the most seen
// first, once each, MAX_TEACHERS at most. None without a code to match.
// → ['M. Lemoine', …].
export function findModuleTeacherNames(events, moduleCode, todayKey) {
  const code = normalizeModuleCode(moduleCode)
  if (!code) return []
  const from = addDays(todayKey, -MODULE_PAST_DAYS)
  const to = addDays(todayKey, MODULE_AHEAD_DAYS)
  const counts = new Map()
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.day || event.day < from || event.day > to || !titleModuleCodes(event.title).some((titleCode) => isModuleCode(titleCode, code))) continue
    for (const teacher of parseTeacherNames(event.teacher)) {
      const key = teacher.display.toLocaleLowerCase('fr')
      const known = counts.get(key)
      counts.set(key, { display: known?.display ?? teacher.display, count: (known?.count ?? 0) + 1, first: known?.first ?? event.start })
    }
  }
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.first - right.first)
    .slice(0, MAX_TEACHERS)
    .map((entry) => entry.display)
}

// The teachers of the class an absence covers (« Justifier » in
// « Assiduité », put in Cc): the planning's classes that day whose hours
// overlap the absence's (see `needed`) (`startHours`, `endHours`: 8.25 = 8h15), only
// those of its module when some carry its code (ADE's titles may not).
// Once each, MAX_TEACHERS at most. → ['M. Lemoine', …].
export function findClassTeacherNames(events, { day, startHours, endHours = null, moduleCode = null } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''))
  const start = Number(startHours)
  if (!match || !Number.isFinite(start)) return []
  const base = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
  // A lateness lasts minutes: a quarter of an hour at least, to meet its class.
  const end = Math.max(Number(endHours) || 0, start + 0.25)
  const from = base + start * 3600 * 1000
  const to = base + end * 3600 * 1000
  // Overlapping for real: ScoDoc's slot and ADE's may differ by a few
  // minutes (8h15–10h15 against the 10h00 class): at least half the
  // absence, 30 minutes at most.
  const needed = Math.min(to - from, 3600 * 1000) / 2
  const overlapping = (Array.isArray(events) ? events : [])
    .filter((event) => event?.day === day && event.teacher && Math.min(event.end, to) - Math.max(event.start, from) >= needed)
  const code = normalizeModuleCode(moduleCode)
  const ofModule = code ? overlapping.filter((event) => titleModuleCodes(event.title).some((titleCode) => isModuleCode(titleCode, code))) : []
  const names = new Map()
  for (const event of ofModule.length ? ofModule : overlapping) {
    for (const teacher of parseTeacherNames(event.teacher)) {
      const key = teacher.display.toLocaleLowerCase('fr')
      if (!names.has(key)) names.set(key, teacher.display)
    }
  }
  return [...names.values()].slice(0, MAX_TEACHERS)
}
