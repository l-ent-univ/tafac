// What the Node inside the iOS app lacks, put back before server.js loads
// (desktop/ios.mjs). scripts/ios-prepare.mjs makes one file of this module
// and the packages it imports.
//
// nodejs-mobile is Node 18 built for a phone: no JIT, so no WebAssembly, and
// no ICU. Without them:
//
//   fetch, Headers…    Node's own (undici) reads HTTP with WebAssembly and
//                      throws as soon as one of them is touched. Here: the
//                      same API over node:http and node:https (node-fetch),
//                      with the bodies as web streams, as the server reads
//                      them.
//   Intl               isn't there at all. Here: dates and numbers
//                      (@formatjs), in French and English, with the time
//                      zones.
//   normalize()        gives its text back unchanged. Here: unorm's.
//   localeCompare()    compares code units. Here: letters first, then
//                      accents, then case, as a French sort wants.
//   \p{…} in a regex   doesn't compile, and can't be put back at run time:
//                      ios-prepare.mjs rewrites those in the server's files.
//   crypto             the global is behind a flag in Node 18.
import { webcrypto } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { ReadableStream } from 'node:stream/web'
import nodeFetch, { Blob, File, FormData, Headers, Request, Response } from 'node-fetch'
import unorm from 'unorm'

function define(target, name, value) {
  Object.defineProperty(target, name, { value, writable: true, configurable: true })
}

// --- Text ------------------------------------------------------------------

const NORMALIZERS = { NFC: unorm.nfc, NFD: unorm.nfd, NFKC: unorm.nfkc, NFKD: unorm.nfkd }

define(String.prototype, 'normalize', function normalize(form = 'NFC') {
  const normalizer = NORMALIZERS[String(form)]
  if (!normalizer) throw new RangeError(`The normalization form should be one of NFC, NFD, NFKC, NFKD.`)
  return normalizer(String(this))
})

const COMBINING_MARKS = /[̀-ͯ]/g

define(String.prototype, 'localeCompare', function localeCompare(that, _locales, options) {
  const left = String(this)
  const right = String(that)
  const leftMarked = unorm.nfd(left)
  const rightMarked = unorm.nfd(right)

  const leftLetters = leftMarked.replace(COMBINING_MARKS, '').toLowerCase()
  const rightLetters = rightMarked.replace(COMBINING_MARKS, '').toLowerCase()
  if (leftLetters !== rightLetters) return leftLetters < rightLetters ? -1 : 1
  if (options?.sensitivity === 'base') return 0

  const leftAccents = leftMarked.toLowerCase()
  const rightAccents = rightMarked.toLowerCase()
  if (leftAccents !== rightAccents) return leftAccents < rightAccents ? -1 : 1
  if (options?.sensitivity === 'accent' || left === right) return 0

  // Lower case first, as ICU sorts.
  return left > right ? -1 : 1
})

// --- Intl ------------------------------------------------------------------

// In this order: each one needs the ones before it.
await import('@formatjs/intl-getcanonicallocales/polyfill-force.js')
await import('@formatjs/intl-locale/polyfill-force.js')
await import('@formatjs/intl-pluralrules/polyfill-force.js')
await import('@formatjs/intl-pluralrules/locale-data/en.js')
await import('@formatjs/intl-pluralrules/locale-data/fr.js')
await import('@formatjs/intl-numberformat/polyfill-force.js')
await import('@formatjs/intl-numberformat/locale-data/en.js')
await import('@formatjs/intl-numberformat/locale-data/fr.js')
await import('@formatjs/intl-datetimeformat/polyfill-force.js')
await import('@formatjs/intl-datetimeformat/locale-data/en.js')
await import('@formatjs/intl-datetimeformat/locale-data/fr.js')
await import('@formatjs/intl-datetimeformat/add-all-tz.js')

// The phone's time zone, which the app says (src-tauri/src/node.rs): Node
// can't name it without ICU.
try {
  Intl.DateTimeFormat.__setDefaultTimeZone(process.env.TAFAC_TIME_ZONE || 'Europe/Paris')
} catch {
  Intl.DateTimeFormat.__setDefaultTimeZone('Europe/Paris')
}

// --- fetch -----------------------------------------------------------------

// One connection kept per host: a TLS handshake for each request is slow
// without a JIT.
const agents = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
}

// Node's fetch gives every Set-Cookie header on its own.
if (typeof Headers.prototype.getSetCookie !== 'function') {
  define(Headers.prototype, 'getSetCookie', function getSetCookie() {
    return this.raw()['set-cookie'] ?? []
  })
}

// node-fetch's response, with its body as a web stream (getReader(),
// cancel(), Readable.fromWeb()) instead of Node's.
class WebResponse {
  #response
  #stream = null

  constructor(response) {
    this.#response = response
  }

  get status() { return this.#response.status }
  get statusText() { return this.#response.statusText }
  get ok() { return this.#response.ok }
  get url() { return this.#response.url }
  get redirected() { return this.#response.redirected }
  get type() { return 'basic' }
  get headers() { return this.#response.headers }

  get body() {
    const body = this.#response.body
    if (!body) return null
    this.#stream ??= Readable.toWeb(body)
    return this.#stream
  }

  get bodyUsed() {
    return this.#response.bodyUsed || Boolean(this.#stream?.locked)
  }

  async arrayBuffer() {
    if (!this.#stream) return this.#response.arrayBuffer()
    const chunks = []
    for await (const chunk of this.#stream) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }

  async text() {
    return new TextDecoder().decode(await this.arrayBuffer())
  }

  async json() {
    return JSON.parse(await this.text())
  }

  async blob() {
    const type = this.headers.get('content-type') || ''
    return new Blob([await this.arrayBuffer()], { type })
  }

  clone() {
    if (this.bodyUsed) throw new TypeError('Response.clone: Body has already been consumed.')
    return new WebResponse(this.#response.clone())
  }
}

// What Node's fetch sends when the caller says nothing.
const DEFAULT_HEADERS = {
  accept: '*/*',
  'accept-language': '*',
  'sec-fetch-mode': 'cors',
  'user-agent': 'node',
}

async function fetch(input, init = {}) {
  const { duplex: _duplex, ...options } = init ?? {}
  // A body sent as it comes (an upload passed on): node-fetch takes Node's
  // streams.
  if (options.body instanceof ReadableStream) options.body = Readable.fromWeb(options.body)

  const headers = new Headers(options.headers ?? (input instanceof Request ? input.headers : undefined))
  for (const [name, value] of Object.entries(DEFAULT_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value)
  }
  options.headers = headers
  options.agent ??= (url) => agents[url.protocol]

  try {
    return new WebResponse(await nodeFetch(input, options))
  } catch (error) {
    // As Node's: the signal's own reason (a TimeoutError), or « fetch
    // failed » with what went wrong as its cause.
    if (options.signal?.aborted) throw options.signal.reason ?? error
    if (error?.name === 'AbortError' || error instanceof TypeError) throw error
    throw new TypeError('fetch failed', { cause: error })
  }
}

define(globalThis, 'fetch', fetch)
define(globalThis, 'Headers', Headers)
define(globalThis, 'Request', Request)
define(globalThis, 'Response', Response)
define(globalThis, 'FormData', FormData)
define(globalThis, 'Blob', Blob)
define(globalThis, 'File', File)

// --- The rest --------------------------------------------------------------

if (typeof globalThis.crypto === 'undefined') define(globalThis, 'crypto', webcrypto)
