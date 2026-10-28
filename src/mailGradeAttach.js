// The composer's « Une note… » (its trombone's menu): a grade picked in a
// drawer (MailGradePicker) goes into the mail being written as « Écrire au
// sujet de cette note » puts it there (src/gradeMail.js): its summary box
// and its image inline. Pure, so the tests run it straight in Node: the
// drawer's list, where the blocks go, what fills the empty fields.

import { buildGradeMailSubject, buildGradeSummaryRows, gradeImageAlt } from './gradeMail.js'
import { MAX_INLINE_IMAGES } from './mailInlineImages.js'
import { foldMailSearchText } from './mailSearch.js'

// The grades worth a mail: a number, or what stands in its place (an
// absence, an excused one). Not one still pending: there's nothing yet.
const LISTED_KINDS = new Set(['number', 'absent', 'excused'])

// The semester's grades (buildGradesReport's report), newest first as
// « Dernières notes » orders them, but all of them; undated ones after, in
// the report's order. → [{ key, module, evaluation }].
export function listRecentGrades(report) {
  if (report?.status !== 'ok') return []
  const grades = [...(report.resources ?? []), ...(report.saes ?? [])]
    .flatMap((module) => (module.evaluations ?? [])
      .filter((evaluation) => LISTED_KINDS.has(evaluation?.grade?.kind))
      .map((evaluation) => ({ key: `${module.code}:${evaluation.id}`, module, evaluation })))
  const dated = grades.filter((entry) => entry.evaluation.date)
  const undated = grades.filter((entry) => !entry.evaluation.date)
  // A stable sort: same day, the report's order.
  dated.sort((left, right) => String(right.evaluation.date).localeCompare(String(left.evaluation.date)))
  return [...dated, ...undated]
}

// The list as the search field narrows it: every word found in the
// evaluation's name, the subject's code or title (accents and case aside).
export function filterRecentGrades(grades, query) {
  const words = foldMailSearchText(query).split(/\s+/).filter(Boolean)
  if (!words.length) return grades
  return grades.filter(({ module, evaluation }) => {
    const text = foldMailSearchText([evaluation.description, evaluation.typeLabel, module.code, module.title].filter(Boolean).join(' '))
    return words.every((word) => text.includes(word))
  })
}

// Where the grade's blocks go, among the text's top-level blocks (`blocks`:
// [{ type, empty }], the editor's doc children). `caretIndex`: the block
// the caret is in, when the student has been in the text (null else).
// - after the caret's block, an empty line under them to go on writing
//   (`withLine`, the caret moved there); in an empty line, before it (the
//   caret stays there, under them);
// - else, or with the caret in a reply's quote, under the text: before the
//   signature, or before the line introducing the quote, or at the end.
// → { index, withLine }.
export function pickGradeInsertIndex(blocks, caretIndex = null) {
  const list = Array.isArray(blocks) ? blocks : []
  const signature = list.findIndex((block) => block.type === 'mailSignature')
  const quote = list.findIndex((block) => block.type === 'blockquote')
  let end = list.length
  if (signature >= 0) end = signature
  else if (quote >= 1) {
    // The header introducing the quote, and the empty line above it.
    end = quote - 1
    if (end >= 1 && list[end - 1].type === 'paragraph' && list[end - 1].empty) end -= 1
  }
  if (Number.isInteger(caretIndex) && caretIndex >= 0 && caretIndex < end) {
    const block = list[caretIndex]
    if (block.type === 'paragraph' && block.empty) return { index: caretIndex, withLine: false }
    return { index: caretIndex + 1, withLine: true }
  }
  return { index: end, withLine: false }
}

// The editor's nodes for a grade: its summary box (the rows « Mes notes »
// shows), then its image (`image`: { cid, width, height } or null). Past
// the server's MAX_INLINE_IMAGES (`imagesInText`: those the text shows
// already), the box alone (`capped`). → { nodes, capped }.
export function buildGradeInsertion({ module, evaluation, showPromoStats = false, image = null, imagesInText = 0 }) {
  const rows = buildGradeSummaryRows(module, evaluation, { showPromoStats })
  const capped = imagesInText >= MAX_INLINE_IMAGES
  const nodes = [{ type: 'mailSummary', attrs: { rows } }]
  if (image && !capped) {
    nodes.push({ type: 'mailInlineImage', attrs: { cid: image.cid, alt: gradeImageAlt(module, evaluation), width: image.width ?? null, height: image.height ?? null } })
  }
  return { nodes, capped }
}

// What the grade fills of the fields left empty, never over what the
// student typed: the subject (« Note de R5.11 – … »), and À with the
// subject's teacher (findModuleTeacher's, or null) when À has no one and
// nothing typed. → { subject: string | null, to: [teacher] | null }.
export function gradeAttachFields({ subject = '', to = [], toInput = '' } = {}, { module, evaluation, teacher = null } = {}) {
  const emptyTo = !(Array.isArray(to) && to.length) && !String(toInput ?? '').trim()
  return {
    subject: String(subject ?? '').trim() ? null : buildGradeMailSubject(module, evaluation) || null,
    to: emptyTo && teacher?.email ? [teacher] : null,
  }
}
