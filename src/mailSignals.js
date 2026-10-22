// Announcements in the student's mails Tafac can act on: the site blocked or
// closed, a strike, a class cancelled, postponed or moved to another room.
// Local rules on the subject and the preview (nothing leaves Tafac), as
// French university mails word them. Pure, see tests/mailSignals.test.js.
// shortcut: keyword rules miss unusual wordings and only read the 280-char
// preview; upgrade to the message body if announcements slip through.

import { addDays, daysBetween, toDayKey, weekdayIndex } from './planningDates.js'

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

const CLASS_WORDS = /\b(cours|td|tp|cm|seances?|ds|examens?|controles?|partiels?|soutenances?|evaluations?|entrainements?|creneaux?|activites?|sports?|matchs?)\b/
const CANCEL_WORDS = /\b(annulee?s?|annulation|n'aura pas lieu|ne sera pas assuree?|supprimee?s?|pas de (cours|td|tp|seance|entrainement|sport|match))\b/
const CLOSURE_WORDS = '(bloquee?s?|blocage|fermee?s?|fermeture|inaccessibles?|evacuee?s?|evacuation)'
const PLACE_WORDS = '(iut|enssat|batiments?|locaux|campus|ecole|universite|etablissement)'
// A closure names the place next to the word ("l'IUT sera fermé", "fermeture
// du bâtiment"), within a few words: a gym closed in a sports mail that
// mentions the campus further on isn't one. "Blocus" is one by itself.
const NEAR = '(?:\\W+\\w+){0,6}?\\W+'
const CLOSURE_NEAR_PLACE = new RegExp(`\\b${CLOSURE_WORDS}\\b${NEAR}${PLACE_WORDS}\\b|\\b${PLACE_WORDS}\\b${NEAR}${CLOSURE_WORDS}\\b`)

// First match wins: a class cancelled because the site is blocked is a
// closure.
const RULES = [
  { kind: 'closure', test: (text) => /\bblocus\b/.test(text) || CLOSURE_NEAR_PLACE.test(text) },
  { kind: 'strike', test: (text) => /\b(greve|mouvement social|preavis)\b/.test(text) },
  { kind: 'cancelled', test: (text) => CANCEL_WORDS.test(text) && CLASS_WORDS.test(text) },
  { kind: 'postponed', test: (text) => /\b(reportee?s?|report|decalee?s?|reprogrammee?s?)\b/.test(text) && CLASS_WORDS.test(text) },
  { kind: 'room', test: (text) => /\b(changement de salle|change de salle|nouvelle salle|salle modifiee|deplacee?s? (en|dans la) salle|aura lieu en salle|se tiendra en salle)\b/.test(text) },
]

export const SIGNAL_LABELS = {
  closure: 'Site bloqué ou fermé',
  strike: 'Grève annoncée',
  cancelled: 'Cours annulé',
  postponed: 'Report annoncé',
  room: 'Changement de salle',
  related: 'Annonce liée au blocus',
}

// A signal's title, its cause when the mail gives one: "Cours annulé
// (blocus)", "Annonce liée à la fermeture".
export function signalTitle(signal) {
  if (signal.kind === 'related') return signal.cause === 'blocus' ? SIGNAL_LABELS.related : 'Annonce liée à la fermeture'
  return signal.cause ? `${SIGNAL_LABELS[signal.kind]} (${signal.cause})` : SIGNAL_LABELS[signal.kind]
}

// Lowercase, without accents, every space (the non-breaking ones French
// mails put in "23 octobre" too) a plain one.
export function normalizeText(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ')
}

// "23 octobre" is this year's, or next year's when it's long past (a mail
// from December about January).
function dayFromParts(day, monthIndex, year, receivedKey) {
  const receivedYear = Number(receivedKey.slice(0, 4))
  let fullYear = year ? (year < 100 ? 2000 + year : year) : receivedYear
  let key = toDayKey(new Date(fullYear, monthIndex, day))
  if (!year && daysBetween(receivedKey, key) < -180) {
    fullYear += 1
    key = toDayKey(new Date(fullYear, monthIndex, day))
  }
  return key
}

// The days a mail is about, as "YYYY-MM-DD", from `receivedKey`'s point of
// view: explicit dates ("23 octobre", "23/10", "du 23 au 25 octobre"),
// "aujourd'hui", "demain", or a weekday ("ce mardi": the next one).
export function extractDays(text, receivedKey) {
  const days = new Set()
  const monthPattern = MONTHS.join('|')

  for (const match of text.matchAll(new RegExp(`\\bdu (\\d{1,2})(?:er)? au (\\d{1,2})(?:er)? (${monthPattern})(?: (\\d{4}))?`, 'g'))) {
    const month = MONTHS.indexOf(match[3])
    const first = dayFromParts(Number(match[1]), month, Number(match[4]) || null, receivedKey)
    const span = Math.min(Math.max(Number(match[2]) - Number(match[1]), 0), 14)
    for (let offset = 0; offset <= span; offset += 1) days.add(addDays(first, offset))
  }
  for (const match of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)? (${monthPattern})(?: (\\d{4}))?`, 'g'))) {
    days.add(dayFromParts(Number(match[1]), MONTHS.indexOf(match[2]), Number(match[3]) || null, receivedKey))
  }
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const month = Number(match[2]) - 1
    if (month >= 0 && month < 12) days.add(dayFromParts(Number(match[1]), month, Number(match[3]) || null, receivedKey))
  }
  if (/\b(aujourd'hui|ce jour|ce matin|cet apres-midi|ce soir)\b/.test(text)) days.add(receivedKey)
  if (/\bapres-demain\b/.test(text)) days.add(addDays(receivedKey, 2))
  else if (/\bdemain\b/.test(text)) days.add(addDays(receivedKey, 1))
  if (days.size === 0) {
    WEEKDAYS.forEach((weekday, index) => {
      if (new RegExp(`\\b${weekday}\\b`).test(text)) {
        days.add(addDays(receivedKey, (index - weekdayIndex(receivedKey) + 7) % 7))
      }
    })
  }
  return [...days].sort()
}

// Which sites the mail names: 'iut', 'enssat', or 'campus' (all of them).
function extractSites(text) {
  return [
    /\biut\b/.test(text) ? 'iut' : null,
    /\benssat\b/.test(text) ? 'enssat' : null,
    /\b(campus|universite)\b/.test(text) ? 'campus' : null,
  ].filter(Boolean)
}

// The room a class moves to: "nouvelle salle : A101", "en salle B-204".
function extractRoom(subject, snippet) {
  const matches = [...`${subject} ${snippet}`.matchAll(/\bsalle\s*:?\s*([A-Za-z]{0,3}[\s-]?\d{1,4}[A-Za-z]?)\b/gi)]
  return matches.length ? matches.at(-1)[1].trim().toUpperCase() : null
}

// `messages`: the inbox ({ id, subject, snippet, receivedAt, href }).
export function detectMailSignals(messages = []) {
  const signals = []
  for (const message of messages) {
    const subject = String(message?.subject ?? '')
    const snippet = String(message?.snippet ?? '')
    const text = normalizeText(`${subject} ${snippet}`)
    let rule = RULES.find(({ test }) => test(text))
    if (!rule) continue
    // The blockade only in the body, its subject about something else
    // ("[Volley-ball Mardi…]", "urgent … rendu du TD noté R5C10"): not the
    // site's closure but a consequence of it, cancelled, postponed or moved
    // when the mail says so, else an announcement related to it.
    if (rule.kind === 'closure' && !RULES[0].test(normalizeText(subject))) {
      rule = RULES.slice(2).find(({ test }) => test(text)) ?? { kind: 'related' }
    }
    const receivedAt = Date.parse(message.receivedAt)
    const receivedKey = toDayKey(Number.isFinite(receivedAt) ? receivedAt : Date.now())
    signals.push({
      id: String(message.id ?? `${rule.kind}-${receivedKey}-${subject}`),
      kind: rule.kind,
      // Why, when the mail says: 'blocus' or 'grève'.
      cause: rule.kind === 'closure' || rule.kind === 'strike' ? null
        : /\b(blocus|bloquee?s?|blocage)\b/.test(text) ? 'blocus'
          : /\bgreve\b/.test(text) ? 'grève' : null,
      days: extractDays(text, receivedKey),
      sites: extractSites(text),
      room: rule.kind === 'room' ? extractRoom(subject, snippet) : null,
      text,
      subject,
      from: message.from?.name || message.from?.email || null,
      receivedKey,
      href: message.href ?? null,
    })
  }
  return signals
}

// Whether a signal about `sites` concerns a student of `establishment`
// ('iutlan' is an IUT): a mail naming no site concerns everyone who got it.
export function concernsEstablishment(signal, establishment) {
  if (signal.sites.length === 0 || signal.sites.includes('campus')) return true
  const id = String(establishment ?? '')
  return signal.sites.some((site) => id.startsWith(site))
}

// Whether the mail names this class: its code ("R5.C.11"), its title, or
// its teacher's surname.
function namesClass(text, event) {
  const title = normalizeText(event.title)
  // Compared without dots: a mail writes "R5C10" for "R5.C.10".
  const code = title.match(/\b[rs]\d\.[a-z0-9.]+/)?.[0]?.replace(/\.+$/, '').replace(/\./g, '')
  if (code && code.length >= 4 && new RegExp(`\\b${code}\\b`).test(text.replace(/\./g, ''))) return true
  const name = title.replace(/\b[rs]\d\.[a-z0-9.]+/, '').replace(/\b(cm|td|tp)\b/g, '').trim()
  if (name.length >= 4 && text.includes(name)) return true
  const surname = normalizeText(event.teacher).split(/[\s,]+/).find((part) => part.length >= 3)
  return Boolean(surname) && new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
}

const EVENT_LABELS = {
  closure: 'Site bloqué ou fermé ce jour (mail)',
  strike: 'Grève annoncée ce jour (mail)',
  cancelled: 'Annoncé annulé par mail',
  postponed: 'Annoncé reporté par mail',
}

// What the mails say about a class ({ kind, label, signal }), or null.
// Site-wide news needs the day; news about a class, its day and its name.
export function noticeForEvent(signals, event, establishment) {
  for (const signal of signals) {
    if (!signal.days.includes(event.day)) continue
    const siteWide = signal.kind === 'closure' || signal.kind === 'strike'
    if (siteWide ? !concernsEstablishment(signal, establishment) : !namesClass(signal.text, event)) continue
    const because = signal.cause ? ` (${signal.cause})` : ''
    const label = signal.kind === 'room'
      ? (signal.room ? `Salle changée : ${signal.room} (mail)` : 'Changement de salle annoncé par mail')
      : signal.kind === 'related' ? `${signalTitle(signal)} (mail)` : `${EVENT_LABELS[signal.kind]}${because}`
    return { kind: signal.kind, label, signal }
  }
  return null
}

// A subject's core, the same across a thread: without "Re:", "Tr:",
// "Fwd:", list tags ("[iutlan-2627]") or "confirmation :"-like prefixes.
export function subjectCore(subject) {
  let core = normalizeText(subject).trim()
  for (let previous = ''; previous !== core;) {
    previous = core
    core = core
      .replace(/^\[[^\]]*\]\s*/, '')
      .replace(/^(re|tr|fw|fwd|aw|rappel|confirmation|important|urgent|info|maj|mise a jour)\s*(\(\d+\))?\s*:\s*/, '')
      .trim()
  }
  return core
}

// The other signals, one group per kind and thread (subjectCore, one
// starting with the other's: a reply that adds a word). `days`: all of
// theirs; `signals`: newest mail first, as the inbox lists them.
export function groupByThread(signals) {
  const groups = []
  for (const signal of signals) {
    const core = subjectCore(signal.subject)
    const group = groups.find((candidate) => candidate.kind === signal.kind
      && core && (candidate.core.startsWith(core) || core.startsWith(candidate.core)))
    if (group) {
      group.signals.push(signal)
      group.days = [...new Set([...group.days, ...signal.days])].sort()
    } else {
      groups.push({ kind: signal.kind, core, days: [...signal.days], signals: [signal] })
    }
  }
  return groups
}

// The site-wide signals (closure, strike) concerning the student, one group
// per kind: the same blockade announced day after day in several mails is
// one notice. `days`: all their days, in order; `signals`: newest mail first.
export function groupSiteSignals(signals, establishment) {
  const groups = new Map()
  for (const signal of signals) {
    if ((signal.kind !== 'closure' && signal.kind !== 'strike') || !concernsEstablishment(signal, establishment)) continue
    const group = groups.get(signal.kind) ?? { kind: signal.kind, days: [], signals: [] }
    group.signals.push(signal)
    group.days = [...new Set([...group.days, ...signal.days])].sort()
    groups.set(signal.kind, group)
  }
  for (const group of groups.values()) {
    group.signals.sort((left, right) => (left.receivedKey < right.receivedKey ? 1 : -1))
  }
  return [...groups.values()]
}

// The signals worth a card on the dashboard: about today or later, or
// undated and received in the last two days; site-wide ones only for the
// student's site.
export function dashboardSignals(signals, establishment, todayKey) {
  return signals.filter((signal) => {
    if ((signal.kind === 'closure' || signal.kind === 'strike') && !concernsEstablishment(signal, establishment)) return false
    if (signal.days.length) return signal.days.at(-1) >= todayKey
    return daysBetween(signal.receivedKey, todayKey) <= 2
  })
}
