// The path of a proxied request (what follows /__ent_proxy), as it will be
// asked of the portal. It comes from the browser, so it is read strictly:
// the request must stay on the portal's own host and say plainly which page
// it wants. Anything a URL parser or the portal could read otherwise is
// refused rather than cleaned up.

export interface PortalPath {
  // Starts with one slash, no query.
  pathname: string
  // '' or '?…'.
  search: string
}

const MAX_LENGTH = 2048
// Whitespace, control characters, backslashes (a slash to some parsers) and
// a fragment have no place in a request line.
const FORBIDDEN_CHARACTERS = /[\s\\#\u0000-\u001f\u007f]/
// Encoded dots, slashes and backslashes: a server may decode them into the
// segments refused below.
const ENCODED_SEPARATOR = /%(?:2e|2f|5c)/i

export function readPortalPath(requestUrl: unknown): PortalPath | null {
  if (typeof requestUrl !== 'string' || requestUrl.length > MAX_LENGTH) return null
  // One leading slash: `//host/…` names another host to a URL parser, whose
  // cookies would then be picked for the request.
  if (!requestUrl.startsWith('/') || requestUrl.startsWith('//')) return null
  if (FORBIDDEN_CHARACTERS.test(requestUrl)) return null

  const queryStart = requestUrl.indexOf('?')
  const pathname = queryStart === -1 ? requestUrl : requestUrl.slice(0, queryStart)
  const search = queryStart === -1 ? '' : requestUrl.slice(queryStart)

  if (pathname.includes('//') || ENCODED_SEPARATOR.test(pathname)) return null
  if (pathname.split('/').some((segment) => segment === '.' || segment === '..')) return null

  return { pathname, search }
}

// The portal's URL for that path. The origin is the configured one whatever
// the path holds: checked again once built.
export function buildPortalUrl(entOrigin: string, path: PortalPath): string {
  const origin = new URL(entOrigin).origin
  const url = new URL(`${origin}${path.pathname}${path.search}`)
  if (url.origin !== origin) {
    throw new Error('The proxied URL left the portal.')
  }
  return url.toString()
}

// Where a redirect of the portal leads, when it stays on the portal; null
// otherwise (the CAS login of a lapsed session, another service).
export function resolvePortalRedirect(location: string, currentUrl: string): string | null {
  try {
    const next = new URL(location, currentUrl)
    return next.origin === new URL(currentUrl).origin ? next.toString() : null
  } catch {
    return null
  }
}
