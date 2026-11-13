// A week of the Planning drawn as an image (« Partager », src/planningShare.js):
// the week and the group on top, the days' heads, the hours' ruler, and
// the classes in their day's column as the week shows them (a card in the
// course's colour, its accent bar, the title, the hours, the room),
// overlapping ones side by side (eventColumns), and the tafac logo in the
// top right corner, the group under it. The light theme always (an
// image is seen anywhere), 2×, the app's fonts, square corners and an
// opaque background (a messaging app turning it into a JPEG keeps it
// whole). Loaded on first use only.

import { accentColor } from './eventAccents.js'
import { placeEventColumns } from './eventColumns.js'
import { BODY, BORDER, DISPLAY, INK, INK_50, INK_70, SCALE, fit, loadCardFonts, roundedRect, wrap } from './mailCardCanvas.js'
import { formatTime, parseDayKey, shortWeekdayText, weekRangeText } from './planningDates.js'
import { shareHourRange } from './planningShare.js'
import tafacMark from './assets/tafac-mark.png'
import tafacWordmark from './assets/tafac-wordmark.svg'

const PAD = 28
const LABEL_COLUMN = 48
const TOP = 78
const DAY_HEAD = 44
const PITCH = 54
const BOTTOM = 10
const COLUMN_GAP = 3
const BLOCK_INSET = 2
const HOUR_MS = 60 * 60 * 1000
const PAPER = '#FCFBF8'
const CARD = '#ffffff'
const WEEKEND = 'rgb(52 18 0 / 0.025)'

const TITLE_FONT = `600 12.5px ${BODY}`
const TITLE_LINE = 15
const META_FONT = `500 11px ${BODY}`
const META_LINE = 14
// The logo (LogoBut1's proportions: the mark, then the wordmark), by its
// height, « .fr » after it in the wordmark's colour, on its baseline.
const LOGO_HEIGHT = 30
const LOGO_RATIO = 411.94 / 130.65
const LOGO_INK = '#541E00'
const DOMAIN_FONT = `600 31px ${DISPLAY}`

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

// The logo and « .fr » with their right edge at `right`; left out if the
// logo doesn't load.
async function drawLogo(context, right, top) {
  try {
    const [mark, wordmark] = await Promise.all([loadImage(tafacMark), loadImage(tafacWordmark)])
    context.font = DOMAIN_FONT
    const domainWidth = context.measureText('.fr').width
    const width = LOGO_HEIGHT * LOGO_RATIO
    const left = right - domainWidth - 1 - width
    context.drawImage(mark, left, top, width * 0.2094, LOGO_HEIGHT)
    context.drawImage(wordmark, left + width * 0.2434, top + LOGO_HEIGHT * 0.0842, width * 0.7566, LOGO_HEIGHT * 0.777)
    context.fillStyle = LOGO_INK
    context.fillText('.fr', right - domainWidth, top + LOGO_HEIGHT * (0.0842 + 0.777))
  } catch {
    // No logo: the image goes without it.
  }
}

function rgba(hex, alpha) {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16))
  return `rgb(${r} ${g} ${b} / ${alpha})`
}

// The rows a block has room for, from `height`: the title (three lines at
// most), then its hours, then its room, each dropped first from the end.
function blockRows(context, event, width, height) {
  const room = height - 12
  const rest = [`${formatTime(event.start)} – ${formatTime(event.end)}`, event.location].filter(Boolean)
  context.font = TITLE_FONT
  for (let kept = rest.length; kept >= 0; kept -= 1) {
    const titleRoom = room - kept * META_LINE
    const lines = Math.min(3, Math.floor(titleRoom / TITLE_LINE))
    if (lines >= 1 || kept === 0) {
      return { title: wrap(context, event.title, width, Math.max(1, lines)), meta: rest.slice(0, kept) }
    }
  }
  return { title: [], meta: [] }
}

