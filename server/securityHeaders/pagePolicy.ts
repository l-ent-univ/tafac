// The Content-Security-Policy of the app's page (the HTML that server.js
// sends): what the page may load and run, so that an injected script, should
// one ever get in, neither runs nor sends anything out.
//
// It lists what the page really uses; a new outside service or a new kind
// of content gets its line here (and tests/securityHeaders.test.ts says so):
//   - scripts: the app's own files, and the inline scripts written in
//     index.html (the theme, before first paint), by their hash. No other
//     inline script, no eval;
//   - styles: the app's stylesheet, and inline styles (React's style
//     attributes, the libraries' <style> elements);
//   - images: anywhere over HTTP(S). A mail's remote images, once the
//     student asks for them, load in a frame that inherits this policy
//     (src/components/MailReader.jsx), and avatars come from GitHub;
//   - requests: the app's own API, and the few public APIs the page asks
//     itself (CONNECT_SOURCES);
//   - frames: the app's own (the mail reader and the print view are srcdoc
//     frames); never framed by another site.
import { createHash } from 'node:crypto'

// Asked by the browser itself, without the server in between.
export const CONNECT_SOURCES = [
  // Weather (src/weatherApi.js).
  'https://api.open-meteo.com',
  'https://geocoding-api.open-meteo.com',
  'https://nominatim.openstreetmap.org',
  // Contributors, in « À propos » (src/useRepoContributors.js).
  'https://api.github.com',
  // An icon missing from the bundle (src/iconBundle.js): Iconify's API and
  // its two fallbacks.
  'https://api.iconify.design',
  'https://api.simplesvg.com',
  'https://api.unisvg.com',
]

const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
// A script a browser runs: no type, or a JavaScript one. The others are data
// (JSON-LD), which no policy needs to allow.
const JAVASCRIPT_TYPE = /^(?:module|(?:text|application)\/(?:java|ecma)script)$/i

function readAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+)))?(?=\\s|$)`, 'i'))
  return match ? match[1] ?? match[2] ?? match[3] ?? '' : null
}

// The hash sources ('sha256-…') of the page's inline scripts.
export function hashInlineScripts(html: string): string[] {
  const hashes = new Set<string>()
  for (const [, attributes, content] of html.matchAll(SCRIPT_ELEMENT)) {
    if (readAttribute(attributes, 'src') !== null || !content) continue
    const type = readAttribute(attributes, 'type')
    if (type && !JAVASCRIPT_TYPE.test(type.trim())) continue
    hashes.add(`'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`)
  }
  return [...hashes]
}

export function buildPagePolicy(html: string): string {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashInlineScripts(html)].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    ["connect-src 'self'", ...CONNECT_SOURCES].join(' '),
    "frame-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
}
