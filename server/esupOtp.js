// Esup OTP, the second factor of the CAS at many French universities
// (`auth.mfa: 'esup-otp'`). After a right password the CAS shows a code
// page; in a browser, that page's script asks the Esup OTP API which
// methods the student has and has a code sent by SMS or by mail. The server
// signs in without a browser, so it reads the page and asks the API itself.
//
// The page carries the API's address, the student's uid and a short-lived
// hash that stands for them at the API. Three generations of the page hold
// them differently: script constants (`const apiUrl = "…"`, `var uid = …`),
// hidden fields (`uid`, `userHash`) or data attributes (`data-apiurl`).

const API_TIMEOUT_MS = 6000

// The methods a code can be asked for, by transport. `random_code` takes
// either; `random_code_mail` is the mail-only one of some universities.
const CODE_METHODS = ['random_code', 'random_code_mail']

// A JavaScript string literal as Thymeleaf writes it (`"https:\/\/…"`,
// `\x3D`, `é`), quotes included.
function decodeScriptString(literal) {
  return literal.slice(1, -1).replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (match, escape) => {
    if (escape.length > 1) return String.fromCharCode(parseInt(escape.slice(1), 16))
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[escape] ?? escape
  })
}

function decodeAttribute(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function readScriptConstant(html, name) {
  const match = html.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')`))
  return match ? decodeScriptString(match[1]) : ''
}

function readAttribute(html, pattern) {
  const match = html.match(pattern)
  return match ? decodeAttribute(match[1]) : ''
}

function readHiddenField(html, name) {
  return readAttribute(html, new RegExp(`<input[^>]*\\bname=["']${name}["'][^>]*\\bvalue=["']([^"']*)["']`, 'i'))
    || readAttribute(html, new RegExp(`<input[^>]*\\bvalue=["']([^"']*)["'][^>]*\\bname=["']${name}["']`, 'i'))
}

// { apiUrl, uid, userHash } of the CAS's code page, or null when it isn't
// an Esup OTP page (or not one of the generations above).
export function readEsupOtpPage(html) {
  const text = String(html ?? '')
  const apiUrl = (readScriptConstant(text, 'apiUrl') || readAttribute(text, /\bdata-apiurl=["']([^"']*)["']/i)).trim().replace(/\/+$/, '')
  const uid = (readScriptConstant(text, 'uid') || readHiddenField(text, 'uid') || readAttribute(text, /\bdata-uid=["']([^"']*)["']/i)).trim()
  const userHash = (readScriptConstant(text, 'userHash') || readHiddenField(text, 'userHash') || readAttribute(text, /\bdata-userhash=["']([^"']*)["']/i)).trim()

  return apiUrl && uid && userHash ? { apiUrl, uid, userHash } : null
}

// What the student can type a code from, out of the API's answer about
// them (`user` of GET /users/:uid/:hash): `app` (an authenticator
// application, TOTP), and for `sms` and `mail` the method that sends there
// and the masked number or address ({ method, to }), or null. Push, WebAuthn
// and the NFC card need the university's own page: left out.
export function readEsupOtpChannels(user) {
  const methods = user?.methods ?? {}
  const transports = user?.transports ?? {}
  const isActive = (name) => methods[name]?.active === true

  function channel(transport) {
    const to = typeof transports[transport] === 'string' ? transports[transport].trim() : ''
    if (!to) return null
    const method = CODE_METHODS.find((name) => isActive(name) && (methods[name].transports ?? []).includes(transport))
    return method ? { method, to } : null
  }

  return { app: isActive('totp'), sms: channel('sms'), mail: channel('mail') }
}

function userUrl(page, ...segments) {
  return [page.apiUrl, 'users', ...segments].map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment))).join('/')
}

async function callApi(url, method, fetchImpl) {
  const response = await fetchImpl(url, {
    method,
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  })
  const data = await response.json()
  if (!response.ok || data?.code !== 'Ok') {
    throw new Error(`Esup OTP API answered ${response.status}${data?.code ? ` (${data.code})` : ''}.`)
  }
  return data
}

// The student's channels (readEsupOtpChannels). No cookie goes along: the
// hash of the page is what the API knows them by.
export async function fetchEsupOtpChannels(page, { fetch: fetchImpl = fetch } = {}) {
  const data = await callApi(userUrl(page, page.uid, page.userHash), 'GET', fetchImpl)
  return readEsupOtpChannels(data.user)
}

// Has the API send a code: `channel` is one of the student's ({ method }),
// `transport` 'sms' or 'mail'. `auto`: sent without the student asking,
// which the API is told as the university's own page tells it (`?auto`).
export async function sendEsupOtpCode(page, channel, transport, { fetch: fetchImpl = fetch, auto = false } = {}) {
  const url = userUrl(page, page.uid, 'methods', channel.method, 'transports', transport, page.userHash)
  await callApi(auto ? `${url}?auto` : url, 'POST', fetchImpl)
}

// The transport a code goes by without being asked: the student's only way
// to a code (no application, one of SMS and mail), else none.
export function pickEsupOtpAutoTransport(channels) {
  if (!channels || channels.app) return ''
  if (channels.sms && !channels.mail) return 'sms'
  if (channels.mail && !channels.sms) return 'mail'
  return ''
}
