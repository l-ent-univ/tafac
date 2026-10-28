// « Écrire au sujet de cette note » (« Mes notes »): the mail the composer
// opens with, from a grade of buildGradesReport's report. Pure but for
// prepareGradeMail (which draws the grade's image in the browser), so the
// tests run it straight in Node.
//
// The mail: « Note de R5.01 – Contrôle TP1 » as its subject; « Bonjour, »,
// a line saying which grade it's about, a line for the student to write
// on (the caret's), then a summary box (the grade in text: what « Mes
// notes » shows of it) and the grade's image (src/gradeCardImage.js) inline.
// To the subject's teacher when the relevé names exactly one, else to no
// one: an address is never guessed.

import { isValidAddress } from './mailCompose.js'
import { formatScore } from './gradesSubjects.js'
import { escapeHtml } from './mailText.js'
import { createInlineCid, inlineImageKey } from './mailInlineImages.js'

const MAX_SUBJECT_TITLE_LENGTH = 90
const MAIL_DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
const KIND_LABELS = { resource: 'Ressource', sae: 'SAÉ' }

// 15.5 → « 15,5 », as a French reader writes it.
export function formatMailScore(value) {
  return formatScore(value).replace('.', ',')
}

// The grade as the mail says it: « 15,5/20 », or what stands in its place
// (« Absent », « Excusé », « En attente »).
export function describeMailGrade(grade) {
  return grade?.kind === 'number' ? `${formatMailScore(grade.value)}/20` : String(grade?.label ?? '').trim()
}

function shorten(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

// « Note de R5.01 – Contrôle TP1 », the evaluation's name cut short.
export function buildGradeMailSubject(module, evaluation) {
  const title = shorten(evaluation?.description, MAX_SUBJECT_TITLE_LENGTH)
  const code = String(module?.code ?? '').trim()
  return [`Note${code ? ` de ${code}` : ''}`, title].filter(Boolean).join(' – ')
}

export function formatMailDate(date) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? MAIL_DATE_FORMAT.format(time) : null
}

// What « Mes notes » shows of the grade, as the summary box's rows:
// [{ label, value }]. The promo's mean, lowest and highest only where the
// department shows them (`showPromoStats`, the report's).
export function buildGradeSummaryRows(module, evaluation, { showPromoStats = false } = {}) {
  const promo = evaluation?.promo ?? {}
  const promoRow = (label, value) => (showPromoStats && value != null ? { label, value: `${formatMailScore(value)}/20` } : null)
  const kind = /^SA[EÉ]/i.test(module?.code ?? '') ? null : KIND_LABELS[module?.kind]
  return [
    { label: 'Évaluation', value: [evaluation?.description, evaluation?.typeLabel ? `(${evaluation.typeLabel})` : null].filter(Boolean).join(' ') },
    { label: kind ?? 'Matière', value: [module?.code, module?.title].filter(Boolean).join(' – ') },
    { label: 'Note', value: describeMailGrade(evaluation?.grade) },
    evaluation?.coef != null ? { label: 'Coefficient', value: formatMailScore(evaluation.coef) } : null,
    evaluation?.date && formatMailDate(evaluation.date) ? { label: 'Date', value: formatMailDate(evaluation.date) } : null,
    promoRow('Moyenne promo', promo.moy),
    promoRow('Min. promo', promo.min),
    promoRow('Max. promo', promo.max),
  ].filter((row) => row && row.value)
}

// The image's text: its alt, and the text version's « [Image : …] ».
export function gradeImageAlt(module, evaluation) {
  return shorten(`Note de ${evaluation?.description ?? 'l’évaluation'} (${module?.code ?? module?.title ?? ''})`.replace(/ \(\)$/, ''), 160)
}

