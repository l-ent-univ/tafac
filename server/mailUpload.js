// The composer's file uploads (POST /__ent_auth/mail/upload in
// entAuthApp.js): the pieces that don't need a request, tested on their own
// (tests/mailUpload.test.js).
//
// A file goes from the browser through this server to Partage's upload
// servlet (Zimbra's FileUploadServlet, /service/upload) as a stream: never
// written to disk, never held whole in memory. Partage keeps it and gives
// back an attachment id (aid) that a SendMsgRequest will one day name.

import { normalizeAttachmentType, sanitizeAttachmentName } from '../src/mailAttachments.js'

// The servlet's answer with fmt=raw,extended (FileUploadServlet.sendResponse,
// text/html whatever the outcome, its status in the body, not the HTTP one):
//   200,'null',[{"aid":"…","ct":"…","filename":"…","s":123}]
//   413,'null'          (too large), 401,'null' (no session, CSRF), 204 …
// → { status, uploads: [{ aid, name, size, contentType }] }, the uploads
// checked (an id of safe characters, the name and type cleaned as the page's),
// or null when it isn't that shape at all.
const UPLOAD_RESPONSE_PATTERN = /^\s*(\d{3})\s*,\s*'(?:[^'\\]|\\.)*'\s*(?:,\s*([\s\S]*?))?\s*$/
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9:._-]{8,200}$/

export function isValidZimbraUploadId(value) {
  return typeof value === 'string' && UPLOAD_ID_PATTERN.test(value)
}

export function parseZimbraUploadResponse(text) {
  const match = UPLOAD_RESPONSE_PATTERN.exec(String(text ?? '').slice(0, 64 * 1024))
  if (!match) return null
  const status = Number(match[1])
  if (status !== 200) return { status, uploads: [] }
  let list = null
  try {
    list = JSON.parse(match[2] ?? '')
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  const uploads = list
    .filter((entry) => entry && typeof entry === 'object' && isValidZimbraUploadId(entry.aid))
    .map((entry) => ({
      aid: entry.aid,
      name: sanitizeAttachmentName(entry.filename),
      size: Number.isSafeInteger(Number(entry.s)) && Number(entry.s) >= 0 ? Number(entry.s) : null,
      contentType: normalizeAttachmentType(entry.ct),
    }))
  return { status, uploads }
}

// The Content-Disposition Partage is sent, as Zimbra's own web client writes
// it (ZmUploadManager: `attachment; filename="…"` with the name through
// AjxUtil.convertToEntities): ASCII only, every other character, and
// & " \ themselves, as an HTML numeric entity, which the servlet undoes
// (StringEscapeUtils.unescapeHtml on the name it reads).
export function buildZimbraUploadDisposition(name) {
  const clean = sanitizeAttachmentName(name)
  let encoded = ''
  for (const char of clean) {
    const code = char.codePointAt(0)
    encoded += code < 0x20 || code > 0x7e || char === '&' || char === '"' || char === '\\' || char === ';' ? `&#${code};` : char
  }
  return `attachment; filename="${encoded}"`
}

// An upstream answer's text, `maxBytes` of it at most (the rest dropped).
export async function readLimitedText(response, maxBytes) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size >= maxBytes) {
      await reader.cancel().catch(() => {})
      break
    }
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8')
}