function drawBlock(context, { event, x, y, width, height, color }) {
  context.save()
  roundedRect(context, x, y, width, height, 8)
  context.fillStyle = CARD
  context.fill()
  // The course's wash, strongest at the top (the cards' .latest-grade-wash).
  const wash = context.createLinearGradient(0, y, 0, y + height)
  wash.addColorStop(0, rgba(color, 0.2))
  wash.addColorStop(1, rgba(color, 0.08))
  context.fillStyle = wash
  context.fill()
  context.strokeStyle = rgba(color, 0.28)
  context.lineWidth = 1
  context.stroke()
  context.clip()

  const barInset = height > 22 ? 5 : 3
  roundedRect(context, x + 5, y + barInset, 3.5, height - barInset * 2, 1.75)
  context.fillStyle = color
  context.fill()

  const textX = x + 14
  const textWidth = width - 20
  const { title, meta } = blockRows(context, event, textWidth, height)
  let top = y + (height < 26 ? Math.max(2, (height - TITLE_LINE) / 2) : 6)
  context.fillStyle = INK
  context.font = TITLE_FONT
  for (const line of title) {
    context.fillText(line, textX, top + 11.5)
    top += TITLE_LINE
  }
  context.font = META_FONT
  meta.forEach((text, index) => {
    context.fillStyle = index === 0 ? INK_70 : INK_50
    context.fillText(fit(context, text, textWidth), textX, top + 10.5)
    top += META_LINE
  })
  context.restore()
}

