// A Set-Cookie header as the jar keeps it, or null when a browser would
// ignore it.
//
// The jar travels through every service a session visits (the portal, the
// CAS, the planning, Moodle, the webmail and their sign-in chains), so one
// host must not be able to write another's cookies: a Domain attribute is
// only taken from a host that belongs to it (RFC 6265 § 5.3, step 6).
// Without that, any page fetched with the jar could replace the CAS's
// ticket-granting cookie with its own, and the session would go on as
// someone else's.
//
// Kept as it was, on purpose: a cookie without a Path is for the whole host
// (a browser would take the request's folder), which the sign-in chains
// have always relied on.
import { domainMatches } from './cookie.ts'
import type { JarCookie } from './cookie.ts'

// Without the public suffix list a browser has, the least that holds: a
// domain of one label (`fr`, `localhost`) is never shared between hosts.
function isSharedDomainAllowed(hostname: string, domain: string): boolean {
  if (hostname === domain) return true
  return domain.includes('.') && domainMatches(hostname, domain)
}

export function parseSetCookie(rawCookie: string, url: string, now = Date.now()): JarCookie | null {
  const hostname = new URL(url).hostname.toLowerCase()
  const [nameValue = '', ...attributes] = rawCookie.split(';').map((part) => part.trim())
  const separatorIndex = nameValue.indexOf('=')
  if (separatorIndex === -1) return null

  const cookie: JarCookie = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
    domain: hostname,
    path: '/',
    hostOnly: true,
    secure: false,
    expiresAt: null,
  }

  for (const attribute of attributes) {
    const [rawKey = '', ...rest] = attribute.split('=')
    const key = rawKey.toLowerCase()
    const value = rest.join('=')

    if (key === 'domain' && value) {
      cookie.domain = value.replace(/^\./, '').toLowerCase()
      cookie.hostOnly = false
    } else if (key === 'path' && value.startsWith('/')) {
      cookie.path = value
    } else if (key === 'secure') {
      cookie.secure = true
    } else if (key === 'max-age') {
      const seconds = Number(value)
      if (Number.isFinite(seconds)) cookie.expiresAt = now + seconds * 1000
    } else if (key === 'expires') {
      const date = Date.parse(value)
      if (!Number.isNaN(date)) cookie.expiresAt = date
    }
  }

  // Another host's domain: the whole cookie is ignored, as a browser does.
  if (!cookie.hostOnly && !isSharedDomainAllowed(hostname, cookie.domain)) return null

  return cookie
}
