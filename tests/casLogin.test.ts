import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { Express } from 'express'
import { isCredentialTarget } from '../server/casLogin/credentialTarget.ts'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { loadServerConfig } from '../universities/index.js'

test('the password is for the CAS and nowhere else', () => {
  const cas = 'https://sso-cas.example.fr'
  assert.equal(isCredentialTarget('https://sso-cas.example.fr/login?service=x', cas), true)
  assert.equal(isCredentialTarget('https://sso-cas.example.fr/cas/login', `${cas}/cas`), true)

  assert.equal(isCredentialTarget('http://sso-cas.example.fr/login', cas), false)
  assert.equal(isCredentialTarget('https://sso-cas.example.fr.evil.example/login', cas), false)
  assert.equal(isCredentialTarget('https://evil.example/login?x=sso-cas.example.fr', cas), false)
  assert.equal(isCredentialTarget('https://sso-cas.example.fr:8443/login', cas), false)
  assert.equal(isCredentialTarget('not a url', cas), false)
})

// A university made up here: fetch is replaced for every host but the app's
// own. Nothing leaves the machine.
const realFetch = globalThis.fetch
const createApp = createEntAuthApp as (config: unknown, options: unknown) => Express

interface Call { method: string; url: string; body: string }

async function loginAgainst(loginPage: (cas: string) => { url: string; html: string }) {
  const config = await loadServerConfig('univ-exemple')
  const cas: string = config.origins.cas
  const calls: Call[] = []

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = String(input)
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init)

    const method = init.method ?? 'GET'
    calls.push({ method, url, body: typeof init.body === 'string' ? init.body : '' })
    const page = loginPage(cas)
    // The portal sends to the login page; the login page is served.
    if (url !== page.url) return new Response(null, { status: 302, headers: { location: page.url } })
    return new Response(method === 'GET' ? page.html : 'wrong password', { status: 200, headers: { 'Content-Type': 'text/html' } })
  }) as typeof fetch

  const server = createApp(config, { analytics: {}, session: { secret: 'a'.repeat(44), production: false } }).listen(0)
  try {
    const response = await realFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/__ent_auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jdoe', password: 'correct horse' }),
    })
    return { status: response.status, calls }
  } finally {
    server.close()
    globalThis.fetch = realFetch
  }
}

const form = (action: string) => `<form method="post" action="${action}">
  <input name="username"><input type="password" name="password">
  <input type="hidden" name="execution" value="e1s1"></form>`

test('the CAS\'s own form gets the password', async () => {
  const { status, calls } = await loginAgainst((cas) => ({ url: `${cas}/login?service=x`, html: form('login?service=x') }))
  assert.equal(status, 401)
  const posts = calls.filter((call) => call.method === 'POST')
  assert.equal(posts.length, 1)
  assert.match(posts[0].body, /password=correct\+horse/)
})

test('a form that posts off the CAS never gets the password', async () => {
  const { status, calls } = await loginAgainst((cas) => ({ url: `${cas}/login?service=x`, html: form('https://evil.example/collect') }))
  assert.equal(status, 401)
  assert.equal(calls.some((call) => call.method === 'POST'), false)
  assert.equal(calls.some((call) => call.body.includes('correct')), false)
})

test('a login page that isn\'t the CAS\'s never gets the password', async () => {
  // The portal redirects to a look-alike, whose form posts to itself.
  const { status, calls } = await loginAgainst(() => ({ url: 'https://sso-cas.example.evil.example/login', html: form('login') }))
  assert.equal(status, 401)
  assert.equal(calls.some((call) => call.method === 'POST'), false)
})
