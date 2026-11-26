import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import { cacheControlFor, serveBuiltFiles } from '../server/staticFiles/index.ts'
import { buildStaticFixture, outputPath } from '../scripts/gateway-data.mjs'

const FOR_GOOD = 'public, max-age=31536000, immutable'
const A_DAY = 'public, max-age=86400'
const ALWAYS_FRESH = 'public, max-age=0, must-revalidate'

test('files named after their content are kept for good', () => {
  assert.equal(cacheControlFor('assets/index-DaeHe8mh.js'), FOR_GOOD)
  assert.equal(cacheControlFor('assets/lake-D07LPwNH.webp'), FOR_GOOD)
  assert.equal(cacheControlFor('assets/CollabSans-Regular-DmyIZthJ.woff2'), FOR_GOOD)
})

test('the service worker and what it starts from are read again each visit', () => {
  assert.equal(cacheControlFor('sw.js'), ALWAYS_FRESH)
  assert.equal(cacheControlFor('index.html'), ALWAYS_FRESH)
  assert.equal(cacheControlFor('manifest.webmanifest'), ALWAYS_FRESH)
})

test('files that keep their name across releases are kept a day', () => {
  assert.equal(cacheControlFor('icon.png'), A_DAY)
  assert.equal(cacheControlFor('pwa-192x192.png'), A_DAY)
  assert.equal(cacheControlFor('robots.txt'), A_DAY)
  assert.equal(cacheControlFor('workbox-2fbc6a65.js'), A_DAY)
  // Only the top-level `assets` folder holds hashed names.
  assert.equal(cacheControlFor('assets'), A_DAY)
  assert.equal(cacheControlFor('other/assets/x.js'), A_DAY)
  assert.equal(cacheControlFor('other/sw.js'), A_DAY)
})

test('the built files go out with their own header', async (t) => {
  const dist = mkdtempSync(path.join(tmpdir(), 'tafac-dist-'))
  t.after(() => rmSync(dist, { recursive: true, force: true }))
  mkdirSync(path.join(dist, 'assets'))
  writeFileSync(path.join(dist, 'assets', 'lake-D07LPwNH.webp'), 'image')
  writeFileSync(path.join(dist, 'icon.png'), 'icon')
  writeFileSync(path.join(dist, 'sw.js'), '// worker')

  const app = express()
  app.use(serveBuiltFiles(dist))
  const server = app.listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise((resolve) => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // node:http, not fetch: fetch adds `Cache-Control: no-cache` to a request
  // carrying If-None-Match, which always gets the whole file back.
  const header = (pathname: string, headers: Record<string, string> = {}) => new Promise<{
    status: number | undefined
    cacheControl: string | undefined
    etag: string | undefined
  }>((resolve, reject) => {
    get(`${origin}${pathname}`, { headers }, (response) => {
      response.resume()
      response.on('end', () => resolve({
        status: response.statusCode,
        cacheControl: response.headers['cache-control'],
        etag: response.headers.etag,
      }))
    }).on('error', reject)
  })

  const image = await header('/assets/lake-D07LPwNH.webp')
  assert.equal(image.status, 200)
  assert.equal(image.cacheControl, FOR_GOOD)
  assert.equal((await header('/icon.png')).cacheControl, A_DAY)
  assert.equal((await header('/sw.js')).cacheControl, ALWAYS_FRESH)

  // A copy asked about again: unchanged, with the same header.
  const again = await header('/assets/lake-D07LPwNH.webp', { 'If-None-Match': image.etag ?? '' })
  assert.equal(again.status, 304)
  assert.equal(again.cacheControl, FOR_GOOD)

  // Not a file: left to the routes after (the page).
  assert.equal((await header('/assets/missing.webp')).status, 404)
})

// The gateway serves these files itself on tafac.fr when it is given the
// build (back/crates/tafac-gateway, own/statics.rs), and holds itself to
// what this handler answered, written in tests/fixtures/static-files.json
// by scripts/gateway-data.mjs. It fails here when this handler answers
// otherwise and the script wasn't run again.
test('the gateway holds to what this handler answers', async () => {
  const written = JSON.parse(readFileSync(outputPath('tests/fixtures/static-files.json'), 'utf8'))
  const made = await buildStaticFixture()
  // A file's time as the file system keeps it may differ by a few
  // nanoseconds from one to another; the answers don't.
  const withoutNanoseconds = (fixture: { files: { mtimeNs: string }[] }) => ({ ...fixture, files: fixture.files.map((file) => ({ ...file, mtimeNs: null })) })
  assert.deepEqual(withoutNanoseconds(written), withoutNanoseconds(made))
})
