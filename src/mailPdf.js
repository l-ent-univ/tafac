import { describePrintedMail } from './mailPrintDocument.js'

// « Enregistrer en PDF » (src/mailPrint.js loads this module only then): the
// mail or thread written as a real PDF file, its text selectable and
// searchable, not a picture of the page. No library: the PDF's 14 standard
// fonts need no embedding, so a small writer does (a library would weigh
// 130 to 210 KB gzipped, plus what the installed app precaches).
//
// The body is read from the print document already laid out in its sandboxed
// frame (mailPrint.js): its computed styles say what's hidden (a newsletter's
// preview text), bold, a heading, centred; its images are the ones that
// frame loaded (inline ones only, remote images never have a source there).
// So the file holds what the printout shows, as text, links and pictures.

// A4 in points, the margins of the printout (mailPrintDocument's @page).
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 48
const MARGIN_TOP = 52
const MARGIN_BOTTOM = 56
export const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X
// At each page's foot: the file was made with Tafac. « Exporté », not
// « reçu »: a sent mail or a draft is saved the same way.
export const PDF_CREDIT = 'Exporté depuis Tafac · tafac.fr'
// The frame is laid out this wide (mailPrint.js), so a CSS pixel there is
// 0.75 pt here, as on paper.
export const PDF_FRAME_WIDTH = Math.round(CONTENT_WIDTH / 0.75)
const PX_TO_PT = 0.75
const LINE_HEIGHT = 1.38
const BODY_SIZE = 10.5
const TEXT_COLOR = [0.1, 0.1, 0.1]
const MUTED_COLOR = [0.4, 0.4, 0.4]
const LINK_COLOR = [0.043, 0.341, 0.816]
const RULE_COLOR = [0.82, 0.82, 0.82]

// Helvetica's and Helvetica-Bold's widths (thousandths of the size) for the
// WinAnsi codes 32 to 255 (Adobe's metrics; the obliques have the same).
// Courier is 600 throughout.
const HELVETICA_WIDTHS = '278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,500,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500'.split(',').map(Number)
const HELVETICA_BOLD_WIDTHS = '278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,556,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556'.split(',').map(Number)

// The PDF's fonts, by style: F1–F4 Helvetica (bold, oblique), F5–F6 Courier.
const FONTS = [
  ['F1', 'Helvetica'],
  ['F2', 'Helvetica-Bold'],
  ['F3', 'Helvetica-Oblique'],
  ['F4', 'Helvetica-BoldOblique'],
  ['F5', 'Courier'],
  ['F6', 'Courier-Bold'],
]

export function fontKey({ bold = false, italic = false, mono = false }) {
  if (mono) return bold ? 'F6' : 'F5'
  return `F${1 + (bold ? 1 : 0) + (italic ? 2 : 0)}`
}

// WinAnsi's codes 128–159, by Unicode code point (the rest of 32–255 is
// Latin-1, the same).
const WIN_ANSI_HIGH = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x2c6, 0x88], [0x2030, 0x89], [0x160, 0x8a], [0x2039, 0x8b], [0x152, 0x8c], [0x17d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x2dc, 0x98],
  [0x2122, 0x99], [0x161, 0x9a], [0x203a, 0x9b], [0x153, 0x9c], [0x17e, 0x9e], [0x178, 0x9f],
])
// What French text often holds outside WinAnsi, as its closest.
const NEAREST = new Map([
  [0x202f, ' '], [0x2009, ' '], [0x200a, ' '], [0x2002, ' '], [0x2003, ' '], [0x2007, ' '], [0x2008, ' '], [0x205f, ' '],
  [0x2010, '-'], [0x2011, '-'], [0x2012, '–'], [0x2212, '-'], [0x2015, '—'], [0x2032, '\''], [0x2033, '"'],
  [0x2044, '/'], [0x2190, '<-'], [0x2192, '->'], [0x2713, '•'], [0x2714, '•'], [0x25cf, '•'], [0x25aa, '•'], [0x2023, '•'],
])
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\p{M}\u200b-\u200f\u2060-\u2064\ufeff\u00ad]/u

