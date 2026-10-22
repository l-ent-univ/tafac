import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

// Previews of the links in a mail: the page's title, description, image and
// site, from its Open Graph / Twitter / HTML metadata. The server fetches
// pages on a student's behalf, so only public http(s) addresses on the
// standard ports, checked when connecting (a redirect or a DNS answer can't
// lead into a private network); 3 redirects, 5 s, 512 KB of HTML.

const MAX_BYTES = 512 * 1024
const TIMEOUT_MS = 5000
const MAX_REDIRECTS = 3
const CACHE_TTL_MS = 60 * 60 * 1000
const FAILURE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 500

// Not loopback, private, link-local, carrier-grade NAT, benchmark,
// multicast or reserved.
export function isPublicAddress(address) {
  const ip = /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(address) ? address.slice(7) : address
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0))
      || (a === 198 && (b === 18 || b === 19))
    )
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    return !(
      lower === '::' || lower === '::1'
      || /^(fc|fd|fe[89ab]|ff)/.test(lower)
      || lower.startsWith('::ffff:') || lower.startsWith('64:ff9b:')
    )
  }
  return false
}

// The URL, if the server may fetch it.
export function checkPreviewUrl(value) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.port && url.port !== '80' && url.port !== '443') return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null
  if (net.isIP(host) && !isPublicAddress(host)) return null
  url.hash = ''
  return url
}

// Every address the name resolves to must be public, or no connection.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error)
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      return callback(new Error(`${hostname} resolves to a non-public address.`))
    }
    if (options?.all) return callback(null, addresses)
    return callback(null, addresses[0].address, addresses[0].family)
  })
}

function fetchPage(value, redirectsLeft = MAX_REDIRECTS) {
  const url = checkPreviewUrl(value)
  if (!url) return Promise.reject(new Error('URL not allowed.'))

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.get(url, {
      lookup: safeLookup,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TafacLinkPreview/1.0)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'fr,en;q=0.8',
      },
    }, (response) => {
      const status = response.statusCode ?? 0
      const location = response.headers.location
      if (status >= 300 && status < 400 && location) {
        response.resume()
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects.'))
        return resolve(fetchPage(new URL(location, url).href, redirectsLeft - 1))
      }
      if (status < 200 || status >= 300 || !/text\/html|application\/xhtml/i.test(response.headers['content-type'] ?? '')) {
        response.resume()
        return reject(new Error(`Not an HTML page (${status}).`))
      }
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        chunks.push(chunk)
        size += chunk.length
        // The head is all we read: enough once past it.
        if (size >= MAX_BYTES) response.destroy()
      })
      response.on('close', () => resolve({ url: url.href, html: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', reject)
    })
    const timer = setTimeout(() => request.destroy(new Error('Link preview timed out.')), TIMEOUT_MS)
    request.on('close', () => clearTimeout(timer))
    request.on('error', reject)
  })
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(apos|#39);/g, "'")
    .replace(/&amp;/g, '&')
}

function readAttributes(tag) {
  const attributes = {}
  for (const match of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

const clean = (value, max) => {
  const text = decodeEntities(String(value ?? '')).replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

function absoluteHttpUrl(value, base) {
  try {
    const url = new URL(decodeEntities(String(value ?? '').trim()), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

// shortcut: pages are read as UTF-8; a Latin-1 page's accents come out
// garbled. Read the charset from Content-Type/<meta charset> if it matters.
export function parseLinkMetadata(html, pageUrl) {
  const head = html.split(/<\/head>/i)[0]
  const meta = {}
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = readAttributes(tag)
    const key = (attributes.property || attributes.name || '').toLowerCase()
    if (key && attributes.content && !(key in meta)) meta[key] = attributes.content
  }
  const icon = [...head.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => readAttributes(tag))
    .find((attributes) => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(attributes.rel ?? '') && attributes.href)
  const url = new URL(pageUrl)

  return {
    url: pageUrl,
    title: clean(meta['og:title'] || meta['twitter:title'] || head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 200),
    description: clean(meta['og:description'] || meta['twitter:description'] || meta.description, 300),
    image: absoluteHttpUrl(meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['twitter:image:src'], pageUrl),
    siteName: clean(meta['og:site_name'], 80) || url.hostname.replace(/^www\./, ''),
    icon: absoluteHttpUrl(icon?.href ?? '/favicon.ico', pageUrl),
  }
}

// One preview per URL, kept an hour (a failure, 10 minutes), shared by
// every student.
export function createLinkPreviewer({ fetcher = fetchPage } = {}) {
  const cache = new Map()

  return function getLinkPreview(value) {
    const url = checkPreviewUrl(value)
    if (!url) return Promise.resolve(null)
    const key = url.href
    const cached = cache.get(key)
    if (cached && Date.now() < cached.expiresAt) return cached.promise

    const entry = { expiresAt: Date.now() + CACHE_TTL_MS, promise: null }
    entry.promise = fetcher(key)
      .then(({ url: finalUrl, html }) => parseLinkMetadata(html, finalUrl))
      .catch(() => {
        entry.expiresAt = Date.now() + FAILURE_TTL_MS
        return null
      })
    cache.delete(key)
    cache.set(key, entry)
    if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value)
    return entry.promise
  }
}
