// The headers of the request sent to the portal. Built from scratch: none of
// the browser's own go along (its cookies, with this app's session cookie
// among them; its Origin; whatever a script added). The session's portal
// cookies are added by the caller's cookie jar.
//
// The page says how it wants the answer in `x-ent-extra-headers` (a JSON
// object, src/entApi.js): only its Accept and its X-Requested-With are read.
import type { ProxyRequest } from './requestPolicy.ts'

const DEFAULT_API_ACCEPT = 'application/json, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5'
const IMAGE_ACCEPT = 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8'
// A header value as a browser writes one: printable ASCII, short.
const PLAIN_HEADER_VALUE = /^[\x20-\x7e]{1,300}$/

function readExtraHeaders(headers: ProxyRequest['headers']): Map<string, string> {
  const extra = new Map<string, string>()
  const raw = headers['x-ent-extra-headers']
  if (typeof raw !== 'string' || !raw.trim()) return extra

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return extra
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && PLAIN_HEADER_VALUE.test(value)) extra.set(name.toLowerCase(), value)
    }
  } catch {
    // Not JSON: nothing asked.
  }
  return extra
}

export interface PortalHeadersInput {
  kind: 'api' | 'image'
  method: 'GET' | 'POST'
  headers: ProxyRequest['headers']
  entOrigin: string
  referer: string
}

export function buildPortalHeaders({ kind, method, headers, entOrigin, referer }: PortalHeadersInput): Record<string, string> {
  const portalHeaders: Record<string, string> = { Referer: referer }

  if (kind === 'image') {
    portalHeaders.Accept = IMAGE_ACCEPT
  } else {
    const extra = readExtraHeaders(headers)
    portalHeaders.Accept = extra.get('accept') ?? DEFAULT_API_ACCEPT
    if (extra.get('x-requested-with') === 'XMLHttpRequest') {
      portalHeaders['X-Requested-With'] = 'XMLHttpRequest'
    }
  }

  const language = headers['accept-language']
  if (typeof language === 'string' && PLAIN_HEADER_VALUE.test(language)) {
    portalHeaders['Accept-Language'] = language
  }

  // A write comes from the portal's own pages, as far as the portal can tell.
  if (method === 'POST') {
    portalHeaders.Origin = new URL(entOrigin).origin
  }

  return portalHeaders
}
