import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { Express } from 'express'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { createFailureWindow, createLoginRateLimiter } from '../server/loginRateLimit/index.ts'
import { DEMO_CREDENTIALS } from '../src/demoAccount.js'
import { loadServerConfig } from '../universities/index.js'

const MINUTE = 60_000

function clock(start = 1_000_000) {
  let time = start
  return { now: () => time, advance: (ms: number) => { time += ms } }
}

test('failures add up over a window, then block for a while', () => {
  const { now, advance } = clock()
  const failures = createFailureWindow({ windowMs: 15 * MINUTE, blockMs: 5 * MINUTE, maxFailures: 3, now })

  assert.equal(failures.record('key'), null)
  assert.equal(failures.record('key'), null)
  assert.equal(failures.status('key'), null)
  assert.deepEqual(failures.record('key'), { retryAfterMs: 5 * MINUTE, retryAfterSeconds: 300 })
  assert.equal(failures.status('other'), null)

  // Still blocked a minute before the end, then a count starts over.
  advance(4 * MINUTE)
  assert.equal(failures.status('key')?.retryAfterSeconds, 60)
  advance(MINUTE)
  assert.equal(failures.status('key'), null)
  assert.equal(failures.record('key'), null)

  // Failures older than the window are forgotten too.
  advance(16 * MINUTE)
  assert.equal(failures.record('key'), null)
  assert.equal(failures.record('key'), null)

  assert.equal(failures.record(''), null)
})

test('a good login takes back the student\'s own failures on the address, not the others\'', () => {
  const { now } = clock()
  const limiter = createLoginRateLimiter({ windowMs: 15 * MINUTE, blockMs: 5 * MINUTE, maxFailuresPerIp: 5, maxFailuresPerUsername: 4, now })
  const ip = '203.0.113.7'

  // A student who mistypes twice, then signs in.
  limiter.recordFailure(ip, 'alice')
  limiter.recordFailure(ip, 'alice')
  limiter.recordSuccess(ip, 'alice')

  // Guesses at other logins, with an account of one's own signed in between.
  for (const target of ['bob', 'carol', 'dave', 'erin']) {
    assert.equal(limiter.recordFailure(ip, target), null)
    limiter.recordSuccess(ip, 'mallory')
  }
  // Alice's two were forgiven, the four guesses were not: the fifth blocks.
  assert.ok(limiter.recordFailure(ip, 'frank'))
  assert.ok(limiter.blocked(ip, 'anyone'))
  assert.equal(limiter.blocked('203.0.113.8', 'anyone'), null)
})

test('a good login clears the student\'s own count', () => {
  const { now } = clock()
  const limiter = createLoginRateLimiter({ windowMs: 15 * MINUTE, blockMs: 5 * MINUTE, maxFailuresPerIp: 100, maxFailuresPerUsername: 3, now })

  limiter.recordFailure('203.0.113.1', 'alice')
  limiter.recordFailure('203.0.113.2', 'alice')
  limiter.recordSuccess('203.0.113.3', 'alice')
  assert.equal(limiter.recordFailure('203.0.113.1', 'alice'), null)
  assert.equal(limiter.recordFailure('203.0.113.1', 'alice'), null)
  assert.ok(limiter.recordFailure('203.0.113.1', 'alice'))
})

// univ-exemple's CAS is on a .example host: a real login fails without
// leaving the machine, the demo account signs in without any request.
const createApp = createEntAuthApp as (config: unknown, options: unknown) => Express

async function withAuthApp(run: (login: (username: string, password?: string) => Promise<Response>) => Promise<void>) {
  const config = await loadServerConfig('univ-exemple')
  const server = createApp(config, { analytics: {}, session: { secret: 'a'.repeat(44), production: false } }).listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const login = (username: string, password = 'wrong') => fetch(`${base}/__ent_auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  try {
    await run(login)
  } finally {
    server.close()
  }
}

test('the demo account does not reset an address\'s failed logins', () => withAuthApp(async (login) => {
  const statuses: number[] = []
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    statuses.push((await login(`student-${attempt}`)).status)
    // The public demo account, signed in between two guesses.
    assert.equal((await login(DEMO_CREDENTIALS.username, DEMO_CREDENTIALS.password)).status, 200)
  }
  assert.deepEqual(statuses.slice(0, 29), Array(29).fill(401))
  assert.equal(statuses[29], 429)
  assert.equal((await login('student-31')).status, 429)
}))

test('the demo account stays open whatever the limits say', () => withAuthApp(async (login) => {
  // Wrong passwords on the demo login block that login, as any other…
  let last = 401
  for (let attempt = 1; attempt <= 8; attempt += 1) last = (await login(DEMO_CREDENTIALS.username)).status
  assert.equal(last, 429)
  assert.equal((await login(DEMO_CREDENTIALS.username)).status, 429)
  // …but never the demo account itself.
  assert.equal((await login(DEMO_CREDENTIALS.username, DEMO_CREDENTIALS.password)).status, 200)
}))