// The file to Partage's upload servlet, `body` (a ReadableStream) passed on
// as it comes: `send(url, init)` is the request (the session's cookie jar
// on it). As Zimbra's web client sends it (ZmUploadManager): the raw file,
// its type, its name (buildZimbraUploadDisposition), X-Requested-With, the
// CSRF token when the sign-in found one (Partage takes SOAP without it, so
// the auth token isn't CSRF-bound and the servlet doesn't ask either). The
// length is declared: the servlet (or a proxy before it) can refuse a file
// too large before it's sent. fmt=raw,extended: the answer as one line
// (not an html page calling the web client), with each file's id, type,
// name and size; without `lbfums`, the servlet's limit is the account's
// mail size (attSizeLimit). → { httpStatus, parsed } (parseZimbraUploadResponse).
export async function sendToZimbraUpload({ send, origin, csrfToken = null, body, length, name, contentType, signal }) {
  const headers = {
    Accept: 'text/html,*/*',
    'Content-Type': normalizeAttachmentType(contentType),
    'Content-Disposition': buildZimbraUploadDisposition(name),
    'Content-Length': String(length),
    'X-Requested-With': 'XMLHttpRequest',
    Referer: `${origin}/`,
  }
  if (csrfToken) headers['X-Zimbra-Csrf-Token'] = csrfToken
  const response = await send(`${origin}/service/upload?fmt=raw,extended`, {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
    signal,
  })
  const text = await readLimitedText(response, 64 * 1024)
  return { httpStatus: response.status, parsed: parseZimbraUploadResponse(text) }
}

// A request's declared length: digits only, a safe integer. null otherwise
// (absent, negative, a list, nonsense), which the route refuses (411).
export function readContentLength(header) {
  const value = String(header ?? '').trim()
  if (!/^\d{1,15}$/.test(value)) return null
  const length = Number(value)
  return Number.isSafeInteger(length) ? length : null
}

// The uploads' own limit, per session, apart from the mail routes' reading
// bucket: `perMinute` uploads begun in any minute, `bytesPerHour` declared
// bytes in any hour, `concurrent` at once. The bytes are reserved when an
// upload starts (its Content-Length) and set to what came once it ends
// (`settle`). `take` → { ok: true, settle } or { ok: false, retryAfter }
// (seconds). Sessions idle past an hour are forgotten (looked over once a
// minute at most).
export function createUploadLimiter({ perMinute, bytesPerHour, concurrent }) {
  const sessions = new Map()
  let prunedAt = 0
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE

  function prune(now) {
    if (now - prunedAt < MINUTE) return
    prunedAt = now
    for (const [id, entry] of sessions) {
      entry.events = entry.events.filter((event) => now - event.at < HOUR)
      if (!entry.events.length && !entry.active) sessions.delete(id)
    }
  }

  function take(sessionId, bytes, now = Date.now()) {
    prune(now)
    const entry = sessions.get(sessionId) ?? { events: [], active: 0 }
    entry.events = entry.events.filter((event) => now - event.at < HOUR)
    sessions.set(sessionId, entry)
    const lastMinute = entry.events.filter((event) => now - event.at < MINUTE)
    const hourBytes = entry.events.reduce((sum, event) => sum + event.bytes, 0)
    if (entry.active >= concurrent) return { ok: false, retryAfter: 5 }
    if (lastMinute.length >= perMinute) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((lastMinute[0].at + MINUTE - now) / 1000)) }
    }
    if (hourBytes + bytes > bytesPerHour) {
      // When enough of the hour's bytes have aged out.
      let freed = 0
      let until = now + HOUR
      for (const event of entry.events) {
        freed += event.bytes
        if (hourBytes - freed + bytes <= bytesPerHour) {
          until = event.at + HOUR
          break
        }
      }
      return { ok: false, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) }
    }
    const event = { at: now, bytes }
    entry.events.push(event)
    entry.active += 1
    let settled = false
    return {
      ok: true,
      settle(receivedBytes) {
        if (settled) return
        settled = true
        entry.active = Math.max(0, entry.active - 1)
        event.bytes = Math.max(0, Math.min(bytes, Number(receivedBytes) || 0))
      },
    }
  }

  return { take, _sessions: sessions }
}

export class UploadTooLargeError extends Error {}
export class UploadIdleError extends Error {}

// A TransformStream counting what passes: past `maxBytes`, the stream fails
// (UploadTooLargeError) and the upstream request with it. `onChunk(total)`
// after each chunk (the route's idle timer, its count).
export function createUploadByteCounter(maxBytes, onChunk = () => {}) {
  let total = 0
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength
      if (total > maxBytes) {
        controller.error(new UploadTooLargeError('Upload over its limit.'))
        return
      }
      onChunk(total)
      controller.enqueue(chunk)
    },
  })
}
