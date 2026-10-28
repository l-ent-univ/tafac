import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import http from 'node:http'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import {
  UploadTooLargeError,
  buildZimbraUploadDisposition,
  createUploadByteCounter,
  createUploadLimiter,
  parseZimbraUploadResponse,
  readContentLength,
  sendToZimbraUpload,
} from '../server/mailUpload.js'
import { readContentDispositionFilename } from '../server/mailMessage.js'
import {
  FALLBACK_MESSAGE_LIMIT_BYTES,
  HARD_ATTACHMENT_LIMIT_BYTES,
  MAX_ATTACHMENTS,
  attachmentReferences,
  attachmentsTotalSize,
  buildUploadDisposition,
  checkNewAttachments,
  deriveAttachmentLimits,
  messageAttachmentItems,
  normalizeAttachmentType,
  readAttachmentLimits,
  sanitizeAttachmentName,
} from '../src/mailAttachments.js'
import { buildDraftFields } from '../src/mailCompose.js'
import { loadServerConfig } from '../universities/index.js'

const MB = 1024 * 1024

test('the upload servlet answer: its id, name, type and size, checked', () => {
  const ok = parseZimbraUploadResponse(`200,'null',[{"aid":"4f6e1c2a-0b7d-4c8e-9a51-2f3e4d5c6b7a:9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f","ct":"application/pdf","filename":"Rapport final.pdf","s":48213}]\n`)
  assert.deepEqual(ok, {
    status: 200,
    uploads: [{
      aid: '4f6e1c2a-0b7d-4c8e-9a51-2f3e4d5c6b7a:9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
      name: 'Rapport final.pdf',
      size: 48213,
      contentType: 'application/pdf',
    }],
  })
  // Refusals carry no list.
  assert.deepEqual(parseZimbraUploadResponse("413,'null'"), { status: 413, uploads: [] })
  assert.deepEqual(parseZimbraUploadResponse("401,'null'\r\n"), { status: 401, uploads: [] })
  // A request id that holds an escaped quote.
  assert.equal(parseZimbraUploadResponse(`200,'a\\'b',[{"aid":"abcdefgh:1234","ct":"text/plain","filename":"a.txt","s":3}]`).uploads[0].aid, 'abcdefgh:1234')
  // A made-up id, a hostile name and type are cleaned or dropped.
  const odd = parseZimbraUploadResponse(`200,'null',[{"aid":"../../etc","ct":"text/html; x","filename":"a"},{"aid":"abcdefgh:5678","ct":"<script>","filename":"..\\\\evil\\u202egpj.exe","s":-1}]`)
  assert.deepEqual(odd.uploads, [{ aid: 'abcdefgh:5678', name: 'evilgpj.exe', size: null, contentType: 'application/octet-stream' }])
  // Not the servlet's format (an html page, nothing, broken JSON).
  assert.equal(parseZimbraUploadResponse('<html><body>Error</body></html>'), null)
  assert.equal(parseZimbraUploadResponse(''), null)
  assert.equal(parseZimbraUploadResponse("200,'null',[{"), null)
  assert.equal(parseZimbraUploadResponse("200,'null',{}"), null)
})

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

