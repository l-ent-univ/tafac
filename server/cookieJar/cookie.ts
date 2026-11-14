// One cookie of the server's own jar, and the two rules that say where it
// goes: the host (RFC 6265 § 5.1.3) and the path (§ 5.1.4), as a browser
// applies them.

export interface JarCookie {
  name: string
  value: string
  // The host that set it, or its Domain attribute (no leading dot).
  domain: string
  path: string
  // No Domain attribute: for the host that set it only, not its subdomains.
  hostOnly: boolean
  secure: boolean
  // Milliseconds since the epoch; null: for the session.
  expiresAt: number | null
}

const IP_ADDRESS = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i

// `hostname` is `domain` or one of its subdomains. An IP address only
// matches itself.
export function domainMatches(hostname: string, domain: string): boolean {
  if (!hostname || !domain) return false
  if (hostname === domain) return true
  return !IP_ADDRESS.test(hostname) && hostname.endsWith(`.${domain}`)
}

export function cookieMatchesHost(cookie: JarCookie, hostname: string | null | undefined): boolean {
  if (!hostname) return false
  return cookie.hostOnly ? cookie.domain === hostname : domainMatches(hostname, cookie.domain)
}

// The cookie's path is the request's, or a folder above it: /cas goes to
// /cas and /cas/login, not to /casino.
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'
}

export function isExpired(cookie: JarCookie, now = Date.now()): boolean {
  return cookie.expiresAt !== null && cookie.expiresAt <= now
}

export function cookieKey(cookie: Pick<JarCookie, 'domain' | 'path' | 'name'>): string {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`
}