// A text as WinAnsi codes (what the standard fonts draw): accents and French
// punctuation as they are, a narrow no-break space as a space, a letter
// from elsewhere as its unaccented one when it has one, emoji and invisible
// marks left out, anything else as « ? ».
export function toPdfCodes(text) {
  const codes = []
  for (const char of String(text ?? '').normalize('NFC')) {
    const point = char.codePointAt(0)
    if (point === 9) codes.push(32)
    else if ((point >= 32 && point < 127) || (point >= 160 && point <= 255 && point !== 0xad)) codes.push(point)
    else if (WIN_ANSI_HIGH.has(point)) codes.push(WIN_ANSI_HIGH.get(point))
    else if (NEAREST.has(point)) codes.push(...toPdfCodes(NEAREST.get(point)))
    else if (point < 32 || (point >= 127 && point < 160) || PICTOGRAPHIC.test(char)) continue
    else {
      // « ő » → « o », « ﬁ » → « fi »: its compatibility form, marks dropped.
      const plain = char.normalize('NFKD').replace(/\p{M}/gu, '')
      const mapped = plain !== char && plain ? toPdfCodes(plain) : []
      codes.push(...(mapped.length ? mapped : [63]))
    }
  }
  return codes
}

export function measureCodes(codes, font, size) {
  if (font === 'F5' || font === 'F6') return codes.length * 0.6 * size
  const widths = font === 'F2' || font === 'F4' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  let total = 0
  for (const code of codes) total += widths[code - 32] ?? 0
  return (total / 1000) * size
}

// A paragraph's runs ({ text, bold, italic, mono, size, color, href } or
// { br: true }) cut into lines no wider than `maxWidth`: at spaces, a word
// longer than a line at its characters. `preserve` (white-space: pre…):
// the spaces at a line's start are kept. Lines: { segments: [{ codes, font,
// size, color, href, width }], width, size }, a segment a run's piece.
export function wrapRuns(runs, maxWidth, { preserve = false } = {}) {
  const lines = []
  let line = null
  const startLine = (size) => {
    line = { segments: [], width: 0, size }
    lines.push(line)
  }
  const add = (run, codes, width) => {
    const last = line.segments[line.segments.length - 1]
    if (last && last.run === run) {
      last.codes.push(...codes)
      last.width += width
    } else {
      line.segments.push({ run, codes: [...codes], font: fontKey(run), size: run.size ?? BODY_SIZE, color: run.color ?? null, href: run.href ?? null, width })
    }
    line.width += width
    line.size = Math.max(line.size, run.size ?? BODY_SIZE)
  }
  const trimEnd = () => {
    while (line?.segments.length) {
      const last = line.segments[line.segments.length - 1]
      while (last.codes.length && last.codes[last.codes.length - 1] === 32) {
        last.codes.pop()
        const space = measureCodes([32], last.font, last.size)
        last.width -= space
        line.width -= space
      }
      if (last.codes.length) break
      line.segments.pop()
    }
  }
  const hasText = () => line.segments.some((segment) => segment.codes.some((code) => code !== 32))
  const endsWithSpace = () => line.segments[line.segments.length - 1]?.codes.at(-1) === 32

  for (const run of runs) {
    const size = run.size ?? BODY_SIZE
    if (!line) startLine(size)
    if (run.br) {
      trimEnd()
      if (!line.segments.length) line.size = Math.max(line.size, size)
      startLine(size)
      continue
    }
    const font = fontKey(run)
    for (const piece of String(run.text ?? '').split(/( +)/)) {
      if (!piece) continue
      const codes = toPdfCodes(piece)
      if (!codes.length) continue
      const width = measureCodes(codes, font, size)
      if (piece[0] === ' ') {
        // Spaces: not at a wrapped line's start (unless kept, as in <pre>).
        // Nor twice in a row (an emoji left out between two).
        if (!preserve && (!hasText() || endsWithSpace())) continue
        add(run, codes, width)
        continue
      }
      if (line.width + width > maxWidth && hasText()) {
        trimEnd()
        startLine(size)
      }
      if (width <= maxWidth - line.width) {
        add(run, codes, width)
        continue
      }
      // Longer than a line (a URL): cut where it no longer fits.
      let chunk = []
      let chunkWidth = 0
      for (const code of codes) {
        const charWidth = measureCodes([code], font, size)
        if (chunk.length && line.width + chunkWidth + charWidth > maxWidth) {
          add(run, chunk, chunkWidth)
          startLine(size)
          chunk = []
          chunkWidth = 0
        }
        chunk.push(code)
        chunkWidth += charWidth
      }
      if (chunk.length) add(run, chunk, chunkWidth)
    }
  }
  trimEnd()
  // A paragraph ending on a <br> doesn't get an empty last line.
  while (lines.length > 1 && !lines[lines.length - 1].segments.length) lines.pop()
  return lines.map(({ segments, width, size }) => ({ segments: segments.map(({ codes, font, size: segmentSize, color, href, width: segmentWidth }) => ({ codes, font, size: segmentSize, color, href, width: segmentWidth })), width, size }))
}

