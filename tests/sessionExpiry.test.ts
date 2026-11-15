import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { Express } from 'express'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { classifyCasLoginPage, createCasSessionProbe, createEndedSessions } from '../server/sessionExpiry/index.ts'
import { createSessionCookieCodec } from '../server/sessionCookie.js'
import { loadServerConfig } from '../universities/index.js'

// ---------------------------------------------------------------------------
// The CAS's answer, on its own
// ---------------------------------------------------------------------------

// As the Rennes CAS answers GET /login with the TGC (seen on a real account).
const SIGNED_IN_PAGE = '<html><head><title>Log In Successful | Université de Rennes</title></head><body><h2>Log In Successful</h2></body></html>'
const LOGIN_FORM = '<form id="fm1" method="post"><input id="username" name="username"><input type="password" id="password" name="password"><input type="hidden" name="execution" value="e1s1"></form>'
const OTP_STEP = '<form method="post"><input name="token"><input type="hidden" name="execution" value="e1s2"></form>'

test('only the CAS password form is an expired session', () => {
  assert.equal(classifyCasLoginPage({ status: 200, html: LOGIN_FORM }), 'expired')
  assert.equal(classifyCasLoginPage({ status: 200, html: SIGNED_IN_PAGE }), 'valid')
  // A step of a sign-in other than the password: not known.
  assert.equal(classifyCasLoginPage({ status: 200, html: OTP_STEP }), 'unknown')
  // The CAS down, overloaded, redirecting: no word on the session.
  for (const status of [301, 302, 401, 403, 404, 429, 500, 502, 503, 504]) {
    assert.equal(classifyCasLoginPage({ status, html: LOGIN_FORM }), 'unknown', String(status))
  }
})

interface FakeJar { tgc: boolean }

function probeWith(answers: Array<{ status: number; html: string } | Error>, { validForMs = 60_000 } = {}) {
  let now = 0
  let asked = 0
  const probe = createCasSessionProbe<FakeJar>({
    hasTicket: (jar) => jar.tgc,
    fetchLoginPage: async () => {
      const answer = answers[Math.min(asked, answers.length - 1)]
      asked += 1
      if (answer instanceof Error) throw answer
      return answer
    },
    validForMs,
    now: () => now,
  })
  return { probe, asked: () => asked, wait: (ms: number) => { now += ms } }
}

test('no ticket left is an expired session, without asking the CAS', async () => {
  const { probe, asked } = probeWith([{ status: 200, html: SIGNED_IN_PAGE }])
  assert.equal(await probe.check('s', { tgc: false }), 'expired')
  assert.equal(asked(), 0)
})

test('a CAS that does not answer is no expired session', async () => {
  const timeout = new Error('The operation was aborted due to timeout')
  timeout.name = 'TimeoutError'
  for (const answer of [new TypeError('fetch failed'), timeout, { status: 503, html: 'Maintenance' }]) {
    const { probe } = probeWith([answer])
    assert.equal(await probe.check('s', { tgc: true }), 'unknown')
  }
})

test('a valid session is taken as is for a while, an unknown one asked again', async () => {
  const { probe, asked, wait } = probeWith([new TypeError('fetch failed'), { status: 200, html: SIGNED_IN_PAGE }, { status: 200, html: LOGIN_FORM }])
  const jar = { tgc: true }
  assert.equal(await probe.check('s', jar), 'unknown')
  assert.equal(await probe.check('s', jar), 'valid')
  wait(30_000)
  assert.equal(await probe.check('s', jar), 'valid')
  assert.equal(asked(), 2)
  wait(31_000)
  assert.equal(await probe.check('s', jar), 'expired')
  // Expired stays expired.
  assert.equal(await probe.check('s', jar), 'expired')
  assert.equal(asked(), 3)
})