test('the name travels as RFC 5987 to the server, as entities to Partage', () => {
  const header = buildUploadDisposition('Été & co "final".pdf')
  assert.equal(header, "attachment; filename*=UTF-8''%C3%89t%C3%A9%20%26%20co%20_final_.pdf")
  assert.equal(readContentDispositionFilename(header), 'Été & co _final_.pdf')
  assert.equal(buildZimbraUploadDisposition('Été & co.pdf'), 'attachment; filename="&#201;t&#233; &#38; co.pdf"')
  assert.equal(buildZimbraUploadDisposition('a\\b;c.txt'), 'attachment; filename="b&#59;c.txt"')
  // ASCII only: fits any header.
  assert.match(buildZimbraUploadDisposition('日本語 😀.png'), /^[\x20-\x7e]+$/)
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

test('the declared length: digits only', () => {
  assert.equal(readContentLength('1234'), 1234)
  assert.equal(readContentLength(' 0 '), 0)
  for (const value of [undefined, '', '-1', '1e6', '12, 12', '0x10', '9'.repeat(16)]) assert.equal(readContentLength(value), null)
})

test('the upload limiter: per minute, bytes per hour, at once, per session', () => {
  const limiter = createUploadLimiter({ perMinute: 3, bytesPerHour: 100, concurrent: 2 })
  const start = 1_000_000
  const first = limiter.take('a', 10, start)
  const second = limiter.take('a', 10, start)
  assert.ok(first.ok && second.ok)
  assert.deepEqual(limiter.take('a', 10, start), { ok: false, retryAfter: 5 })
  // Another session has its own.
  assert.ok(limiter.take('b', 10, start).ok)
  first.settle(10)
  second.settle(10)
  assert.ok(limiter.take('a', 10, start + 1000).settle)
  const blocked = limiter.take('a', 10, start + 2000)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.retryAfter, 58)
  // Past the minute, the bytes of the hour still count.
  const later = start + 61_000
  const big = limiter.take('a', 75, later)
  assert.equal(big.ok, false)
  assert.ok(big.retryAfter > 3000 && big.retryAfter <= 3600, String(big.retryAfter))
  // A cancelled upload counts what came, not what was declared.
  const cancelled = limiter.take('c', 90, start)
  cancelled.settle(5)
  cancelled.settle(90)
  assert.ok(limiter.take('c', 90, start + 1).ok)
})

test('the byte counter fails past its limit', async () => {
  const seen = []
  const counter = createUploadByteCounter(8, (total) => seen.push(total))
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5))
      controller.enqueue(new Uint8Array(5))
      controller.close()
    },
  })
  const reader = source.pipeThrough(counter).getReader()
  assert.equal((await reader.read()).value.byteLength, 5)
  await assert.rejects(reader.read(), UploadTooLargeError)
  assert.deepEqual(seen, [5])
})

// The relay against a stand-in for Partage's servlet: the file reaches it
// while it's still being sent (the second chunk only goes once the first
// has arrived there: a relay buffering the file would never finish).
test('the relay streams the file to the servlet, as the Zimbra web client sends it', async () => {
  let firstChunkArrived
  const arrived = new Promise((resolve) => {
    firstChunkArrived = resolve
  })
  let seen = null
  const servlet = http.createServer((req, res) => {
    let bytes = 0
    req.on('data', (chunk) => {
      bytes += chunk.length
      firstChunkArrived()
    })
    req.on('end', () => {
      seen = { url: req.url, headers: req.headers, bytes }
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`200,'null',[{"aid":"abcdef12-0000:aaaa-bbbb","ct":"${req.headers['content-type']}","filename":"Été.pdf","s":${bytes}}]\n`)
    })
  })
  await new Promise((resolve) => servlet.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${servlet.address().port}`
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(new Uint8Array(1024))
      await arrived
      controller.enqueue(new Uint8Array(2048))
      controller.close()
    },
  })
  try {
    const result = await sendToZimbraUpload({
      send: (url, init) => fetch(url, init),
      origin,
      csrfToken: 'token-123',
      body,
      length: 3072,
      name: 'Été.pdf',
      contentType: 'Application/PDF',
      signal: AbortSignal.timeout(5000),
    })
    assert.deepEqual(result, { httpStatus: 200, parsed: { status: 200, uploads: [{ aid: 'abcdef12-0000:aaaa-bbbb', name: 'Été.pdf', size: 3072, contentType: 'application/pdf' }] } })
    assert.equal(seen.url, '/service/upload?fmt=raw,extended')
    assert.equal(seen.bytes, 3072)
    assert.equal(seen.headers['content-length'], '3072')
    assert.equal(seen.headers['transfer-encoding'], undefined)
    assert.equal(seen.headers['content-type'], 'application/pdf')
    assert.equal(seen.headers['content-disposition'], 'attachment; filename="&#201;t&#233;.pdf"')
    assert.equal(seen.headers['x-zimbra-csrf-token'], 'token-123')
    assert.equal(seen.headers['x-requested-with'], 'XMLHttpRequest')
  } finally {
    servlet.close()
  }
})

// The route itself, on the demo account (which reads the file and drops it).
async function withApp(run) {
  const config = await loadServerConfig('univ-rennes')
  const app = createEntAuthApp(config, { analytics: {}, session: { secret: 'a'.repeat(44), production: false } })
  const server = app.listen(0)
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const signIn = async () => {
    const response = await fetch(`${base}/__ent_auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
    })
    return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  }
  try {
    await run({ base, port, signIn })
  } finally {
    server.close()
  }
}