const formatNumber = (value) => (Math.round(value * 100) / 100).toString()
const rgb = ([r, g, b]) => `${formatNumber(r)} ${formatNumber(g)} ${formatNumber(b)}`
const hexOf = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

// A string for the PDF's info (its title): UTF-16BE, in hex, so nothing in
// it needs escaping.
function pdfTextString(text) {
  let hex = 'FEFF'
  for (let index = 0; index < text.length; index += 1) hex += text.charCodeAt(index).toString(16).padStart(4, '0')
  return `<${hex}>`
}

// A link's target as the PDF holds it: an http(s), mailto or tel URL only,
// percent-encoded to ASCII, in hex.
function pdfLinkTarget(href) {
  if (!/^(?:https?:|mailto:|tel:)/i.test(href)) return null
  try {
    const ascii = /^https?:/i.test(href) ? new URL(href).href : encodeURI(decodeURI(href))
    return `<${hexOf(new TextEncoder().encode(ascii))}>`
  } catch {
    return null
  }
}

// Pages laid out top-down (y from the page's top, in points): each page's
// drawing operators and its links.
class PdfLayout {
  constructor() {
    this.pages = []
    this.images = []
    this.newPage()
  }

  newPage() {
    this.page = { ops: [], links: [] }
    this.pages.push(this.page)
    this.y = MARGIN_TOP
  }

  get atTop() {
    return this.y <= MARGIN_TOP
  }

  // Room for `height` more, else the next page.
  ensure(height) {
    if (!this.atTop && this.y + height > PAGE_HEIGHT - MARGIN_BOTTOM) this.newPage()
  }

  // A gap, none at a page's top.
  space(points) {
    if (!this.atTop) this.y = Math.min(this.y + points, PAGE_HEIGHT - MARGIN_BOTTOM)
  }

  drawText(codes, font, size, color, x, baseline) {
    if (!codes.length) return
    this.page.ops.push(`BT /${font} ${formatNumber(size)} Tf ${rgb(color)} rg 1 0 0 1 ${formatNumber(x)} ${formatNumber(PAGE_HEIGHT - baseline)} Tm <${hexOf(codes)}> Tj ET`)
  }

  drawLine(x1, y1, x2, y2, color, width = 0.75) {
    this.page.ops.push(`${rgb(color)} RG ${formatNumber(width)} w ${formatNumber(x1)} ${formatNumber(PAGE_HEIGHT - y1)} m ${formatNumber(x2)} ${formatNumber(PAGE_HEIGHT - y2)} l S`)
  }

