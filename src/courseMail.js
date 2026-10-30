// « Écrire au sujet de ce cours » (the Planning): the mail the composer
// opens with, from a class (toPlanningEvent's). Pure but for
// prepareCourseImage / prepareCourseMail (which draw the class's image in
// the browser), so the tests run it straight in Node.
//
// The mail: « R5.12 Développement back-end – mardi 3 novembre » as its
// subject; « Bonjour, », a line saying which class it's about, a line for
// the student to write on (the caret's), then a summary box (the class in
// text: what the Planning shows of it) and the class's image
// (src/courseCardImage.js) inline. À: the teacher, looked up in the
// recipient suggestions by the composer (src/teacherRecipients.js), never
// guessed. Both planning sources' classes: ADE's and TEMPO's (which may
// have no room nor teacher).

import { buildAboutInsertion, buildAboutMailHtml, makeInlineImageItem, shortenMailText } from './mailAboutBlocks.js'
import { durationText, formatTime } from './planningDates.js'
import { parseTeacherNames } from './teacherRecipients.js'

const MAX_SUBJECT_TITLE_LENGTH = 80
const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const FULL_DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const KINDS = { cm: 'CM', td: 'TD', tp: 'TP' }

const capitalize = (text) => (text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text)

// « mardi 3 novembre », as the Planning reads the class's day (local time).
export function formatCourseDay(event) {
  return Number.isFinite(event?.start) ? DAY_FORMAT.format(event.start) : ''
}

// « 14 h », « 10 h 15 ».
export function formatCourseHour(ms) {
  if (!Number.isFinite(ms)) return ''
  const [hours, minutes] = formatTime(ms).split(':')
  return `${Number(hours)} h${minutes === '00' ? '' : ` ${minutes}`}`
}

// CM, TD or TP when the title says so as a word of its own (ADE's « R302
// Anglais TD »); null otherwise (no field of the planning gives it).
export function courseKind(event) {
  const match = String(event?.title ?? '').match(/(?:^|[\s\-–(/])(CM|TD|TP)s?(?=$|[\s\-–)/\d])/i)
  return match ? KINDS[match[1].toLowerCase()] : null
}

// The teachers as the class names them, civility and all (« M. Lemoine,
// Mme Le Fur »).
export function courseTeacherNames(event) {
  return parseTeacherNames(event?.teacher).map((teacher) => teacher.display)
}

// « R5.12 Développement back-end – lundi 2 novembre », the title cut short.
export function buildCourseMailSubject(event) {
  return [shortenMailText(event?.title, MAX_SUBJECT_TITLE_LENGTH), formatCourseDay(event)].filter(Boolean).join(' – ')
}

// What the Planning shows of the class, as the summary box's rows:
// [{ label, value }]. Its room, teachers and group only when it has them.
export function buildCourseSummaryRows(event) {
  const teachers = courseTeacherNames(event)
  const hasTimes = Number.isFinite(event?.start) && Number.isFinite(event?.end)
  return [
    { label: 'Cours', value: String(event?.title ?? '').trim() },
    courseKind(event) ? { label: 'Type', value: courseKind(event) } : null,
    Number.isFinite(event?.start) ? { label: 'Date', value: capitalize(FULL_DAY_FORMAT.format(event.start)) } : null,
    hasTimes ? { label: 'Horaire', value: `${formatTime(event.start)} – ${formatTime(event.end)} (${durationText(event.start, event.end)})` } : null,
    event?.location ? { label: 'Salle', value: event.location } : null,
    teachers.length ? { label: teachers.length > 1 ? 'Enseignants' : 'Enseignant', value: teachers.join(', ') } : null,
    event?.group ? { label: 'Groupe', value: event.group } : null,
  ].filter((row) => row && row.value)
}

// The image's text: its alt, and the text version's « [Image : …] ».
export function courseImageAlt(event) {
  return shortenMailText(`Cours de ${String(event?.title ?? '').trim() || 'la séance'} du ${formatCourseDay(event)}`.replace(/ du $/, ''), 160)
}

// « du cours de R5.12… », « d’Anglais » before a vowel.
function ofTitle(title) {
  return /^[aeiouyàâäéèêëîïôöùûü]/i.test(title) ? `d’${title}` : `de ${title}`
}

// The editor's HTML (MailComposer's `restore.html`): the greeting, the
// line about the class, the line to write on, its box and its image.
// → { html, focusBlock }.
export function buildCourseMailHtml(event, rows, image = null) {
  const title = String(event?.title ?? '').trim()
  const day = formatCourseDay(event)
  const hour = formatCourseHour(event?.start)
  const about = `Je vous écris au sujet du cours${title ? ` ${ofTitle(title)}` : ''}${day ? ` du ${day}` : ''}${hour ? ` à ${hour}` : ''}.`
  return buildAboutMailHtml({ about, rows, image })
}

// The editor's nodes for a class picked in « Un cours… »: its box, its
// image (the box alone past the shared 3 images). → { nodes, capped }.
export function buildCourseInsertion({ event, image = null, imagesInText = 0 }) {
  return buildAboutInsertion({ rows: buildCourseSummaryRows(event), alt: courseImageAlt(event), image, imagesInText })
}

// What the class fills of the subject when it's empty, never over what
// the student typed. → the subject, or null.
export function courseAttachSubject(subject, event) {
  return String(subject ?? '').trim() ? null : buildCourseMailSubject(event) || null
}

// A class's image as the composer's item (useInlineImages's): drawn here
// (the canvas renderer, loaded on first use) in its course's colour
// (`accent`, eventAccents' index). Null if it can't be drawn: the mail
// goes without it.
export async function prepareCourseImage({ event, accent = 0 }) {
  try {
    const { renderCourseCardImage } = await import('./courseCardImage.js')
    const drawn = await renderCourseCardImage({ event, accent })
    const name = `cours-${event.day ?? 'seance'}.png`
    return makeInlineImageItem({ blob: drawn.blob, width: drawn.width, height: drawn.height, name, alt: courseImageAlt(event) })
  } catch {
    return null
  }
}

// The composer's `restore` for a class (App's handleComposeMail): its
// subject, text and image, À left to the teachers' lookup (`teachers`,
// the class's names, MailComposer's), full screen from 1024 px.
export async function prepareCourseMail({ event, accent = 0 }) {
  const rows = buildCourseSummaryRows(event)
  const image = await prepareCourseImage({ event, accent })
  const { html, focusBlock } = buildCourseMailHtml(event, rows, image)
  return {
    kind: 'course',
    to: [],
    subject: buildCourseMailSubject(event),
    html,
    focusBlock,
    inlineImages: image ? [image] : [],
    teachers: String(event?.teacher ?? ''),
    isFullscreen: true,
  }
}
