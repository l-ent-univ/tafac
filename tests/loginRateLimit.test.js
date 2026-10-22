import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { loadServerConfig } from '../universities/index.js'

// univ-exemple's CAS is on a .example host, so every real login fails without
// leaving the machine and counts as a failure.
async function withAuthApp(options, run) {
  const config = await loadServerConfig('univ-exemple')
  const app = createEntAuthApp(config, {
    analytics: {},
    session: { secret: 'a'.repeat(44), production: true },
    ...options,
  })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const login = (username, forwardedFor) => fetch(`${base}/__ent_auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
    },
    body: JSON.stringify({ username, password: 'wrong' }),
  })

  try {
    await run(login)
  } finally {
    server.close()
  }
}

async function failUntilBlocked(login, forwardedFor) {
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    // A new username each time, so only the per-IP limit can trip.
    const response = await login(`student-${forwardedFor}-${attempt}`, forwardedFor)
    if (response.status === 429) return response
    assert.equal(response.status, 401)
  }
  throw new Error('never rate limited')
}

test('behind a local proxy, the per-IP login limit is per student, not for the whole site', () => withAuthApp({}, async (login) => {
  const blocked = await failUntilBlocked(login, '203.0.113.1')
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0)

  const otherStudent = await login('someone-else', '203.0.113.2')
  assert.equal(otherStudent.status, 401)
}))

test('with TRUST_PROXY=false, X-Forwarded-For is ignored', () => withAuthApp({ trustProxy: 'false' }, async (login) => {
  await failUntilBlocked(login, '203.0.113.1')

  const spoofed = await login('someone-else', '203.0.113.2')
  assert.equal(spoofed.status, 429)
}))

test('one student gets 7 wrong passwords before a 5-minute block', () => withAuthApp({}, async (login) => {
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    assert.equal((await login('forgetful', '203.0.113.9')).status, 401)
  }

  const blocked = await login('forgetful', '203.0.113.9')
  assert.equal(blocked.status, 429)
  const retryAfter = Number(blocked.headers.get('Retry-After'))
  assert.ok(retryAfter > 4 * 60 && retryAfter <= 5 * 60)
}))