  // A paragraph: `block` { runs, indent, align, preserve, marker, quoteBars,
  // label, labelWidth, spaceBefore }. `label` (the header's « De ») on its
  // first line, its text after `labelWidth`.
  text(block) {
    const labelWidth = block.label ? block.labelWidth : 0
    const indent = Math.min(block.indent ?? 0, CONTENT_WIDTH / 2)
    const left = MARGIN_X + indent + labelWidth
    const width = CONTENT_WIDTH - indent - labelWidth
    const lines = wrapRuns(block.runs, width, { preserve: block.preserve })
    if (!lines.some((line) => line.segments.length)) return
    this.space(block.spaceBefore ?? 0)
    lines.forEach((line, index) => {
      const height = line.size * LINE_HEIGHT
      this.ensure(height)
      const top = this.y
      // Helvetica's ascender and descender (0.718, 0.207 em), centred in the line.
      const baseline = top + (height - 0.925 * line.size) / 2 + 0.718 * line.size
      let x = left
      if (block.align === 'center') x += Math.max(0, (width - line.width) / 2)
      else if (block.align === 'right') x += Math.max(0, width - line.width)
      if (index === 0 && block.label) {
        this.drawText(toPdfCodes(block.label.text), fontKey(block.label), block.label.size, block.label.color, MARGIN_X + indent, baseline)
      }
      if (index === 0 && block.marker) {
        const codes = toPdfCodes(block.marker)
        const markerSize = line.size
        this.drawText(codes, 'F1', markerSize, TEXT_COLOR, left - 5 - measureCodes(codes, 'F1', markerSize), baseline)
      }
      for (const bar of block.quoteBars ?? []) this.drawLine(MARGIN_X + bar, top, MARGIN_X + bar, top + height, RULE_COLOR, 1.5)
      for (const segment of line.segments) {
        this.drawText(segment.codes, segment.font, segment.size, segment.href ? LINK_COLOR : segment.color ?? TEXT_COLOR, x, baseline)
        const target = segment.href ? pdfLinkTarget(segment.href) : null
        if (target) this.page.links.push({ rect: [x, PAGE_HEIGHT - (top + height), x + segment.width, PAGE_HEIGHT - top], target })
        x += segment.width
      }
      this.y += height
    })
  }

  rule(spaceBefore = 6, spaceAfter = 6, color = RULE_COLOR) {
    this.space(spaceBefore)
    this.ensure(1)
    this.drawLine(MARGIN_X, this.y, MARGIN_X + CONTENT_WIDTH, this.y, color, 0.75)
    this.y += spaceAfter
  }

  // A picture ({ bytes, pixelWidth, pixelHeight }, a JPEG) `width` points
  // wide at most, smaller to fit a page.
  image(picture, { width, height, indent = 0, align = 'left', spaceBefore = 0 }) {
    const room = CONTENT_WIDTH - Math.min(indent, CONTENT_WIDTH / 2)
    let drawWidth = Math.min(width, room)
    let drawHeight = drawWidth * (height / width)
    const pageRoom = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
    if (drawHeight > pageRoom) {
      drawWidth *= pageRoom / drawHeight
      drawHeight = pageRoom
    }
    this.space(spaceBefore)
    this.ensure(drawHeight)
    const left = MARGIN_X + Math.min(indent, CONTENT_WIDTH / 2)
    const x = align === 'center' ? left + (room - drawWidth) / 2 : align === 'right' ? left + room - drawWidth : left
    this.images.push(picture)
    const name = `Im${this.images.length}`
    this.page.ops.push(`q ${formatNumber(drawWidth)} 0 0 ${formatNumber(drawHeight)} ${formatNumber(x)} ${formatNumber(PAGE_HEIGHT - this.y - drawHeight)} cm /${name} Do Q`)
    this.y += drawHeight
  }

  // Each page's foot: where the file comes from on the left, « 2 / 5 » on
  // the right when there's more than one page.
  numberPages() {
    const credit = toPdfCodes(PDF_CREDIT)
    this.pages.forEach((page, index) => {
      page.ops.push(`BT /F1 8 Tf ${rgb(MUTED_COLOR)} rg 1 0 0 1 ${formatNumber(MARGIN_X)} ${formatNumber(MARGIN_BOTTOM / 2)} Tm <${hexOf(credit)}> Tj ET`)
      if (this.pages.length < 2) return
      const codes = toPdfCodes(`${index + 1} / ${this.pages.length}`)
      const x = MARGIN_X + CONTENT_WIDTH - measureCodes(codes, 'F1', 8)
      page.ops.push(`BT /F1 8 Tf ${rgb(MUTED_COLOR)} rg 1 0 0 1 ${formatNumber(x)} ${formatNumber(MARGIN_BOTTOM / 2)} Tm <${hexOf(codes)}> Tj ET`)
    })
  }
}

// A content stream deflated where the browser can (CompressionStream's
// « deflate » is zlib's format, FlateDecode's), as is otherwise.
async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

