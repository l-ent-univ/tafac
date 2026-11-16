// The built frontend's files (dist/), served by server.js, and how long
// each may be kept by the browser and by a CDN in front of the server.
//
// Without this, every file went out as `max-age=0`: a CDN asked this server
// again for each image, script and font of each visit, so a slow moment
// here showed as missing images there.
import express from 'express'
import type { RequestHandler, Response } from 'express'
import path from 'node:path'

const YEAR_SECONDS = 365 * 24 * 60 * 60
const DAY_SECONDS = 24 * 60 * 60

// Vite's output folder: each file there carries a hash of its content in
// its name, so a name never changes content and can be kept for good.
// A file republished there under an old name with new content (as
// vite.config.js's LEGACY_FONT_FILES did once) no longer reaches a browser
// that already holds the old one.
const HASHED_DIR = 'assets'

// Read again on every visit: the service worker and what it starts from
// (a kept copy would hold an update back), and the install manifest.
const ALWAYS_FRESH = new Set(['sw.js', 'index.html', 'manifest.webmanifest'])

// `relativePath`: the file's path inside dist/, with forward slashes.
export function cacheControlFor(relativePath: string): string {
  const [first, ...rest] = relativePath.split('/').filter(Boolean)
  if (first === HASHED_DIR && rest.length > 0) {
    return `public, max-age=${YEAR_SECONDS}, immutable`
  }
  if (rest.length === 0 && ALWAYS_FRESH.has(first ?? '')) {
    return 'public, max-age=0, must-revalidate'
  }
  // Icons, the link preview image, robots.txt: same name from one release
  // to the next, so kept a day.
  return `public, max-age=${DAY_SECONDS}`
}

export function serveBuiltFiles(distDir: string): RequestHandler {
  return express.static(distDir, {
    // Each file's header is set below.
    cacheControl: false,
    setHeaders(res: Response, filePath: string) {
      const relativePath = path.relative(distDir, filePath).split(path.sep).join('/')
      res.setHeader('Cache-Control', cacheControlFor(relativePath))
    },
  })
}
