import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BASELINE_HEADERS, buildPagePolicy, hashInlineScripts } from '../server/securityHeaders/index.ts'

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
const directive = (policy: string, name: string) => policy.split('; ').find((part) => part.startsWith(`${name} `))?.split(' ').slice(1) ?? []

test('every answer says how it may be read and shown', () => {
  assert.equal(BASELINE_HEADERS['X-Content-Type-Options'], 'nosniff')
  assert.equal(BASELINE_HEADERS['X-Frame-Options'], 'SAMEORIGIN')
  assert.equal(BASELINE_HEADERS['Content-Security-Policy'], "frame-ancestors 'self'")
  assert.match(BASELINE_HEADERS['Strict-Transport-Security'], /^max-age=\d{8}$/)
})

test('inline scripts go by their hash, data blocks need none', () => {
  const html = `<head>
    <script type="application/ld+json">{"@context":"https://schema.org"}</script>
    <script>document.documentElement.dataset.theme = 'dark'</script>
    <script type="module">import '/x.js'</script>
    <script type="module" crossorigin src="/assets/index.js"></script>
    <script src="/a.js"> </script>
    <script></script>
  </head>`
  assert.deepEqual(hashInlineScripts(html), [
    sha256("document.documentElement.dataset.theme = 'dark'"),
    sha256("import '/x.js'"),
  ])
  assert.deepEqual(hashInlineScripts('<p>no script</p>'), [])
})

test('the page runs its own scripts only', () => {
  const policy = buildPagePolicy('<script>theme()</script><script src="/app.js"></script>')
  assert.deepEqual(directive(policy, 'script-src'), ["'self'", sha256('theme()')])
  assert.deepEqual(directive(policy, 'default-src'), ["'self'"])
  assert.deepEqual(directive(policy, 'object-src'), ["'none'"])
  assert.deepEqual(directive(policy, 'frame-ancestors'), ["'self'"])
  assert.deepEqual(directive(policy, 'form-action'), ["'self'"])
  assert.deepEqual(directive(policy, 'base-uri'), ["'self'"])

  for (const name of ['script-src', 'connect-src', 'frame-src', 'worker-src', 'default-src']) {
    const sources = directive(policy, name)
    assert.equal(sources.some((source) => ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:'].includes(source)), false, name)
  }
  // Requests leave for the listed APIs only.
  assert.ok(directive(policy, 'connect-src').includes('https://api.open-meteo.com'))
  assert.equal(directive(policy, 'connect-src').every((source) => source === "'self'" || /^https:\/\/[a-z0-9.-]+$/.test(source)), true)
})

test('index.html\'s inline scripts are the ones the policy is written for', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  // The theme script, before first paint. Another inline script would get
  // its hash too: this is where adding one is noticed.
  assert.equal(hashInlineScripts(html).length, 1)
  // No inline event handler: a hash doesn't cover those.
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
})
