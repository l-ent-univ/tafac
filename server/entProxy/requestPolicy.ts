// What the proxy does with a request, decided from the request alone (no
// session, no network), so it can be tested as a table.
//
// The portal's pages must never show under this app's address: a script on
// one of them would act as the signed-in student (grades, mails). So:
//   - `api`: the page's own fetch() of one of the known portal APIs
//     (allowedRequests.ts);
//   - `image`: an <img> of the page (the account's photo, whose path the
//     portal chooses); only an image is relayed (relay.ts);
//   - `navigate`: an address opened as a page (a tile opened in a new tab,
//     an old link, a link in a mail): sent to the launch relay, which opens
//     the portal under the portal's own address;
//   - `refuse`: everything else.
//
// Browsers say what a request is for in Sec-Fetch-* (Fetch Metadata), which
// a page cannot forge. The few that don't send them (Safari before 16.4)
// are told apart by their Accept header, and what they get is no wider.
import { isAllowedApiRequest, isApiMethod } from './allowedRequests.ts'
import type { ApiMethod } from './allowedRequests.ts'
import { readPortalPath } from './portalPath.ts'
import type { PortalPath } from './portalPath.ts'

export type ProxyDecision =
  | { kind: 'api'; method: ApiMethod; path: PortalPath }
  | { kind: 'image'; path: PortalPath }
  | { kind: 'navigate'; path: PortalPath }
  | { kind: 'refuse'; status: 400 | 403; error: string }

export interface ProxyRequest {
  method: string
  // Path and query after /__ent_proxy.
  url: string
  headers: Record<string, string | string[] | undefined>
  // Development servers: any GET path as an API call, for the debug menu's
  // portal explorer. Never in production.
  allowAnyGetPath?: boolean
}

// Sec-Fetch-Dest of a page load, top-level or framed.
const PAGE_DESTINATIONS = new Set(['document', 'iframe', 'frame', 'embed', 'object', 'fencedframe'])

function readHeader(headers: ProxyRequest['headers'], name: string): string {
  const value = headers[name]
  return (Array.isArray(value) ? value[0] ?? '' : value ?? '').trim().toLowerCase()
}

const refuse = (status: 400 | 403, error: string): ProxyDecision => ({ kind: 'refuse', status, error })

export function decideProxyRequest({ method, url, headers, allowAnyGetPath = false }: ProxyRequest): ProxyDecision {
  const path = readPortalPath(url)
  if (!path) return refuse(400, 'Invalid portal path.')

  const upperMethod = method.toUpperCase()
  const site = readHeader(headers, 'sec-fetch-site')
  const mode = readHeader(headers, 'sec-fetch-mode')
  const destination = readHeader(headers, 'sec-fetch-dest')
  const hasFetchMetadata = Boolean(mode || destination)

  const opensPage = mode === 'navigate'
    || PAGE_DESTINATIONS.has(destination)
    || (!hasFetchMetadata && readHeader(headers, 'accept').includes('text/html'))
  if (opensPage) {
    // Top-level only: the portal is never framed here.
    return upperMethod === 'GET' && (!destination || destination === 'document')
      ? { kind: 'navigate', path }
      : refuse(403, 'Portal pages are not served here.')
  }

  // The page's own requests only. The session cookie is SameSite=Lax too;
  // this also covers a request that reached here through another site's
  // redirect.
  if (site && site !== 'same-origin') return refuse(403, 'Cross-site request.')

  const isFetch = !destination || destination === 'empty'
  if (isFetch && isApiMethod(upperMethod)) {
    if (isAllowedApiRequest(upperMethod, path)) return { kind: 'api', method: upperMethod, path }
    if (allowAnyGetPath && upperMethod === 'GET') return { kind: 'api', method: 'GET', path }
  }

  if (upperMethod === 'GET' && (!destination || destination === 'image')) {
    return { kind: 'image', path }
  }

  return refuse(403, 'Not a portal request of this app.')
}