// The editor's HTML (what MailComposer's `restore.html` takes): the
// greeting, the line about the grade, an empty line for the student
// (`focusBlock`, the caret's), the summary box, the image (`image`: { cid,
// alt, width, height } or null). → { html, focusBlock }.
export function buildGradeMailHtml(module, evaluation, rows, image = null) {
  const subject = String(module?.title ?? module?.code ?? '').trim()
  const name = String(evaluation?.description ?? '').trim()
  const about = name ? `Je vous écris au sujet de ma note de ${name}${subject ? ` en ${subject}` : ''}.` : `Je vous écris au sujet de ma note${subject ? ` en ${subject}` : ''}.`
  const summary = `<table data-mail-summary=""><tbody>${rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`).join('')}</tbody></table>`
  const picture = image
    ? `<img data-inline-cid="${escapeHtml(image.cid)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}">`
    : ''
  const blocks = ['<p>Bonjour,</p>', '<p></p>', `<p>${escapeHtml(about)}</p>`, '<p></p>', '<p></p>', summary, picture].filter(Boolean)
  return { html: blocks.join(''), focusBlock: 3 }
}

// The subject's teacher, as the relevé's absences name them (the
// passerelle's `enseignant`, an address, for each absence of a subject:
// `matiereComplet`, the module's ScoDoc id, or « R5.02 - Anglais »). Only
// when they name one address for that subject, and a valid one: several
// teachers (who graded it?) or none, null. → { name, email } | null.
export function findModuleTeacher(absences, module) {
  if (!module) return null
  const code = String(module.code ?? '').trim()
  const isModule = (subject) => (typeof subject === 'number' || /^\d+$/.test(String(subject ?? ''))
    ? String(subject) === String(module.id)
    : Boolean(code) && new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$|\\s*[-–:])`).test(String(subject ?? '').trim()))
  const found = new Map()
  for (const list of Object.values(absences && typeof absences === 'object' ? absences : {})) {
    for (const absence of Array.isArray(list) ? list : []) {
      if (!isModule(absence?.matiereComplet)) continue
      const email = String(absence?.enseignant ?? '').trim()
      if (!isValidAddress(email)) continue
      if (!found.has(email.toLowerCase())) found.set(email.toLowerCase(), email)
    }
  }
  if (found.size !== 1) return null
  const [email] = found.values()
  // « claire.rivoal@… » → « Claire Rivoal », as the absences list shows it.
  const name = email.split('@')[0].split(/[._]/).filter(Boolean).join(' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
  return { name, email }
}

// A grade's image as the composer's item (useInlineImages's): drawn here
// (the canvas renderer, loaded on first use), its file to upload. Null if
// it can't be drawn: the mail goes without it.
export async function prepareGradeImage({ report, module, evaluation }) {
  try {
    const { renderGradeCardImage } = await import('./gradeCardImage.js')
    const drawn = await renderGradeCardImage({ report, module, evaluation })
    const cid = createInlineCid()
    const name = `note-${String(module.code ?? 'evaluation').replace(/[^\w.-]+/g, '-')}.png`
    return {
      key: inlineImageKey(cid),
      cid,
      source: 'upload',
      file: new File([drawn.blob], name, { type: 'image/png' }),
      name,
      size: drawn.blob.size,
      contentType: 'image/png',
      width: drawn.width,
      height: drawn.height,
      alt: gradeImageAlt(module, evaluation),
      status: 'queued',
    }
  } catch {
    return null
  }
}

// The composer's `restore` for a grade (App's handleComposeMail): its
// recipient, subject, text and image (prepareGradeImage), full screen from
// 1024 px (a phone's composer is already).
// `report`: buildGradesReport's; `absences`: the relevé payload's.
export async function prepareGradeMail({ report, module, evaluation, absences = null }) {
  const rows = buildGradeSummaryRows(module, evaluation, { showPromoStats: Boolean(report?.showPromoStats) })
  const image = await prepareGradeImage({ report, module, evaluation })
  const { html, focusBlock } = buildGradeMailHtml(module, evaluation, rows, image)
  const teacher = findModuleTeacher(absences, module)
  return {
    to: teacher ? [teacher] : [],
    subject: buildGradeMailSubject(module, evaluation),
    html,
    focusBlock,
    inlineImages: image ? [image] : [],
    isFullscreen: true,
  }
}
