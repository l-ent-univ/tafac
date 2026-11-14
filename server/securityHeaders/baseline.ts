// The headers every answer of the production server carries, the page, its
// files and the API alike. A route that needs stricter ones sets its own
// over these (the mail parts, the portal proxy).
import type { RequestHandler } from 'express'

export const BASELINE_HEADERS: Readonly<Record<string, string>> = {
  // A file is what its Content-Type says, never what its bytes look like.
  'X-Content-Type-Options': 'nosniff',
  // Never shown inside another site's page (clickjacking). Both spellings:
  // the CSP one is the standard, the other for what doesn't read it.
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  // Other sites learn the address of this app, not the page nor its query
  // (a browser's default, said out loud).
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // HTTPS only from the first visit on, for a year. Browsers ignore it over
  // plain HTTP (a development server, the desktop app), and it says nothing
  // of subdomains.
  'Strict-Transport-Security': 'max-age=31536000',
  // The app locates the student for the weather, nothing else.
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
}

export function baselineSecurityHeaders(): RequestHandler {
  return (_req, res, next) => {
    for (const [name, value] of Object.entries(BASELINE_HEADERS)) res.setHeader(name, value)
    next()
  }
}
