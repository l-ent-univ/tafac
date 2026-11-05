import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { loadServerConfig } from '../universities/index.js'

// A real ENT stand-in behind /__ent_proxy: what the portal receives, and what
// the browser gets back.
async function withProxy(run) {
  const received = []
  const ent = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body })
      res.setHeader('Set-Cookie', 'JSESSIONID=secret; Path=/')
      res.setHeader('Content-Type', 'application/json')
      res.end('{"ok":true}')
    })
  })
  await new Promise((resolve) => { ent.listen(0, '127.0.0.1', resolve) })

  const config = await loadServerConfig('univ-exemple')
  const app = createEntAuthApp(
    { ...config, origins: { ...config.origins, ent: `http://127.0.0.1:${ent.address().port}` } },
    { analytics: {}, session: { secret: 'b'.repeat(44), production: false } },
  )
  const server = app.listen(0)

  try {
    await run(`http://127.0.0.1:${server.address().port}`, received)
  } finally {
    server.close()
    ent.close()
  }
}

test('the proxy forwards to the ENT, with our headers swapped in and hidden', () => withProxy(async (base, received) => {
  const response = await fetch(`${base}/__ent_proxy/api/thing?x=1`, {
    headers: {
      'x-ent-cookie': 'SESSION=abc',
      'x-ent-referer': 'https://ent.example/page',
      'x-ent-extra-headers': JSON.stringify({ 'x-extra': 'yes', 'x-empty': '' }),
    },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  // The portal's session cookie stays on the server.
  assert.equal(response.headers.get('set-cookie'), null)

  const [{ url, headers }] = received
  assert.equal(url, '/api/thing?x=1')
  assert.equal(headers.cookie, 'SESSION=abc')
  assert.equal(headers.referer, 'https://ent.example/page')
  assert.equal(headers['x-extra'], 'yes')
  assert.equal(headers['x-empty'], undefined)
  assert.match(headers.host, /^127\.0\.0\.1:/)
  for (const name of ['x-ent-cookie', 'x-ent-referer', 'x-ent-extra-headers']) {
    assert.equal(headers[name], undefined, name)
  }
}))

test('a POST reaches the ENT with its body', () => withProxy(async (base, received) => {
  const response = await fetch(`${base}/__ent_proxy/api/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"a":1}',
  })

  assert.equal(response.status, 200)
  assert.equal(received[0].method, 'POST')
  assert.equal(received[0].body, '{"a":1}')
}))

test('an invalid x-ent-extra-headers is flagged, not forwarded', () => withProxy(async (base, received) => {
  await fetch(`${base}/__ent_proxy/api/thing`, { headers: { 'x-ent-extra-headers': 'not json' } })
  assert.equal(received[0].headers['x-ent-extra-headers-error'], 'invalid-json')
}))
