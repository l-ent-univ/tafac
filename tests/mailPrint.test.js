import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPrintCsp,
  buildPrintDocument,
  describePrintedMail,
  escapeHtml,
  formatPrintAddress,
  formatPrintDate,
  getPdfFileName,
} from '../src/mailPrintDocument.js'
import { measureCodes, serializePdf, toPdfCodes, wrapRuns } from '../src/mailPdf.js'

const ORIGIN = 'https://tafac.fr'
const char = (point) => String.fromCodePoint(point)

const sampleMessage = {
  id: '42',
  subject: 'R5.11 – Rendu du TP',
  from: { name: 'Camille Martin', email: 'camille.martin@univ.fr' },
  replyTo: null,
  to: [{ name: 'Lou', email: 'lou@etudiant.univ.fr' }, { name: '', email: 'promo@univ.fr' }],
  cc: [],
  receivedAt: '2026-10-28T13:05:00.000Z',
  format: 'html',
  html: '<div class="tafac-mail-body"><p>Bonjour <img data-remote-src="https://tracker.example/x.png"></p></div>',
  remoteImages: 1,
  truncated: false,
  attachments: [{ part: '2', name: 'Consignes.pdf', type: 'application/pdf', size: 248_312, href: '/x' }],
}

test('formatPrintAddress writes the name and the address', () => {
  assert.equal(formatPrintAddress({ name: 'Camille Martin', email: 'camille.martin@univ.fr' }), 'Camille Martin <camille.martin@univ.fr>')
  assert.equal(formatPrintAddress({ name: 'a@b.fr', email: 'a@b.fr' }), 'a@b.fr')
  assert.equal(formatPrintAddress({ name: 'Scolarité', email: null }), 'Scolarité')
  assert.equal(formatPrintAddress(null), '')
})

test('formatPrintDate writes the date in full, in French', () => {
  const written = formatPrintDate('2026-10-28T13:05:00.000Z')
  assert.match(written, /^mercredi 28 octobre 2026 à \d{2}:05$/)
  assert.equal(formatPrintDate(null), null)
  assert.equal(formatPrintDate('not a date'), null)
})

test('describePrintedMail lists the header rows and the attachments', () => {
  const { subject, rows, attachments } = describePrintedMail(sampleMessage)
  assert.equal(subject, 'R5.11 – Rendu du TP')
  assert.deepEqual(rows.map((row) => row.label), ['De', 'À', 'Date'])
  assert.equal(rows[1].value, 'Lou <lou@etudiant.univ.fr>, promo@univ.fr')
  assert.deepEqual(attachments, ['Consignes.pdf (242 Ko)'])
  assert.equal(describePrintedMail({ ...sampleMessage, subject: '  ' }).subject, '(Sans objet)')
  const draft = describePrintedMail(sampleMessage, { draft: true })
  assert.equal(draft.rows.find((row) => row.label === 'Date').value, 'Brouillon, pas encore envoyé')
  const replyTo = describePrintedMail({ ...sampleMessage, replyTo: { name: 'Secrétariat', email: 'secretariat@univ.fr' } })
  assert.ok(replyTo.rows.some((row) => row.label === 'Répondre à' && row.value === 'Secrétariat <secretariat@univ.fr>'))
})

