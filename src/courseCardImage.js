// A class drawn as the Planning shows it (its sheet's block: the course's
// colour washing the top, its accent bar, the day, the title, the hours,
// then the room, the teachers and the group), as a PNG for a mail
// (src/courseMail.js). The light theme, 2×, the app's fonts, as a grade's
// image (src/mailCardCanvas.js). Loaded on first use only.

import { accentColor } from './eventAccents.js'
import { courseKind, courseTeacherNames } from './courseMail.js'
import { durationText, formatTime } from './planningDates.js'
import { BODY, CARD_WIDTH, DISPLAY, INK, INK_50, INK_70, PAD, drawPill, drawTopWash, fit, loadCardFonts, renderCardPng, roundedRect, wrap } from './mailCardCanvas.js'

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
// The block's bar (eventBlockLayout's regular variant: 6 px, 14 px to the
// text).
const BAR_WIDTH = 6
const INFO_X = PAD + BAR_WIDTH + 14
// The Planning's symbols (Phosphor, 256 units): the room, a teacher, a group.
const ICONS = {
  room: 'M184 72a56 56 0 1 0-64 55.42V232a8 8 0 0 0 16 0V127.42A56.09 56.09 0 0 0 184 72m-56 40a40 40 0 1 1 40-40a40 40 0 0 1-40 40',
  teacher: 'M208 32H48a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16M96 120a32 32 0 1 1 32 32a32 32 0 0 1-32-32m-27.33 88a64.36 64.36 0 0 1 19.13-25.8a64 64 0 0 1 80.4 0a64.36 64.36 0 0 1 19.13 25.8ZM208 208h-3.67a79.9 79.9 0 0 0-46.68-50.29a48 48 0 1 0-59.3 0A79.9 79.9 0 0 0 51.67 208H48V48h160z',
  group: 'M244.8 150.4a8 8 0 0 1-11.2-1.6A51.6 51.6 0 0 0 192 128a8 8 0 0 1-7.37-4.89a8 8 0 0 1 0-6.22A8 8 0 0 1 192 112a24 24 0 1 0-23.24-30a8 8 0 1 1-15.5-4A40 40 0 1 1 219 117.51a67.94 67.94 0 0 1 27.43 21.68a8 8 0 0 1-1.63 11.21M190.92 212a8 8 0 1 1-13.84 8a57 57 0 0 0-98.16 0a8 8 0 1 1-13.84-8a72.06 72.06 0 0 1 33.74-29.92a48 48 0 1 1 58.36 0A72.06 72.06 0 0 1 190.92 212M128 176a32 32 0 1 0-32-32a32 32 0 0 0 32 32m-56-56a8 8 0 0 0-8-8a24 24 0 1 1 23.24-30a8 8 0 1 0 15.5-4A40 40 0 1 0 37 117.51a67.94 67.94 0 0 0-27.4 21.68a8 8 0 1 0 12.8 9.61A51.6 51.6 0 0 1 64 128a8 8 0 0 0 8-8',
}
const ICON_SIZE = 15
const META_LINE = 22

const capitalize = (text) => (text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text)

function drawIcon(context, path, x, y) {
  context.save()
  context.translate(x, y)
  context.scale(ICON_SIZE / 256, ICON_SIZE / 256)
  context.fillStyle = INK_50
  context.fill(new Path2D(path))
  context.restore()
}

// The rows under the hours: what the class has of them.
function readMeta(event) {
  const teachers = courseTeacherNames(event)
  return [
    event.location ? { icon: ICONS.room, text: event.location } : null,
    teachers.length ? { icon: ICONS.teacher, text: teachers.join(', ') } : null,
    event.group ? { icon: ICONS.group, text: event.group } : null,
  ].filter(Boolean)
}

// The card's parts, top to bottom (only measured with `draw` false).
// → its height.
function layout(context, event, { color }, draw) {
  const inner = CARD_WIDTH - INFO_X - PAD
  let y = PAD

  // The day, and the kind (CM, TD, TP) as a quiet tag when the title says.
  const day = capitalize(DAY_FORMAT.format(event.start))
  const kind = courseKind(event)
  if (draw) {
    context.font = `500 13px ${BODY}`
    context.fillStyle = INK_50
    const label = fit(context, day, inner - (kind ? 48 : 0))
    context.fillText(label, INFO_X, y + 14)
    if (kind) drawPill(context, { x: INFO_X + Math.ceil(context.measureText(label).width) + 10, y: y + 1, text: kind, font: `600 11.5px ${BODY}`, fill: 'rgb(52 18 0 / 0.08)', ink: INK_70, padX: 8, height: 20 })
  }
  y += 22 + 8

  // The title, two lines at most.
  context.font = `700 21px ${DISPLAY}`
  const titleLines = wrap(context, event.title, inner, 2)
  if (draw) {
    context.fillStyle = INK
    titleLines.forEach((line, index) => context.fillText(line, INFO_X, y + 19 + index * 26))
  }
  y += titleLines.length * 26 + 12

  // The hours, big, and the length beside them.
  if (draw) {
    context.fillStyle = INK
    context.font = `700 30px ${DISPLAY}`
    const hours = `${formatTime(event.start)} – ${formatTime(event.end)}`
    context.fillText(hours, INFO_X - 1, y + 28)
    const width = context.measureText(hours).width
    context.fillStyle = INK_50
    context.font = `500 15px ${BODY}`
    context.fillText(durationText(event.start, event.end), INFO_X + width + 10, y + 28)
  }
  y += 34

  // The room, the teachers, the group, a line each.
  const meta = readMeta(event)
  if (meta.length) {
    y += 12
    if (draw) {
      context.font = `500 14px ${BODY}`
      meta.forEach((row, index) => {
        const top = y + index * META_LINE
        drawIcon(context, row.icon, INFO_X, top + 2)
        context.fillStyle = INK_70
        context.fillText(fit(context, row.text, inner - ICON_SIZE - 6), INFO_X + ICON_SIZE + 6, top + 14)
      })
    }
    y += meta.length * META_LINE - 4
  }
  const height = y + PAD

  // The accent bar down the card's side, as the block's.
  if (draw) {
    roundedRect(context, PAD, PAD, BAR_WIDTH, height - PAD * 2, BAR_WIDTH / 2)
    context.fillStyle = color
    context.fill()
  }
  return height
}

// `accent`: the course's colour (eventAccents' index), as the Planning
// paints it in the light theme. → { blob (image/png, 2×), width, height }.
export async function renderCourseCardImage({ event, accent = 0 }) {
  await loadCardFonts(['700 30px "SN Pro"', '700 21px "SN Pro"', '500 13px "Inter Variable"', '500 14px "Inter Variable"', '600 11.5px "Inter Variable"'])
  const color = accentColor(Number.isInteger(accent) ? accent : 0)
  return renderCardPng({
    layout: (context, draw) => layout(context, event, { color }, draw),
    wash: (context, width, height) => drawTopWash(context, width, height, () => color),
  })
}
