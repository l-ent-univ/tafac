// Asks the portal and reads its answer for the proxy to pass on: a status, a
// type and a body, nothing else of the portal's (no Set-Cookie, no Location,
// none of its other headers).
import { resolvePortalRedirect } from './portalPath.ts'

export type PortalFetch = (url: string, init: RequestInit) => Promise<Response>

export type PortalAnswer =
  | { kind: 'body'; status: number; contentType: string; body: Buffer }
  // The portal sent the request elsewhere (the CAS login, most likely): its
  // session lapsed.
  | { kind: 'signed-out' }
  // Not what was asked for: an image request that got something else.
  | { kind: 'not-found' }
  | { kind: 'too-large' }

export interface RelayRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  // Only an image is relayed (the account's photo).
  imageOnly: boolean
  timeoutMs: number
  maxBytes: number
}

// The portal's own redirects (a trailing slash, a canonical address) are
// followed for a read, on the portal only.
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
// Raster images: what an <img> shows and can't run (no SVG).
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])
const MEDIA_TYPE = /^[\w.+-]+\/[\w.+-]+$/

function readMediaType(response: Response): string {
  return (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
}

// The type passed on: the portal's when it reads as one (its charset kept).
function readContentType(response: Response): string {
  const header = (response.headers.get('content-type') ?? '').trim()
  return MEDIA_TYPE.test(readMediaType(response)) && /^[\x20-\x7e]{1,200}$/.test(header)
    ? header
    : 'application/octet-stream'
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {})
}

async function readBody(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    return null
  }
  if (!response.body) return Buffer.alloc(0)

  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}

export async function relayToPortal(fetchPortal: PortalFetch, request: RelayRequest): Promise<PortalAnswer> {
  // One deadline for the whole exchange, redirects and body included.
  const signal = AbortSignal.timeout(request.timeoutMs)
  let url = request.url

  for (let hop = 0; ; hop += 1) {
    const response = await fetchPortal(url, {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
      signal,
    })

    if (REDIRECT_STATUSES.has(response.status)) {
      await discard(response)
      const location = response.headers.get('location')
      const next = location && request.method === 'GET' && hop < MAX_REDIRECTS
        ? resolvePortalRedirect(location, url)
        : null
      if (!next) return { kind: 'signed-out' }
      url = next
      continue
    }

    if (request.imageOnly && (!response.ok || !IMAGE_TYPES.has(readMediaType(response)))) {
      await discard(response)
      return { kind: 'not-found' }
    }

    const body = await readBody(response, request.maxBytes)
    if (!body) return { kind: 'too-large' }

    return {
      kind: 'body',
      status: response.status,
      contentType: request.imageOnly ? readMediaType(response) : readContentType(response),
      body,
    }
  }
}
