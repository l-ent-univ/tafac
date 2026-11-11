// « Partager » (the Planning's header): the week shown, drawn as an image
// (src/weekCardImage.js), then a sheet to send it (PlanningShareSheet): a
// mail in the Messagerie, the system's share, a copy, a file. Pure but for
// prepareWeekImage / prepareTimetableMail (which draw in the browser), so
// the tests run it straight in Node.

import { escapeHtml } from './mailText.js'
import { makeInlineImageItem } from './mailAboutBlocks.js'
import { addDays, parseDayKey } from './planningDates.js'

// The hours the image always spans; a class earlier or later widens them.
export const SHARE_FIRST_HOUR = 8
export const SHARE_LAST_HOUR = 18
const HOUR_MS = 60 * 60 * 1000
const MONTH_FORMAT = new Intl.DateTimeFormat('fr-FR', { month: 'long' })

// « 1er », « 2 ».
const dayNumber = (date) => (date.getDate() === 1 ? '1er' : String(date.getDate()))

// The week of `monday` as a sentence says it: « du 2 au 8 novembre 2026 »,
// « du 28 septembre au 4 octobre 2026 », « du 28 décembre 2026 au 3
// janvier 2027 ».
export function weekSpanText(monday) {
  const first = parseDayKey(monday)
  const last = parseDayKey(addDays(monday, 6))
  const lastText = `${dayNumber(last)} ${MONTH_FORMAT.format(last)} ${last.getFullYear()}`
  if (first.getFullYear() !== last.getFullYear()) return `du ${dayNumber(first)} ${MONTH_FORMAT.format(first)} ${first.getFullYear()} au ${lastText}`
  if (first.getMonth() !== last.getMonth()) return `du ${dayNumber(first)} ${MONTH_FORMAT.format(first)} au ${lastText}`
  return `du ${dayNumber(first)} au ${lastText}`
}

// The hours the image spans for `events` (their days' classes): 8:00 to
// 18:00, wider for a class outside them, whole hours. → { first, last }.
export function shareHourRange(events, days) {
  let first = SHARE_FIRST_HOUR
  let last = SHARE_LAST_HOUR
  for (const event of Array.isArray(events) ? events : []) {
    if (!days.includes(event.day)) continue
    const dayStart = parseDayKey(event.day).getTime()
    first = Math.min(first, Math.floor((event.start - dayStart) / HOUR_MS))
    last = Math.max(last, Math.ceil((event.end - dayStart) / HOUR_MS))
  }
  return { first: Math.max(0, first), last: Math.min(24, last) }
}

// The file: « planning-2026-11-02.png », its week's Monday.
export function shareFileName(monday) {
  return `planning-${monday}.png`
}

export function weekImageAlt(monday) {
  return `Planning de la semaine ${weekSpanText(monday)}`
}

// The mail's subject: « Planning de la semaine du 2 au 8 novembre 2026 ».
export function timetableMailSubject(monday) {
  return weekImageAlt(monday)
}

// The editor's HTML (MailComposer's `restore.html`): the greeting, the
// line saying which week, the line to write on, the image.
// → { html, focusBlock }.
export function buildTimetableMailHtml(monday, image = null) {
  const picture = image
    ? `<img data-inline-cid="${escapeHtml(image.cid)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}">`
    : ''
  const blocks = ['<p>Bonjour,</p>', '<p></p>', `<p>${escapeHtml(`Voici mon planning de la semaine ${weekSpanText(monday)}.`)}</p>`, '<p></p>', '<p></p>', picture].filter(Boolean)
  return { html: blocks.join(''), focusBlock: 3 }
}

// The week drawn (the canvas renderer, loaded on first use). `days`: its
// columns (weekColumns'), `events`: the planning's, `accentFor(title)`:
// the courses' colours, `group`: the group's name. → { blob, width,
// height } (its size in CSS pixels, the PNG 2×).
export async function prepareWeekImage({ monday, days, events, accentFor, group = '' }) {
  const { renderWeekCardImage } = await import('./weekCardImage.js')
  return renderWeekCardImage({ monday, days, events, accentFor, group })
}

// The composer's `restore` for the week (App's handleComposeMail), from
// its image already drawn (`drawn`, prepareWeekImage's): À left empty,
// full screen from 1024 px.
export function prepareTimetableMail({ monday, drawn }) {
  const image = drawn
    ? makeInlineImageItem({ blob: drawn.blob, width: drawn.width, height: drawn.height, name: shareFileName(monday), alt: weekImageAlt(monday) })
    : null
  const { html, focusBlock } = buildTimetableMailHtml(monday, image)
  return {
    kind: 'timetable',
    to: [],
    subject: timetableMailSubject(monday),
    html,
    focusBlock,
    inlineImages: image ? [image] : [],
    isFullscreen: true,
  }
}
