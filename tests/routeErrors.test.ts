import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { Express } from 'express'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { isCrossSiteRequest } from '../server/launchRelay/requestSite.ts'
import { redactLaunchPreview, redactTickets } from '../server/launchRelay/tickets.ts'
import { withoutDebugField } from '../server/routeErrors/debugFields.ts'
import { UNAVAILABLE_MESSAGE, createRouteErrorReporter } from '../server/routeErrors/index.ts'
import { createSessionCookieCodec } from '../server/sessionCookie.js'
import { loadServerConfig } from '../universities/index.js'

test('a failed route says nothing of what is behind it in production', () => {
  const logged: string[] = []
  const report = createRouteErrorReporter({ production: true, log: (line) => logged.push(line) })
  const error = new Error('ScoDoc grades request failed (502) at notes9.iutlan.example')

  assert.equal(report({ method: 'GET', path: '/__ent_auth/grades' }, error), UNAVAILABLE_MESSAGE)
  assert.deepEqual(logged, ['[route] GET /__ent_auth/grades failed: Error: ScoDoc grades request failed (502) at notes9.iutlan.example'])
  assert.equal(report({ method: 'GET', path: '/x' }, 'a string'), UNAVAILABLE_MESSAGE)

  // A development server passes it on (the debug menu shows it).
  const dev = createRouteErrorReporter({ production: false, log: () => assert.fail('nothing to log') })
  assert.equal(dev({ method: 'GET', path: '/x' }, error), error.message)
})

test('the debug object leaves an answer, the rest stays', () => {
  assert.deepEqual(withoutDebugField({ authenticated: true, events: [], debug: { cache: 'hit' } }), { authenticated: true, events: [] })
  assert.deepEqual(withoutDebugField({ ok: true }), { ok: true })
  assert.deepEqual(withoutDebugField([{ debug: 1 }]), [{ debug: 1 }])
  assert.equal(withoutDebugField(null), null)
})

test('a request started by another site is told from the student\'s own', () => {
  assert.equal(isCrossSiteRequest({ 'sec-fetch-site': 'cross-site' }), true)
  assert.equal(isCrossSiteRequest({ 'sec-fetch-site': 'same-site' }), true)
  assert.equal(isCrossSiteRequest({ 'sec-fetch-site': 'same-origin' }), false)
  // An address typed or a bookmark; an old browser, the desktop app's bridge.
  assert.equal(isCrossSiteRequest({ 'sec-fetch-site': 'none' }), false)
  assert.equal(isCrossSiteRequest({}), false)
})

test('a service ticket\'s value never leaves with the launch preview', () => {
  assert.equal(redactTickets('https://moodle.example.fr/login?ticket=ST-12345-abcDEF&x=1'), 'https://moodle.example.fr/login?ticket=ST-redacted&x=1')
  assert.equal(redactTickets('https://moodle.example.fr/?a=1&ticket=ST-9'), 'https://moodle.example.fr/?a=1&ticket=ST-redacted')
  assert.equal(redactTickets('https://moodle.example.fr/'), 'https://moodle.example.fr/')
  assert.equal(redactTickets(null), null)

  const preview = redactLaunchPreview({
    finalUrl: 'https://moodle.example.fr/?ticket=ST-1-secret',
    useServerLaunch: true,
    chain: [{ status: 302, url: 'https://cas.example.fr/login?service=x', location: 'https://moodle.example.fr/?ticket=ST-1-secret' }],
  })
  assert.equal(JSON.stringify(preview).includes('secret'), false)
  // What the page looks for (AvailableApplications.jsx) is still there.
  assert.match(String(preview.finalUrl), /[?&]ticket=ST-/)
  assert.equal(preview.useServerLaunch, true)
})

// The routes themselves, with the demo account (no request to a university)
// and a session whose services are replaced by a fetch that records.
const createApp = createEntAuthApp as (config: unknown, options: unknown) => Express
const createCodec = createSessionCookieCodec as (options: { secret: string }) => { encode: (data: unknown) => string }
const SECRET = 'a'.repeat(44)

async function withApp(production: boolean, run: (base: string, cookies: { demo: string; student: string }) => Promise<void>) {
  const config = await loadServerConfig('univ-exemple')
  const server = createApp(config, { analytics: {}, session: { secret: SECRET, production } }).listen(0)
  const name = production ? '__Host-lent_session' : 'lent_session'
  const data = { uni: config.id, demoState: null, createdAt: Date.now() }
  const codec = createCodec({ secret: SECRET })
  const casHost = new URL(config.origins.cas).hostname
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
      demo: `${name}=${codec.encode({ ...data, id: 'demo-session', user: 'demo@tafac.fr', mode: 'demo', jar: [] })}`,
      student: `${name}=${codec.encode({ ...data, id: 'student-session', user: 'jdoe', mode: null, jar: [['TGC', 'TGT-1', casHost, '/', 1, 1, null]] })}`,
    })
  } finally {
    server.close()
  }
}

test('production answers carry no debug object, development ones do', async () => {
  const timetable = async (base: string, cookie: string) => (await fetch(`${base}/__ent_auth/ade/timetable`, { headers: { cookie } })).json() as Promise<Record<string, unknown>>

  await withApp(true, async (base, { demo }) => {
    const answer = await timetable(base, demo)
    assert.equal(answer.authenticated, true)
    assert.equal('debug' in answer, false)
  })
  await withApp(false, async (base, { demo }) => {
    assert.deepEqual((await timetable(base, demo)).debug, { source: 'demo' })
  })
})

test('a launch link on another site makes no request with the session', async () => {
  const realFetch = globalThis.fetch
  const asked: string[] = []
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init)
    asked.push(url)
    return new Response('<html>service</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
  }) as typeof fetch

  try {
    await withApp(true, async (base, { student }) => {
      const config = await loadServerConfig('univ-exemple')
      const target = `${config.origins.ent}/f/accueil`
      const launch = (site: string) => realFetch(`${base}/__ent_auth/launch?url=${encodeURIComponent(target)}`, {
        headers: { cookie: student, 'sec-fetch-site': site },
        redirect: 'manual',
      })

      // From another site: straight to the service, nothing asked for them.
      const crossSite = await launch('cross-site')
      assert.equal(crossSite.status, 302)
      assert.equal(crossSite.headers.get('location'), target)
      assert.deepEqual(asked, [])

      // From the app: the server signs in on the student's behalf.
      const own = await launch('same-origin')
      assert.equal(own.status, 302)
      assert.deepEqual(asked, [target])

      // The chain as JSON is a development tool.
      const debug = await realFetch(`${base}/__ent_auth/launch?debug=1&url=${encodeURIComponent(target)}`, { headers: { cookie: student }, redirect: 'manual' })
      assert.equal(debug.status, 302)
    })
  } finally {
    globalThis.fetch = realFetch
  }
})