test('buildPrintDocument escapes the header and keeps remote images held back', () => {
  const hostile = {
    ...sampleMessage,
    subject: '<script>alert(1)</script> & "co"',
    from: { name: '<img src=x onerror=alert(1)>', email: 'x@y.fr' },
    attachments: [{ part: '2', name: '<b>pwn</b>.pdf', size: 10 }],
  }
  const html = buildPrintDocument([{ message: hostile, draft: false }, { message: sampleMessage, draft: false }], { origin: ORIGIN })
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('<img src=x'))
  assert.ok(!html.includes('<b>pwn</b>'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;co&quot;'))
  assert.match(html, /<title>&lt;script&gt;/)
  // The body as the server cleaned it: the remote image without a source.
  assert.ok(html.includes('<img data-remote-src="https://tracker.example/x.png">'))
  assert.ok(!/<img[^>]* src=/.test(html.replace('<img src=x', '')))
  // The CSP: images from data: and the part proxy only, no scripts.
  assert.ok(html.includes(`img-src data: ${ORIGIN}/__ent_auth/mail/part;`))
  assert.ok(!/https:(?! \/\/)/.test(buildPrintCsp(ORIGIN).replace(ORIGIN, '')))
  assert.ok(buildPrintCsp(ORIGIN).startsWith("default-src 'none'"))
  // Two mails, two articles (the second on a new page).
  assert.equal(html.match(/<article class="tafac-print-mail">/g).length, 2)
  assert.match(html, /\.tafac-print-mail\+\.tafac-print-mail\{break-before:page\}/)
})

test('buildPrintDocument says when a mail has no text or was cut', () => {
  const html = buildPrintDocument([{ message: { ...sampleMessage, html: '', truncated: true }, draft: false }], { origin: ORIGIN })
  assert.ok(html.includes('Ce mail n’a pas de texte'))
  assert.ok(html.includes('Mail trop long, la suite est dans le webmail'))
  assert.equal(escapeHtml(`<a href="x">'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;')
})

test('getPdfFileName names the file after the subject', () => {
  assert.equal(getPdfFileName('R5.11 – Rendu du TP'), 'R5.11 – Rendu du TP.pdf')
  assert.equal(getPdfFileName('RE: TR : Re: Fwd: Planning S5'), 'Planning S5.pdf')
  assert.equal(getPdfFileName('Notes 2025/2026 : "S5" <final>?'), 'Notes 2025-2026 - S5 - final.pdf')
  assert.equal(getPdfFileName('..hidden.'), 'hidden.pdf')
  assert.equal(getPdfFileName('a\\b|c'), 'a-b - c.pdf')
  assert.equal(getPdfFileName(`a${char(0x202e)}fdp.exe${char(0)}`), 'afdp.exe.pdf')
  assert.equal(getPdfFileName(''), 'Mail.pdf')
  assert.equal(getPdfFileName('   '), 'Mail.pdf')
  assert.equal(getPdfFileName(null), 'Mail.pdf')
  const long = getPdfFileName('Réunion '.repeat(30))
  assert.ok(long.length <= 84)
  assert.ok(long.endsWith('Réunion.pdf'))
})

test('toPdfCodes keeps French text and drops what the fonts can’t draw', () => {
  const codes = toPdfCodes('L’été « œuvre » – 12 €')
  assert.deepEqual(codes, [0x4c, 0x92, 0xe9, 0x74, 0xe9, 0x20, 0xab, 0x20, 0x9c, 0x75, 0x76, 0x72, 0x65, 0x20, 0xbb, 0x20, 0x96, 0x20, 0x31, 0x32, 0x20, 0x80])
  // A narrow no-break space as a space, emoji and zero-width marks gone.
  assert.deepEqual(toPdfCodes(`Note${char(0x202f)}:`), [0x4e, 0x6f, 0x74, 0x65, 0x20, 0x3a])
  assert.deepEqual(toPdfCodes(`ok${char(0x1f600)}${char(0x200b)}!`), [0x6f, 0x6b, 0x21])
  // A decomposed accent composed, a foreign letter unaccented, the rest as ?.
  assert.deepEqual(toPdfCodes(`e${char(0x301)}`), [0xe9])
  assert.deepEqual(toPdfCodes(char(0x151)), [0x6f])
  assert.deepEqual(toPdfCodes(char(0x6f22)), [0x3f])
})

test('wrapRuns cuts at spaces and keeps runs apart', () => {
  const size = 10
  const space = measureCodes([32], 'F1', size)
  const word = measureCodes(toPdfCodes('mot'), 'F1', size)
  const runs = [{ text: 'mot mot mot', size }, { text: ' gras', bold: true, size }]
  const lines = wrapRuns(runs, word * 2 + space + 0.1)
  assert.equal(lines.length, 3)
  assert.equal(lines[0].segments.length, 1)
  assert.deepEqual(lines[0].segments[0].codes, toPdfCodes('mot mot'))
  // No space carried to the start of the next line.
  assert.deepEqual(lines[1].segments[0].codes, toPdfCodes('mot'))
  assert.equal(lines[2].segments[0].font, 'F2')
  assert.deepEqual(lines[2].segments[0].codes, toPdfCodes('gras'))
  // A line break, a word longer than a line.
  const broken = wrapRuns([{ text: 'a', size }, { br: true, size }, { text: 'b'.repeat(40), size }], word * 3)
  assert.ok(broken.length > 2)
  assert.ok(broken.every((line) => line.width <= word * 3 + 0.01))
  // <pre>: leading spaces kept.
  const pre = wrapRuns([{ text: '  code', mono: true, size }], 500, { preserve: true })
  assert.deepEqual(pre[0].segments[0].codes, toPdfCodes('  code'))
  assert.equal(pre[0].segments[0].font, 'F5')
})

test('serializePdf writes a well-formed file, the text in hex', async () => {
  const bytes = await serializePdf({
    pages: [
      { ops: [`BT /F1 12 Tf 1 0 0 1 48 800 Tm <${toPdfCodes('(Été) \\ ok').map((code) => code.toString(16).padStart(2, '0')).join('')}> Tj ET`], links: [{ rect: [48, 790, 100, 805], target: '<68747470733a2f2f7461666163>' }] },
      { ops: [], links: [] },
    ],
    title: 'R5.11 – (Rendu)',
    createdAt: new Date('2026-10-28T13:05:00Z'),
  })
  const text = new TextDecoder('latin1').decode(bytes)
  assert.ok(text.startsWith('%PDF-1.4\n'))
  assert.ok(text.trimEnd().endsWith('%%EOF'))
  assert.match(text, /\/Type \/Pages \/Kids \[\d+ 0 R \d+ 0 R\] \/Count 2/)
  assert.match(text, /\/Subtype \/Link/)
  assert.match(text, /\/CreationDate \(D:20261028130500Z\)/)
  // The title as UTF-16 in hex: no parenthesis of it in the file.
  assert.ok(!text.includes('(Rendu)'))
  // Every cross-reference points at its object.
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1])
  assert.ok(text.slice(xrefAt).startsWith('xref\n'))
  const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]))
  assert.ok(entries.length > 8)
  entries.forEach((offset, index) => assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj\n`), `object ${index + 1}`))
})
