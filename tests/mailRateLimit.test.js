import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { loadServerConfig } from '../universities/index.js'

// The demo account's mail routes answer without Partage: what's measured is
// the per-session limit in front of them.
async function withDemoSession(run) {
  const config = await loadServerConfig('univ-rennes')
  const app = createEntAuthApp(config, {
    analytics: {},
    session: { secret: 'a'.repeat(44), production: false },
  })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const signIn = async () => {
    const response = await fetch(`${base}/__ent_auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
    })
    assert.equal(response.status, 200)
    return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  }
  try {
    await run({ base, signIn })
  } finally {
    server.close()
  }
}

test('the mail routes are limited per session, with Retry-After', () => withDemoSession(async ({ base, signIn }) => {
  const cookie = await signIn()
  const folders = () => fetch(`${base}/__ent_auth/mail/folders`, { headers: { cookie } })

  let allowed = 0
  let blocked = null
  for (let request = 0; request < 100 && !blocked; request += 1) {
    const response = await folders()
    if (response.status === 429) {
      blocked = response
    } else {
      allowed += 1
      await response.arrayBuffer()
    }
  }
  assert.ok(blocked, 'never limited')
  // The burst, plus what refilled while the requests ran.
  assert.ok(allowed >= 60 && allowed < 75, `${allowed} allowed`)
  assert.ok(Number(blocked.headers.get('Retry-After')) >= 1)
  assert.deepEqual(await blocked.json(), { error: 'mail_rate_limited' })

  // Another session has its own bucket; a request without one isn't counted.
  const other = await signIn()
  assert.equal((await fetch(`${base}/__ent_auth/mail/folders`, { headers: { cookie: other } })).status, 200)
  assert.equal((await fetch(`${base}/__ent_auth/mail/folders`)).status, 401)
}))
