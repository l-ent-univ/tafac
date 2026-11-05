// « Justifier » (« Assiduité »): the mail the walkthrough writes from the
// student's answers (JustifyAbsenceSheet), for an absence or a lateness of
// buildAbsenceReport's. Pure, so the tests run it straight in Node.
//
// The mail: « Absence du mardi 6 octobre – Relations presse » as its
// subject (« Justificatif d’absence… » with the document attached);
// « Bonjour, », the sentence excusing the absence with its reason, the
// student's own words, what becomes of the justificatif, a line for the
// student to write on (the caret's), the summary box (what the page shows
// of the absence), « Bien cordialement, ». À is left for the
// secretariat, whose address isn't known: the student adds it. The
// absence's teacher in Cc (unless the student leaves them out): the
// address the passerelle names on the absence, else the composer looks
// the class up in the planning that day (`absenceClass`) and puts its
// teacher in Cc. An address is never guessed.

import { isValidAddress } from './mailCompose.js'
import { shortenMailText } from './mailAboutBlocks.js'
import { escapeHtml } from './mailText.js'
import { formatDuration } from './gradesReport.js'
import { parseDay } from './assiduity.js'

const MAX_SUBJECT_TITLE_LENGTH = 70
const MAX_DETAILS_LENGTH = 1200
const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const FULL_DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const ABSENCE_STATUS_LABELS = { unjustified: 'Non justifiée', justified: 'Justifiée', late: 'Retard' }

// The walkthrough's answers to « Pourquoi ? »: what the student picks, and
// how the mail says it. `late`: offered for a lateness too. `optional`:
// only where the establishment lists it (`absenceReasons` in its
// client.js › establishments.byId entry), before « Autre raison ».
export const ABSENCE_REASONS = [
  { id: 'illness', label: 'Maladie', icon: 'ph:thermometer', phrase: 'pour raison de santé', late: false },
  { id: 'medical', label: 'Rendez-vous médical', icon: 'ph:stethoscope', phrase: 'en raison d’un rendez-vous médical', late: true },
  // IUT de Lannion, the user's call (2026-11-03): no Université de Rennes
  // rule found for it then (Rennes 2 and Sciences Po Rennes have their own).
  { id: 'menstrual', label: 'Congé menstruel', icon: 'ph:drop', phrase: 'au titre du congé menstruel', late: false, optional: true },
  { id: 'transport', label: 'Transports', icon: 'ph:train', phrase: 'en raison d’un problème de transport', late: true },
  { id: 'family', label: 'Raison familiale', icon: 'ph:house-line', phrase: 'pour raison familiale', late: true },
  { id: 'summons', label: 'Convocation officielle', icon: 'ph:scroll', phrase: 'en raison d’une convocation officielle', late: false },
  { id: 'interview', label: 'Entretien de stage ou d’alternance', icon: 'ph:briefcase', phrase: 'en raison d’un entretien de stage ou d’alternance', late: true },
  // IUT de Lannion: a student may be away to demonstrate.
  { id: 'protest', label: 'Manifestation', icon: 'ph:megaphone', phrase: 'afin d’exercer mon droit de manifester', late: true, optional: true },
  { id: 'other', label: 'Autre raison', icon: 'ph:dots-three', phrase: null, late: true },
]

// The reasons offered for this absence (a lateness: fewer), with the
// optional ones the establishment lists (`extra`: their ids).
export function listAbsenceReasons(entry, extra = []) {
  const allowed = new Set(Array.isArray(extra) ? extra : [])
  return ABSENCE_REASONS.filter((reason) => (!reason.optional || allowed.has(reason.id))
    && (entry?.status !== 'late' || reason.late))
}

// What becomes of the justificatif: attached, sent later, none.
export const PROOF_CHOICES = ['attached', 'later', 'none']

const capitalize = (text) => (text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text)

// « mardi 6 octobre ».
export function formatAbsenceDay(entry) {
  const day = parseDay(entry?.date)
  return day ? DAY_FORMAT.format(day) : ''
}

// The teacher as the composer's recipient, when the absence names a valid
// address: { name, email } | null.
export function absenceTeacher(entry) {
  const email = String(entry?.teacherEmail ?? '').trim()
  return isValidAddress(email) ? { name: String(entry?.teacher ?? '').trim(), email } : null
}

// « Absence du mardi 6 octobre – Relations presse », « Retard du … »;
// « Justificatif d’absence du … » with the document attached.
export function buildJustificationSubject(entry, { proof = null } = {}) {
  const isLate = entry?.status === 'late'
  const kind = proof === 'attached'
    ? (isLate ? 'Justificatif de retard' : 'Justificatif d’absence')
    : (isLate ? 'Retard' : 'Absence')
  const day = formatAbsenceDay(entry)
  const subject = shortenMailText(entry?.subjectTitle ?? entry?.subject, MAX_SUBJECT_TITLE_LENGTH)
  return [`${kind}${day ? ` du ${day}` : ''}`, subject].filter(Boolean).join(' – ')
}