// The file itself (PDF 1.4): catalog, pages, fonts, images, each page's
// content and links, the cross-reference table. Every string from the mail
// is written in hex, so none can break out of its place.
export async function serializePdf({ pages, images = [], title = '', createdAt = new Date() }) {
  const encoder = new TextEncoder()
  const objects = []
  const reserve = () => objects.push(null)
  const set = (number, value) => {
    objects[number - 1] = value
  }
  const add = (value) => objects.push(value)

  reserve() // 1 catalog
  reserve() // 2 pages
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `D:${createdAt.getUTCFullYear()}${pad(createdAt.getUTCMonth() + 1)}${pad(createdAt.getUTCDate())}${pad(createdAt.getUTCHours())}${pad(createdAt.getUTCMinutes())}${pad(createdAt.getUTCSeconds())}Z`
  const info = add(`<< /Title ${pdfTextString(title)} /Producer (Tafac) /CreationDate (${stamp}) >>`)
  const fontRefs = FONTS.map(([key, name]) => `/${key} ${add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)} 0 R`)
  const imageRefs = images.map((picture, index) => `/Im${index + 1} ${add({
    dictionary: `<< /Type /XObject /Subtype /Image /Width ${picture.pixelWidth} /Height ${picture.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
    stream: picture.bytes,
  })} 0 R`)
  const resources = `<< /Font << ${fontRefs.join(' ')} >>${imageRefs.length ? ` /XObject << ${imageRefs.join(' ')} >>` : ''} >>`

  const pageRefs = []
  for (const page of pages) {
    const content = encoder.encode(page.ops.join('\n'))
    const packed = await deflate(content)
    const contentRef = add({ dictionary: `<<${packed ? ' /Filter /FlateDecode' : ''}`, stream: packed ?? content })
    const linkRefs = page.links.map(({ rect, target }) => add(`<< /Type /Annot /Subtype /Link /Rect [${rect.map(formatNumber).join(' ')}] /Border [0 0 0] /A << /S /URI /URI ${target} >> >>`))
    const annots = linkRefs.length ? ` /Annots [${linkRefs.map((ref) => `${ref} 0 R`).join(' ')}]` : ''
    pageRefs.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${contentRef} 0 R${annots} >>`))
  }
  set(1, '<< /Type /Catalog /Pages 2 0 R >>')
  set(2, `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`)

  const chunks = [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]
  let length = chunks[0].length
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    chunks.push(bytes)
    length += bytes.length
  }
  const offsets = []
  objects.forEach((value, index) => {
    offsets.push(length)
    if (typeof value === 'string') {
      push(`${index + 1} 0 obj\n${value}\nendobj\n`)
    } else {
      push(`${index + 1} 0 obj\n${value.dictionary} /Length ${value.stream.length} >>\nstream\n`)
      push(value.stream)
      push('\nendstream\nendobj\n')
    }
  })
  const xref = length
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`)
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const file = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    file.set(chunk, offset)
    offset += chunk.length
  }
  return file
}

// —— Reading the laid-out mail ——

const SKIPPED_TAGS = new Set(['style', 'script', 'head', 'title', 'meta', 'link', 'template', 'noscript', 'svg', 'video', 'audio', 'iframe', 'object'])
const BLOCK_DISPLAY = /^(?:block|flow-root|flex|grid|list-item|table|table-row-group|table-header-group|table-footer-group|table-caption|-webkit-box)$/
const COMPLEX_CELL = 'img,table,p,div,ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote,pre,hr,br'
const CELL_GAP = '    '

// rgb()/rgba() as 0–1 components, a colour too pale for white paper (white
// text on a coloured button, its background gone) as the text's.
function readColor(value) {
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value ?? '')
  if (!match) return null
  const [r, g, b] = match.slice(1, 4).map((part) => Math.min(255, Number(part)) / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.72 ? null : [r, g, b]
}

// What the reader's frame would hide: preview texts (display: none, a
// collapsed box), invisible text.
function isHidden(style) {
  if (style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return true
  if (parseFloat(style.fontSize) < 1) return true
  const collapsed = style.maxHeight === '0px' || style.height === '0px' || style.maxWidth === '0px' || style.width === '0px'
  return collapsed && style.overflow === 'hidden'
}

const marginOf = (value) => Math.min(14, Math.max(0, (parseFloat(value) || 0) * PX_TO_PT))

// The body's blocks, in order: { type: 'text', runs, indent, align,
// preserve, marker, quoteBars, spaceBefore }, { type: 'image', element,
// width, height, … } and { type: 'rule' }. `win`: the frame's window (its
// computed styles).
export function collectBlocks(root, win) {
  const blocks = []
  let paragraph = null
  let pendingSpace = 0

  const flush = () => {
    if (paragraph && paragraph.runs.some((run) => !run.br && /\S/.test(run.text))) blocks.push(paragraph)
    paragraph = null
  }
  const open = (context) => {
    if (!paragraph) {
      const marker = context.marker && !context.marker.used ? context.marker : null
      if (marker) marker.used = true
      paragraph = { type: 'text', runs: [], indent: context.indent, align: context.align, preserve: context.preserve, marker: marker?.text ?? null, quoteBars: context.quoteBars, spaceBefore: pendingSpace }
      pendingSpace = 0
    }
    return paragraph
  }
  const lastEndsWithSpace = () => {
    const last = paragraph?.runs[paragraph.runs.length - 1]
    return !last || last.br || /\s$/.test(last.text)
  }

  const visitText = (node, context) => {
    let text = node.data
    if (context.preserve) {
      text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').forEach((part, index) => {
        if (index) open(context).runs.push({ br: true, size: context.style.size })
        if (part) open(context).runs.push({ ...context.style, text: part })
      })
      return
    }
    text = text.replace(/[\t\n\r\f ]+/g, ' ')
    if (!paragraph || lastEndsWithSpace()) text = text.replace(/^ /, '')
    if (!text) return
    open(context).runs.push({ ...context.style, text })
  }

  const visitElement = (element, context) => {
    const tag = element.localName
    if (SKIPPED_TAGS.has(tag)) return
    const style = win.getComputedStyle(element)
    if (style.display === 'none' || isHidden(style)) return

    if (tag === 'br') {
      open(context).runs.push({ br: true, size: context.style.size })
      return
    }
    if (tag === 'img') {
      // Remote images have no source in the frame: never there.
      const box = element.getBoundingClientRect()
      if (!element.getAttribute('src') || !element.complete || !element.naturalWidth || box.width < 16 || box.height < 16) return
      flush()
      blocks.push({ type: 'image', element, width: box.width * PX_TO_PT, height: box.height * PX_TO_PT, indent: context.indent, align: context.align, spaceBefore: Math.max(pendingSpace, 4) })
      pendingSpace = 4
      return
    }
    if (tag === 'hr') {
      flush()
      blocks.push({ type: 'rule' })
      pendingSpace = 0
      return
    }

    const size = Math.min(20, Math.max(7, (parseFloat(style.fontSize) || 14) * PX_TO_PT))
    const href = tag === 'a' && element.getAttribute('href') && !element.getAttribute('href').startsWith('#') ? element.getAttribute('href') : context.style.href
    const next = {
      ...context,
      style: {
        bold: (parseInt(style.fontWeight, 10) || 400) >= 600,
        italic: style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique'),
        mono: /mono|courier|consolas|menlo/i.test(style.fontFamily),
        size,
        color: readColor(style.color),
        href,
      },
      preserve: /^(?:pre|pre-wrap|pre-line|break-spaces)$/.test(style.whiteSpace),
    }
    let display = style.display
    if (display === 'table-row') {
      // A row of short cells (a table of values) reads on one line; a
      // layout's row (blocks, pictures) cell after cell.
      const cells = [...element.children].filter((cell) => cell.localName === 'td' || cell.localName === 'th')
      next.inlineCells = cells.length > 1 && cells.every((cell) => !cell.querySelector(COMPLEX_CELL) && cell.textContent.trim().length <= 80)
      display = 'block'
    } else if (display === 'table-cell') {
      if (context.inlineCells) {
        if (element.textContent.trim() && paragraph && !lastEndsWithSpace()) open(context).runs.push({ ...next.style, href: null, text: CELL_GAP })
        display = 'inline'
      } else {
        display = 'block'
      }
      next.inlineCells = false
    }
    const isBlock = BLOCK_DISPLAY.test(display)
    if (isBlock) {
      next.align = /center/.test(style.textAlign) ? 'center' : /right|end/.test(style.textAlign) ? 'right' : 'left'
      if (tag === 'ul' || tag === 'ol') next.indent = context.indent + 18
      if (tag === 'blockquote') {
        next.quoteBars = [...context.quoteBars, context.indent + 3]
        next.indent = context.indent + 14
      }
      if (display === 'list-item' && style.listStyleType !== 'none') {
        const parent = element.parentElement
        const ordered = parent?.localName === 'ol'
        const index = ordered ? [...parent.children].filter((item) => item.localName === 'li').indexOf(element) + (Number(parent.getAttribute('start')) || 1) : 0
        next.marker = { text: ordered ? `${index}.` : '•', used: false }
      }
      flush()
      pendingSpace = Math.max(pendingSpace, marginOf(style.marginTop))
    }
    for (const child of element.childNodes) {
      if (child.nodeType === 3) visitText(child, next)
      else if (child.nodeType === 1) visitElement(child, next)
    }
    if (isBlock) {
      flush()
      pendingSpace = Math.max(pendingSpace, marginOf(style.marginBottom))
    }
  }

  const rootStyle = win.getComputedStyle(root)
  const context = {
    style: { bold: false, italic: false, mono: false, size: Math.min(20, Math.max(7, (parseFloat(rootStyle.fontSize) || 14) * PX_TO_PT)), color: null, href: null },
    indent: 0,
    align: 'left',
    preserve: false,
    quoteBars: [],
    marker: null,
    inlineCells: false,
  }
  for (const child of root.childNodes) {
    if (child.nodeType === 3) visitText(child, context)
    else if (child.nodeType === 1) visitElement(child, context)
  }
  flush()
  return blocks
}

// An <img> of the frame as a JPEG for the PDF (white under transparency),
// at twice its printed size at most. Null when it can't be read.
async function rasterize(image, widthPoints) {
  const scale = Math.min(1, (widthPoints / PX_TO_PT) * 2 / image.naturalWidth)
  const pixelWidth = Math.max(1, Math.round(image.naturalWidth * scale))
  const pixelHeight = Math.max(1, Math.round(image.naturalHeight * scale))
  if (pixelWidth * pixelHeight > 16_000_000) return null
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#fff'
  context.fillRect(0, 0, pixelWidth, pixelHeight)
  try {
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), pixelWidth, pixelHeight } : null
  } catch {
    return null
  }
}

// One mail's header, as the printout's (describePrintedMail): the subject,
// then « De », « À »… in a column, the attachments one a line, a hairline.
function layoutHeader(layout, message, draft) {
  const { subject, rows, attachments } = describePrintedMail(message, { draft })
  layout.text({ runs: [{ text: subject, bold: true, size: 15 }], spaceBefore: 0 })
  layout.space(6)
  const labels = [...rows.map((row) => row.label), ...(attachments.length ? ['Pièces jointes'] : [])]
  const labelWidth = Math.max(...labels.map((label) => measureCodes(toPdfCodes(label), 'F2', 9.5))) + 10
  const row = (label, runs) => layout.text({ runs, label: { text: label, bold: true, size: 9.5, color: MUTED_COLOR }, labelWidth })
  for (const { label, value } of rows) row(label, [{ text: value, size: 9.5 }])
  if (attachments.length) {
    row('Pièces jointes', attachments.flatMap((name, index) => [...(index ? [{ br: true, size: 9.5 }] : []), { text: name, size: 9.5 }]))
  }
  layout.rule(8, 14)
}

// The PDF of `mails` ([{ message, draft, body }], oldest first; `body`: the
// mail's body element in the laid-out print frame, `win` that frame's
// window), each mail from a new page. A Blob.
export async function createMailPdf(mails, win, { title = '' } = {}) {
  const layout = new PdfLayout()
  for (const [index, { message, draft, body }] of mails.entries()) {
    if (index) layout.newPage()
    layoutHeader(layout, message, draft)
    for (const block of body ? collectBlocks(body, win) : []) {
      if (block.type === 'text') {
        layout.text(block)
      } else if (block.type === 'rule') {
        layout.rule(10, 10)
      } else {
        const picture = await rasterize(block.element, Math.min(block.width, CONTENT_WIDTH))
        if (picture) layout.image(picture, block)
      }
    }
    if (message.truncated) {
      layout.space(10)
      layout.text({ runs: [{ text: 'Mail trop long, la suite est dans le webmail', size: 9, color: MUTED_COLOR }] })
    }
  }
  layout.numberPages()
  const bytes = await serializePdf({ pages: layout.pages, images: layout.images, title })
  return new Blob([bytes], { type: 'application/pdf' })
}