// `days`: the columns ("YYYY-MM-DD", weekColumns'), `events`: the
// planning's (only those days' are drawn), `accentFor(title)`: a course's
// accent index, `group`: the group's name, top right.
// → { blob (image/png, 2×), width, height }.
export async function renderWeekCardImage({ monday, days, events, accentFor, group = '' }) {
  await loadCardFonts([`700 26px "SN Pro"`, `600 31px "SN Pro"`, `700 17px "SN Pro"`, '600 12.5px "Collab Sans"', '500 11px "Collab Sans"', '500 13px "Collab Sans"', '600 13px "Collab Sans"'])
  const weekEvents = (Array.isArray(events) ? events : []).filter((event) => days.includes(event.day))
  const { first, last } = shareHourRange(weekEvents, days)
  const columnWidth = days.length > 5 ? 136 : 168
  const width = PAD * 2 + LABEL_COLUMN + days.length * columnWidth
  const gridTop = PAD + TOP + DAY_HEAD
  const gridHeight = (last - first) * PITCH
  const height = gridTop + gridHeight + BOTTOM + PAD
  const gridLeft = PAD + LABEL_COLUMN
  const gridRight = width - PAD

  const canvas = document.createElement('canvas')
  canvas.width = width * SCALE
  canvas.height = height * SCALE
  const context = canvas.getContext('2d')
  context.scale(SCALE, SCALE)
  context.fillStyle = PAPER
  context.fillRect(0, 0, width, height)

  // The week; the logo at the right, the group under it.
  await drawLogo(context, gridRight, PAD - 2)
  context.fillStyle = INK_50
  context.font = `600 13px ${BODY}`
  context.fillText('Planning', PAD, PAD + 16)
  context.fillStyle = INK
  context.font = `700 26px ${DISPLAY}`
  const title = weekRangeText(monday)
  context.fillText(title, PAD, PAD + 50)
  if (group) {
    const titleEnd = PAD + context.measureText(title).width
    context.font = `500 13px ${BODY}`
    context.fillStyle = INK_70
    context.textAlign = 'right'
    context.fillText(fit(context, group, Math.max(0, gridRight - titleEnd - 24)), gridRight, PAD + 48)
    context.textAlign = 'left'
  }

  // The paper the grid sits on, the weekend a shade darker.
  roundedRect(context, gridLeft, gridTop - DAY_HEAD, gridRight - gridLeft, DAY_HEAD + gridHeight + BOTTOM, 14)
  context.fillStyle = CARD
  context.fill()
  context.strokeStyle = BORDER
  context.lineWidth = 1
  context.stroke()
  context.save()
  context.clip()
  days.forEach((day, index) => {
    if (parseDayKey(day).getDay() % 6 !== 0) return
    context.fillStyle = WEEKEND
    context.fillRect(gridLeft + index * columnWidth, gridTop - DAY_HEAD, columnWidth, DAY_HEAD + gridHeight + BOTTOM)
  })
  context.restore()

  // The days' heads: « Lun. » and its date, centred on their column.
  context.textAlign = 'center'
  days.forEach((day, index) => {
    const centre = gridLeft + index * columnWidth + columnWidth / 2
    const weekday = shortWeekdayText(day)
    const date = String(parseDayKey(day).getDate())
    context.font = `500 13px ${BODY}`
    const weekdayWidth = context.measureText(`${weekday} `).width
    context.font = `700 17px ${DISPLAY}`
    const dateWidth = context.measureText(date).width
    const start = centre - (weekdayWidth + dateWidth) / 2
    context.textAlign = 'left'
    context.font = `500 13px ${BODY}`
    context.fillStyle = INK_50
    context.fillText(weekday, start, gridTop - 17)
    context.font = `700 17px ${DISPLAY}`
    context.fillStyle = INK
    context.fillText(date, start + weekdayWidth, gridTop - 17)
  })
  context.textAlign = 'left'

  // The hours: a hairline each, its label in the margin; the days apart.
  context.strokeStyle = BORDER
  context.lineWidth = 1
  context.font = `500 11px ${BODY}`
  context.fillStyle = INK_50
  context.textAlign = 'right'
  for (let hour = first; hour <= last; hour += 1) {
    const y = Math.round(gridTop + (hour - first) * PITCH) + 0.5
    context.beginPath()
    context.moveTo(gridLeft, y)
    context.lineTo(gridRight, y)
    context.stroke()
    context.fillText(`${String(hour).padStart(2, '0')}:00`, gridLeft - 8, y + 4)
  }
  context.textAlign = 'left'
  for (let index = 1; index < days.length; index += 1) {
    const x = Math.round(gridLeft + index * columnWidth) + 0.5
    context.beginPath()
    context.moveTo(x, gridTop - DAY_HEAD)
    context.lineTo(x, gridTop + gridHeight + BOTTOM)
    context.stroke()
  }

  // The classes, a day at a time.
  days.forEach((day, index) => {
    const dayStart = parseDayKey(day).getTime()
    const gridStart = dayStart + first * HOUR_MS
    const gridEnd = dayStart + last * HOUR_MS
    const slots = weekEvents
      .filter((event) => event.day === day && event.end > gridStart && event.start < gridEnd)
      .map((event) => ({ event, start: Math.max(event.start, gridStart), end: Math.min(Math.max(event.end, event.start), gridEnd) }))
    const columns = placeEventColumns(slots)
    const laneX = gridLeft + index * columnWidth + BLOCK_INSET
    const laneWidth = columnWidth - BLOCK_INSET * 2
    for (const slot of slots) {
      const { column, count } = columns.get(slot)
      const blockWidth = (laneWidth - COLUMN_GAP * (count - 1)) / count
      const top = gridTop + ((slot.start - gridStart) / HOUR_MS) * PITCH
      const bottom = gridTop + ((slot.end - gridStart) / HOUR_MS) * PITCH
      drawBlock(context, {
        event: slot.event,
        x: laneX + (blockWidth + COLUMN_GAP) * column,
        y: top + 1,
        width: blockWidth,
        height: Math.max(bottom - top - 2, 18),
        color: accentColor(accentFor(slot.event.title) ?? 0),
      })
    }
  })

  if (weekEvents.length === 0) {
    context.font = `500 15px ${BODY}`
    context.fillStyle = INK_50
    context.textAlign = 'center'
    context.fillText('Aucun cours cette semaine', (gridLeft + gridRight) / 2, gridTop + gridHeight / 2)
    context.textAlign = 'left'
  }

  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG not made.'))), 'image/png'))
  return { blob, width, height }
}