// What the page shows of the absence, as the summary box's rows.
export function buildAbsenceSummaryRows(entry) {
  const day = parseDay(entry?.date)
  const hasTimes = entry?.start && entry?.end
  const length = entry?.status !== 'late' && entry?.hours > 0 ? ` (${formatDuration(entry.hours)})` : ''
  return [
    { label: 'Matière', value: [entry?.moduleCode, entry?.subjectTitle ?? entry?.subject].filter(Boolean).join(' – ') },
    day ? { label: 'Date', value: capitalize(FULL_DAY_FORMAT.format(day)) } : null,
    hasTimes ? { label: 'Horaire', value: `${entry.start} – ${entry.end}${length}` } : null,
    entry?.teacher ? { label: 'Enseignant', value: entry.teacher } : null,
  ].filter((row) => row && row.value)
}

// « Je vous prie d’excuser mon absence du mardi 6 octobre, de 8h15 à 10h15,
// en Relations presse, pour raison de santé. »
export function describeJustification(entry, reasonId = null) {
  const kind = entry?.status === 'late' ? 'mon retard' : 'mon absence'
  const day = formatAbsenceDay(entry)
  const hours = entry?.start && entry?.end ? `, de ${entry.start} à ${entry.end}` : ''
  const subject = String(entry?.subjectTitle ?? entry?.subject ?? '').trim()
  const phrase = ABSENCE_REASONS.find((reason) => reason.id === reasonId)?.phrase
  return `Je vous prie d’excuser ${kind}${day ? ` du ${day}` : ''}${hours}${subject ? `, en ${subject}` : ''}${phrase ? `, ${phrase}` : ''}.`
}

const PROOF_LINES = {
  attached: 'Vous trouverez mon justificatif en pièce jointe.',
  later: 'Je vous ferai parvenir mon justificatif dès que possible.',
}

// The mail's paragraphs, as text: what the walkthrough previews and the
// editor's HTML is made of.
export function buildJustificationLines(entry, { reason = null, details = '', proof = null } = {}) {
  const words = String(details ?? '').trim().slice(0, MAX_DETAILS_LENGTH)
  return [
    'Bonjour,',
    describeJustification(entry, reason),
    words || null,
    PROOF_LINES[proof] ?? null,
  ].filter(Boolean)
}

// The editor's HTML (MailComposer's `restore.html`): the lines, an empty
// one for the student (`focusBlock`, the caret's), the summary box, the
// closing. → { html, focusBlock }.
export function buildJustificationHtml(entry, answers = {}) {
  const lines = buildJustificationLines(entry, answers)
  const rows = buildAbsenceSummaryRows(entry)
  const paragraphs = lines.map((line) => `<p>${escapeHtml(line).replace(/\n/g, '<br>')}</p>`)
  const summary = `<table data-mail-summary=""><tbody>${rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`).join('')}</tbody></table>`
  // « Bonjour, », an empty line, then the text: as the other prefilled mails.
  const blocks = [paragraphs[0], '<p></p>', ...paragraphs.slice(1), '<p></p>', summary, '<p>Bien cordialement,</p>']
  return { html: blocks.join(''), focusBlock: paragraphs.length + 1 }
}

// The composer's `restore` (App's handleComposeMail): `file`, the
// justificatif picked in the walkthrough, attached as the composer opens;
// `toTeacher`, whether the teacher goes in Cc.
export function prepareJustificationMail(entry, { reason = null, details = '', proof = null, file = null, toTeacher = true } = {}) {
  const teacher = toTeacher ? absenceTeacher(entry) : null
  const lookUpClass = toTeacher && !teacher && Boolean(entry?.date)
  const attached = proof === 'attached' && file ? 'attached' : proof === 'attached' ? null : proof
  const { html, focusBlock } = buildJustificationHtml(entry, { reason, details, proof: attached })
  return {
    kind: 'absence',
    to: [],
    cc: teacher ? [teacher] : [],
    subject: buildJustificationSubject(entry, { proof: attached }),
    html,
    focusBlock,
    inlineImages: [],
    attachFiles: attached === 'attached' ? [file] : [],
    absenceClass: lookUpClass
      ? { day: entry.date, startHours: entry.startHours ?? null, endHours: entry.endHours ?? null, moduleCode: entry.moduleCode ?? null }
      : null,
    isFullscreen: true,
  }
}