test('requests failing together ask the CAS once', async () => {
  const { probe, asked } = probeWith([{ status: 200, html: LOGIN_FORM }])
  const jar = { tgc: true }
  const states = await Promise.all([probe.check('s', jar), probe.check('s', jar), probe.check('s', jar)])
  assert.deepEqual(states, ['expired', 'expired', 'expired'])
  assert.equal(asked(), 1)
})

test('an ended session is remembered for a while', () => {
  let now = 0
  const ended = createEndedSessions({ now: () => now, keptMs: 1000 })
  ended.end('a', 'expired')
  ended.end('b', 'signed-out')
  assert.equal(ended.reasonOf('a'), 'expired')
  assert.equal(ended.reasonOf('b'), 'signed-out')
  assert.equal(ended.reasonOf('c'), null)
  assert.equal(ended.reasonOf(null), null)
  now = 1000
  assert.equal(ended.reasonOf('a'), null)
})

// ---------------------------------------------------------------------------
// The routes, against a stand-in university
// ---------------------------------------------------------------------------

const createApp = createEntAuthApp as (config: unknown, options: unknown) => Express
const createCodec = createSessionCookieCodec as (options: { secret: string }) => { encode: (data: unknown) => string }
const SECRET = 'b'.repeat(44)

type CasMode = 'valid' | 'expired' | 'down'