const upload = (base, cookie, body, headers = {}) => fetch(`${base}/__ent_auth/mail/upload`, {
  method: 'POST',
  headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/pdf', 'Content-Disposition': buildUploadDisposition('Été.pdf'), ...headers },
  body,
  ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
})

test('the upload route: refusals before the body, a demo upload, its own limits', () => withApp(async ({ base, port, signIn }) => {
  const cookie = await signIn()
  assert.equal((await upload(base, null, new Uint8Array(10))).status, 401)
  assert.equal((await upload(base, cookie, new Uint8Array(10), { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  // A streamed body without a length (chunked).
  const chunked = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(10))
      controller.close()
    },
  })
  assert.equal((await upload(base, cookie, chunked)).status, 411)
  assert.equal((await upload(base, cookie, new Uint8Array(0))).status, 400)

  // Too large: refused on its declared length, before a byte is read (the
  // connection closes, the client never has to send the rest).
  const declared = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/__ent_auth/mail/upload',
      headers: { cookie, 'Content-Type': 'application/zip', 'Content-Length': String(40 * MB) },
    }, (response) => {
      let text = ''
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, connection: response.headers.connection, body: JSON.parse(text) }))
    })
    request.on('error', reject)
    request.write(Buffer.alloc(64 * 1024))
  })
  assert.equal(declared.status, 413)
  assert.equal(declared.connection, 'close')
  assert.equal(declared.body.error, 'mail_upload_too_large')
  assert.equal(declared.body.maxBytes, deriveAttachmentLimits(null).maxFileBytes)

  const ok = await upload(base, cookie, new Uint8Array(2048))
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  const { attachment } = await ok.json()
  assert.match(attachment.aid, /^demo-upload-/)
  assert.deepEqual({ ...attachment, aid: null }, { aid: null, name: 'Été.pdf', size: 2048, contentType: 'application/pdf' })

  // The prefs give the composer its limits.
  const prefs = await (await fetch(`${base}/__ent_auth/mail/prefs`, { headers: { cookie } })).json()
  assert.deepEqual(prefs.attachments, { maxFileBytes: deriveAttachmentLimits(null).maxFileBytes, maxTotalBytes: deriveAttachmentLimits(null).maxTotalBytes })

  // Per minute (20), apart from the reading bucket: a fresh session.
  const other = await signIn()
  let blocked = null
  for (let index = 0; index < 25 && !blocked; index += 1) {
    const response = await upload(base, other, new Uint8Array(16))
    if (response.status === 429) blocked = response
    else await response.arrayBuffer()
  }
  assert.ok(blocked, 'never limited')
  assert.ok(Number(blocked.headers.get('Retry-After')) >= 1)
  assert.deepEqual(await blocked.json(), { error: 'mail_upload_rate_limited' })
  // Reading still works for that session.
  assert.equal((await fetch(`${base}/__ent_auth/mail/folders`, { headers: { cookie: other } })).status, 200)
}))
