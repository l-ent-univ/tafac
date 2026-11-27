import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { FALLBACK_MESSAGE_LIMIT_BYTES, HARD_ATTACHMENT_LIMIT_BYTES, MAX_ATTACHMENTS, attachmentReferences, attachmentsTotalSize, checkNewAttachments, deriveAttachmentLimits, messageAttachmentItems, normalizeAttachmentType, readAttachmentLimits, sanitizeAttachmentName } from '../src/mailAttachments.js'
import { buildDraftFields } from '../src/mailCompose.js'

const MB = 1024 * 1024

test('file names: no folder, no control or bidi character, capped with their extension', () => {
  assert.equal(sanitizeAttachmentName('C:\\Users\\camille\\Documents\\CV.pdf'), 'CV.pdf')
  assert.equal(sanitizeAttachmentName('../../etc/passwd'), 'passwd')
  assert.equal(sanitizeAttachmentName('rapport\u202Efdp.exe'), 'rapportfdp.exe')
  assert.equal(sanitizeAttachmentName('a\r\nContent-Type: x.txt'), 'aContent-Type_ x.txt')
  assert.equal(sanitizeAttachmentName('  notes   de   cours .pdf  '), 'notes de cours .pdf')
  assert.equal(sanitizeAttachmentName('que"stion*?.txt'), 'que_stion__.txt')
  assert.equal(sanitizeAttachmentName('...'), 'piece-jointe')
  assert.equal(sanitizeAttachmentName(''), 'piece-jointe')
  assert.equal(sanitizeAttachmentName(null), 'piece-jointe')
  assert.equal(sanitizeAttachmentName('Été – compte rendu.docx'), 'Été – compte rendu.docx')
  const long = sanitizeAttachmentName(`${'é'.repeat(400)}.pdf`)
  assert.equal(Array.from(long).length, 180)
  assert.ok(long.endsWith('.pdf'))
  // Emoji aren't cut in half.
  const emoji = sanitizeAttachmentName('😀'.repeat(200))
  assert.equal(Array.from(emoji).length, 180)
  assert.ok(Array.from(emoji).every((char) => char === '😀'))
})

test('content types: type/subtype lowercased, else a stream of bytes', () => {
  assert.equal(normalizeAttachmentType('Application/PDF'), 'application/pdf')
  assert.equal(normalizeAttachmentType('text/plain; charset=utf-8'), 'text/plain')
  assert.equal(normalizeAttachmentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(normalizeAttachmentType(''), 'application/octet-stream')
  assert.equal(normalizeAttachmentType('text/html\r\nX: y'), 'application/octet-stream')
  assert.equal(normalizeAttachmentType('<script>'), 'application/octet-stream')
})

test('limits: the mail size less base64 and room for the text, a hard cap, a fallback', () => {
  const ten = deriveAttachmentLimits(10 * MB)
  assert.equal(ten.known, true)
  assert.equal(ten.maxFileBytes, ten.maxTotalBytes)
  assert.ok(ten.maxTotalBytes > 7 * MB && ten.maxTotalBytes < 7.5 * MB, String(ten.maxTotalBytes))
  // Unknown or « no limit »: the fallback.
  for (const value of [null, undefined, -1, 0, 'abc', 1000]) {
    const limits = deriveAttachmentLimits(value)
    assert.equal(limits.known, false)
    assert.equal(limits.messageLimitBytes, FALLBACK_MESSAGE_LIMIT_BYTES)
  }
  assert.equal(deriveAttachmentLimits(1024 * MB).maxFileBytes, HARD_ATTACHMENT_LIMIT_BYTES)
  // What the page is told is checked again there.
  assert.deepEqual(readAttachmentLimits({ maxFileBytes: 5 * MB, maxTotalBytes: 6 * MB }), { maxFileBytes: 5 * MB, maxTotalBytes: 6 * MB })
  assert.deepEqual(readAttachmentLimits({ maxFileBytes: -1, maxTotalBytes: 'x' }), { maxFileBytes: deriveAttachmentLimits(null).maxFileBytes, maxTotalBytes: deriveAttachmentLimits(null).maxTotalBytes })
  assert.equal(readAttachmentLimits({ maxFileBytes: 10 ** 12, maxTotalBytes: 10 ** 12 }).maxFileBytes, HARD_ATTACHMENT_LIMIT_BYTES)
})

test('files are refused before they go: empty, too large, past the mail, too many', () => {
  const limits = { maxFileBytes: 10 * MB, maxTotalBytes: 12 * MB }
  const current = [
    { key: 'message:1:2', source: 'message', size: 3 * MB, status: 'ready' },
    // Refused ones take no room.
    { key: 'upload:1', source: 'upload', size: 40 * MB, status: 'error', error: 'too-large' },
  ]
  assert.equal(attachmentsTotalSize(current), 3 * MB)
  assert.deepEqual(
    checkNewAttachments([{ size: 0 }, { size: 11 * MB }, { size: 6 * MB }, { size: 4 * MB }, { size: 2 * MB }], current, limits),
    ['empty', 'too-large', null, 'total', null],
  )
  const full = Array.from({ length: MAX_ATTACHMENTS }, (_, index) => ({ key: `upload:${index}`, size: 1, status: 'ready' }))
  assert.deepEqual(checkNewAttachments([{ size: 1 }], full, limits), ['too-many'])
  // One that failed on the way still counts (it's retried).
  assert.equal(attachmentsTotalSize([{ size: 5, status: 'error', error: 'failed' }]), 5)
})

test('a forward carries its attachments by reference, a reply none', () => {
  const message = {
    id: '4211',
    subject: 'Sujet',
    from: { name: 'Prof', email: 'prof@univ.fr' },
    to: [],
    cc: [],
    attachments: [
      { part: '2', name: 'sujet.pdf', type: 'application/pdf', size: 1200, href: '/__ent_auth/mail/part?id=4211&part=2&download=1' },
      { part: '3.1', name: '../x\u202e.png', type: 'IMAGE/PNG', size: null },
      { part: 'bad part', name: 'x', type: 'text/plain', size: 3 },
    ],
  }
  const items = messageAttachmentItems(message)
  assert.deepEqual(items, [
    { key: 'message:4211:2', source: 'message', messageId: '4211', part: '2', name: 'sujet.pdf', size: 1200, contentType: 'application/pdf', status: 'ready' },
    { key: 'message:4211:3.1', source: 'message', messageId: '4211', part: '3.1', name: 'x.png', size: null, contentType: 'image/png', status: 'ready' },
  ])
  assert.deepEqual(buildDraftFields('forward', message).attachments, items)
  assert.deepEqual(buildDraftFields('reply', message).attachments, [])
  assert.deepEqual(messageAttachmentItems({ attachments: message.attachments }), [])
  // What a send will be given: references, the ready ones only.
  assert.deepEqual(attachmentReferences([
    ...items.slice(0, 1),
    { key: 'upload:1', source: 'upload', aid: 'abcdefgh:1', status: 'ready' },
    { key: 'upload:2', source: 'upload', status: 'uploading' },
  ]), [{ source: 'message', messageId: '4211', part: '2' }, { source: 'upload', aid: 'abcdefgh:1' }])
})

// The relay against a stand-in for Partage's servlet: the file reaches it
// while it's still being sent (the second chunk only goes once the first
// has arrived there: a relay buffering the file would never finish).
// The route itself, on the demo account (which reads the file and drops it).