// The university: its CAS answers as `cas.mode` says; its grade service
// (ScoDoc) fails whatever the session (it sends to the CAS, then says it
// isn't signed in).
async function withUniversity(run: (context: { base: string; origin: string; cas: { mode: CasMode; asked: number }; cookie: (id: string, extra?: object) => string }) => Promise<void>) {
  const cas = { mode: 'valid' as CasMode, asked: 0 }
  const university = http.createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname === '/cas/login') {
      cas.asked += 1
      if (cas.mode === 'down') {
        res.writeHead(503, { 'Content-Type': 'text/html' })
        res.end('Maintenance')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(cas.mode === 'expired' ? LOGIN_FORM : SIGNED_IN_PAGE)
    } else if (pathname === '/services/doAuth.php') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('ok')
    } else if (pathname === '/services/data.php') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ redirect: '/services/doAuth.php' }))
    } else {
      res.writeHead(502)
      res.end()
    }
  })
  await new Promise<void>((resolve) => university.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(university.address() as AddressInfo).port}`

  const config = await loadServerConfig('univ-rennes')
  const app = createApp(
    {
      ...config,
      // The CAS on a host of its own, as at a university.
      origins: { ...config.origins, ent: origin, cas: `${origin.replace('127.0.0.1', 'localhost')}/cas`, moodle: null },
      grades: { ...config.grades, origin },
    },
    { analytics: {}, session: { secret: SECRET, production: false } },
  )
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const codec = createCodec({ secret: SECRET })
  const cookie = (id: string, extra: object = {}) => `lent_session=${codec.encode({
    id,
    uni: config.id,
    user: 'student',
    mode: null,
    demoState: null,
    createdAt: Date.now(),
    jar: [['TGC', 'TGT-secret', 'localhost', '/cas', 1, 0, null]],
    ...extra,
  })}`

  try {
    await run({ base, origin, cas, cookie })
  } finally {
    server.close()
    university.close()
  }
}

const clearsCookie = (response: Response) => response.headers.getSetCookie().some((line) => /^lent_session=;/.test(line))

test('a service failing with the CAS session dead signs out, once', async () => {
  await withUniversity(async ({ base, cas, cookie }) => {
    cas.mode = 'expired'
    const session = cookie('session-expired')
    const response = await fetch(`${base}/__ent_auth/grades`, { headers: { cookie: session } })
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('x-tafac-session'), 'expired')
    assert.deepEqual(await response.json(), { error: 'session_expired' })
    assert.ok(clearsCookie(response))

    // A request still on its way with the cookie: no session, said so,
    // and the CAS not asked again.
    const asked = cas.asked
    const late = await fetch(`${base}/__ent_auth/grades`, { headers: { cookie: session } })
    assert.equal(late.headers.get('x-tafac-session'), 'expired')
    assert.deepEqual(await late.json(), { authenticated: false, grades: null })
    assert.equal(cas.asked, asked)

    // The first check of a page loaded with it says why.
    const check = await fetch(`${base}/__ent_auth/session`, { headers: { cookie: session } })
    assert.equal(((await check.json()) as { expired?: boolean }).expired, true)
  })
})

test('a service failing with the CAS session alive is its own failure', async () => {
  await withUniversity(async ({ base, cas, cookie }) => {
    cas.mode = 'valid'
    const response = await fetch(`${base}/__ent_auth/grades`, { headers: { cookie: cookie('session-valid') } })
    assert.equal(response.status, 500)
    assert.equal(response.headers.get('x-tafac-session'), null)
    assert.equal(clearsCookie(response), false)
  })
})

test('the CAS down or not answering never signs out', async () => {
  await withUniversity(async ({ base, cas, cookie }) => {
    cas.mode = 'down'
    const response = await fetch(`${base}/__ent_auth/grades`, { headers: { cookie: cookie('session-down') } })
    assert.equal(response.status, 500)
    assert.equal(response.headers.get('x-tafac-session'), null)
    assert.equal(clearsCookie(response), false)
  })
})

test('a request without a session says so, the sign-in routes don\'t', async () => {
  await withUniversity(async ({ base }) => {
    const grades = await fetch(`${base}/__ent_auth/grades`)
    assert.equal(grades.headers.get('x-tafac-session'), 'expired')
    const proxy = await fetch(`${base}/__ent_proxy/api/layoutDoc`)
    assert.equal(proxy.headers.get('x-tafac-session'), 'expired')
    for (const path of ['/__ent_auth/session', '/__ent_auth/logout']) {
      const response = await fetch(`${base}${path}`, { method: path.endsWith('logout') ? 'POST' : 'GET' })
      assert.equal(response.headers.get('x-tafac-session'), null, path)
    }
  })
})

test('the demo account is never asked about', async () => {
  await withUniversity(async ({ base, cas, cookie }) => {
    cas.mode = 'expired'
    const response = await fetch(`${base}/__ent_auth/grades`, { headers: { cookie: cookie('session-demo', { mode: 'demo', jar: [] }) } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-tafac-session'), null)
    assert.equal(cas.asked, 0)
  })
})

test('a launch with the CAS session dead goes to the login form, signed out', async () => {
  await withUniversity(async ({ base, origin, cas, cookie }) => {
    cas.mode = 'expired'
    // A service of the university's that sends to the CAS, which asks for
    // the password.
    const target = encodeURIComponent(`${origin.replace('127.0.0.1', 'localhost')}/cas/login?service=x`)
    const response = await fetch(`${base}/__ent_auth/launch?url=${target}`, { headers: { cookie: cookie('session-launch') }, redirect: 'manual' })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/login?session=expired')
    assert.equal(response.headers.get('x-tafac-session'), 'expired')
    assert.ok(clearsCookie(response))
  })
})

test('the portal failing to sign in again signs out only with the CAS session dead', async () => {
  await withUniversity(async ({ base, cas, cookie }) => {
    // The portal answers nothing usable: no sign-in again possible.
    cas.mode = 'valid'
    const kept = await fetch(`${base}/__ent_auth/session`, { headers: { cookie: cookie('session-portal-down') } })
    assert.equal(kept.status, 500)
    assert.equal(clearsCookie(kept), false)

    cas.mode = 'expired'
    const ended = await fetch(`${base}/__ent_auth/session`, { headers: { cookie: cookie('session-portal-expired') } })
    assert.equal(ended.status, 200)
    const body = (await ended.json()) as { authenticated: boolean; expired?: boolean }
    assert.equal(body.authenticated, false)
    assert.equal(body.expired, true)
    assert.ok(clearsCookie(ended))
  })
})
