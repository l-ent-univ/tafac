import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { Express } from 'express'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { isAllowedApiRequest } from '../server/entProxy/allowedRequests.ts'
import { buildPortalHeaders } from '../server/entProxy/portalHeaders.ts'
import { buildPortalUrl, readPortalPath, resolvePortalRedirect } from '../server/entProxy/portalPath.ts'
import { decideProxyRequest } from '../server/entProxy/requestPolicy.ts'
import { createSessionCookieCodec } from '../server/sessionCookie.js'
import { loadServerConfig } from '../universities/index.js'

// ---------------------------------------------------------------------------
// The rules, on their own
// ---------------------------------------------------------------------------

test('a portal path is one plain path on the portal', () => {
  assert.deepEqual(readPortalPath('/api/layoutDoc?tab=1'), { pathname: '/api/layoutDoc', search: '?tab=1' })
  assert.deepEqual(readPortalPath('/'), { pathname: '/', search: '' })

  for (const hostile of [
    '//sso-cas.example.fr/cas/x',
    '/a//b',
    '/a/../b',
    '/a/./b',
    '/a/%2e%2e/b',
    '/a%2Fb',
    '/a%5cb',
    '/a\\b',
    '/a b',
    '/a\r\nHost: x',
    '/a#b',
    'api/layoutDoc',
    'https://evil.example/',
    '',
    `/${'a'.repeat(3000)}`,
    undefined,
  ]) {
    assert.equal(readPortalPath(hostile), null, String(hostile))
  }
})

test('the portal URL keeps the configured origin', () => {
  assert.equal(
    buildPortalUrl('https://ent.example.fr', { pathname: '/api/layoutDoc', search: '?tab=1' }),
    'https://ent.example.fr/api/layoutDoc?tab=1',
  )
  assert.equal(resolvePortalRedirect('/f/accueil/', 'https://ent.example.fr/f/accueil'), 'https://ent.example.fr/f/accueil/')
  assert.equal(resolvePortalRedirect('https://cas.example.fr/login?service=x', 'https://ent.example.fr/'), null)
  assert.equal(resolvePortalRedirect('//cas.example.fr/login', 'https://ent.example.fr/'), null)
})

test('only the page\'s own portal calls are API requests', () => {
  const path = (url: string) => readPortalPath(url)!
  assert.equal(isAllowedApiRequest('GET', path('/api/v4-3/dlm/layout.json')), true)
  assert.equal(isAllowedApiRequest('GET', path('/api/layoutDoc?tab=2')), true)
  assert.equal(isAllowedApiRequest('GET', path('/api/marketplace/entries.json')), true)
  assert.equal(isAllowedApiRequest('GET', path('/api/portlet/notes-iut.json')), true)
  assert.equal(isAllowedApiRequest('GET', path('/api/v4-3/portlet/notes-iut.html')), true)
  assert.equal(isAllowedApiRequest('POST', path('/api/layout?action=movePortletAjax&sourceId=n12')), true)
  assert.equal(isAllowedApiRequest('POST', path('/api/layout?action=moveElement&sourceID=n12')), true)

  assert.equal(isAllowedApiRequest('POST', path('/api/layout?action=removeElement&elementID=n12')), false)
  assert.equal(isAllowedApiRequest('POST', path('/api/layout')), false)
  assert.equal(isAllowedApiRequest('GET', path('/api/layout?action=movePortletAjax')), false)
  assert.equal(isAllowedApiRequest('POST', path('/api/v4-3/dlm/layout.json')), false)
  assert.equal(isAllowedApiRequest('GET', path('/api/v4-3/portlet/a/b.html')), false)
  assert.equal(isAllowedApiRequest('GET', path('/f/accueil/normal/render.uP')), false)
  assert.equal(isAllowedApiRequest('GET', path('/Logout')), false)
})

const fetchHeaders = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }
const imageHeaders = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }
const pageHeaders = { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }

function decide(method: string, url: string, headers: Record<string, string>, allowAnyGetPath = false) {
  return decideProxyRequest({ method, url, headers, allowAnyGetPath })
}

test('what the proxy does with a request', () => {
  // The page's fetch of a known API.
  assert.equal(decide('GET', '/api/layoutDoc', fetchHeaders).kind, 'api')
  assert.equal(decide('post', '/api/layout?action=movePortletAjax', fetchHeaders).kind, 'api')
  // Its <img> of the account's photo, whatever the path.
  assert.equal(decide('GET', '/images/photos/1234.jpg', imageHeaders).kind, 'image')

  // A portal address opened as a page goes to the launch relay.
  assert.equal(decide('GET', '/f/accueil/normal/render.uP', pageHeaders).kind, 'navigate')
  assert.equal(decide('GET', '/api/v4-3/portlet/x.html', { ...pageHeaders, 'sec-fetch-site': 'cross-site' }).kind, 'navigate')
  // Never framed, never a form posted to it.
  assert.deepEqual(decide('GET', '/f/accueil', { ...pageHeaders, 'sec-fetch-dest': 'iframe' }), { kind: 'refuse', status: 403, error: 'Portal pages are not served here.' })
  assert.equal(decide('POST', '/api/layout?action=movePortletAjax', pageHeaders).kind, 'refuse')

  // Other sites, a request that came through another site's redirect.
  assert.equal(decide('GET', '/api/layoutDoc', { ...fetchHeaders, 'sec-fetch-site': 'cross-site' }).kind, 'refuse')
  assert.equal(decide('GET', '/photo.jpg', { ...imageHeaders, 'sec-fetch-site': 'same-site' }).kind, 'refuse')

  // A fetch of anything else, a script, a stylesheet, another method.
  assert.equal(decide('GET', '/Logout', fetchHeaders).kind, 'refuse')
  assert.equal(decide('GET', '/api/layoutDoc', { ...fetchHeaders, 'sec-fetch-dest': 'script' }).kind, 'refuse')
  assert.equal(decide('GET', '/x.css', { ...fetchHeaders, 'sec-fetch-dest': 'style' }).kind, 'refuse')
  assert.equal(decide('DELETE', '/api/layoutDoc', fetchHeaders).kind, 'refuse')
  assert.equal(decide('POST', '/photo.jpg', imageHeaders).kind, 'refuse')

  // A path that isn't one.
  assert.deepEqual(decide('GET', '//cas.example.fr/cas/x', fetchHeaders), { kind: 'refuse', status: 400, error: 'Invalid portal path.' })
})

test('a browser without Fetch Metadata gets no more', () => {
  assert.equal(decide('GET', '/api/layoutDoc', { accept: '*/*' }).kind, 'api')
  assert.equal(decide('GET', '/f/accueil', { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }).kind, 'navigate')
  // Anything else it reads is held to an image.
  assert.equal(decide('GET', '/Logout', { accept: '*/*' }).kind, 'image')
  assert.equal(decide('POST', '/Logout', { accept: '*/*' }).kind, 'refuse')
})

test('a development server lets the debug menu read any portal path', () => {
  assert.equal(decide('GET', '/api/v5-1/userinfo', fetchHeaders, true).kind, 'api')
  assert.equal(decide('POST', '/api/layout?action=removeElement', fetchHeaders, true).kind, 'refuse')
  assert.equal(decide('GET', '/api/v5-1/userinfo', { ...fetchHeaders, 'sec-fetch-site': 'cross-site' }, true).kind, 'refuse')
})

test('the portal gets headers built here, not the browser\'s', () => {
  const headers = buildPortalHeaders({
    kind: 'api',
    method: 'POST',
    entOrigin: 'https://ent.example.fr',
    referer: 'https://ent.example.fr/f/accueil',
    headers: {
      cookie: '__Host-lent_session=secret',
      origin: 'https://tafac.example',
      'accept-language': 'fr-FR,fr;q=0.9',
      'x-forwarded-for': '10.0.0.1',
      'x-ent-cookie': 'JSESSIONID=chosen',
      'x-ent-referer': 'https://evil.example/',
      'x-ent-extra-headers': JSON.stringify({
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Host: 'intranet.internal',
        Cookie: 'JSESSIONID=chosen',
        'X-Forwarded-For': '10.0.0.1',
      }),
    },
  })
  assert.deepEqual(headers, {
    Referer: 'https://ent.example.fr/f/accueil',
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept-Language': 'fr-FR,fr;q=0.9',
    Origin: 'https://ent.example.fr',
  })

  const image = buildPortalHeaders({
    kind: 'image',
    method: 'GET',
    entOrigin: 'https://ent.example.fr',
    referer: 'https://ent.example.fr/',
    headers: { 'x-ent-extra-headers': '{"Accept":"text/html"}' },
  })
  assert.match(image.Accept, /^image\//)
  assert.equal(buildPortalHeaders({
    kind: 'api',
    method: 'GET',
    entOrigin: 'https://ent.example.fr',
    referer: 'https://ent.example.fr/',
    headers: { 'x-ent-extra-headers': '{"Accept":"a\\r\\nHost: x"}' },
  }).Accept.includes('\n'), false)
})

// ---------------------------------------------------------------------------
// The route, against a stand-in portal
// ---------------------------------------------------------------------------

// Not typed yet: their options as their own comments give them.
const createApp = createEntAuthApp as (config: unknown, options: unknown) => Express
const createCodec = createSessionCookieCodec as (options: { secret: string }) => { encode: (data: unknown) => string }

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const SECRET = 'a'.repeat(44)

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders }

// A portal that records what it is asked. Its pages carry a script, as a
// page with an HTML injection would.
async function withProxy(
  run: (context: { base: string; seen: Seen[]; cookie: string; demoCookie: string }) => Promise<void>,
  { production = true } = {},
) {
  const seen: Seen[] = []
  const portal = http.createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname === '/photo.png') {
      res.setHeader('Content-Type', 'image/png')
      res.end(PNG)
    } else if (pathname === '/photo.svg') {
      res.setHeader('Content-Type', 'image/svg+xml')
      res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    } else if (pathname === '/api/layoutDoc') {
      res.setHeader('Content-Type', 'application/json;charset=UTF-8')
      res.setHeader('Set-Cookie', 'JSESSIONID=renewed; Path=/')
      res.setHeader('X-Portal-Internal', 'yes')
      res.end('[]')
    } else if (pathname === '/api/marketplace/entries.json') {
      res.writeHead(302, { Location: 'http://cas.test/cas/login?service=x' })
      res.end()
    } else if (pathname === '/api/portlet/moved.json') {
      res.writeHead(302, { Location: '/api/layoutDoc' })
      res.end()
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<html><body><script>window.pwned = 1</script></body></html>')
    }
  })
  await new Promise<void>((resolve) => portal.listen(0, '127.0.0.1', resolve))
  const entOrigin = `http://127.0.0.1:${(portal.address() as AddressInfo).port}`

  const config = await loadServerConfig('univ-exemple')
  const app = createApp(
    { ...config, origins: { ...config.origins, ent: entOrigin, cas: 'http://cas.test' } },
    { analytics: {}, session: { secret: SECRET, production } },
  )
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const cookieName = production ? '__Host-lent_session' : 'lent_session'
  const codec = createCodec({ secret: SECRET })
  const sessionData = { uni: config.id, user: 'student', demoState: null, createdAt: Date.now() }
  const cookie = `${cookieName}=${codec.encode({
    ...sessionData,
    id: 'session-1',
    mode: null,
    jar: [
      ['JSESSIONID', 'portal-session', '127.0.0.1', '/', 1, 0, null],
      ['TGC', 'TGT-secret', 'cas.test', '/cas', 1, 0, null],
    ],
  })}`
  const demoCookie = `${cookieName}=${codec.encode({ ...sessionData, id: 'session-demo', mode: 'demo', jar: [] })}`

  try {
    await run({ base, seen, cookie, demoCookie })
  } finally {
    server.close()
    portal.close()
  }
}

function assertHardened(response: Response) {
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox")
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.equal(response.headers.get('set-cookie')?.includes('JSESSIONID') ?? false, false)
}

test('without a session the portal is never asked', () => withProxy(async ({ base, seen, demoCookie }) => {
  const anonymous = await fetch(`${base}/__ent_proxy/api/layoutDoc`, {
    headers: {
      ...fetchHeaders,
      'x-ent-cookie': 'JSESSIONID=chosen',
      'x-ent-extra-headers': JSON.stringify({ host: 'intranet.internal' }),
    },
  })
  assert.equal(anonymous.status, 401)
  assertHardened(anonymous)

  // The demo account never reaches the university.
  const demo = await fetch(`${base}/__ent_proxy/api/layoutDoc`, { headers: { ...fetchHeaders, cookie: demoCookie } })
  assert.equal(demo.status, 401)

  assert.equal(seen.length, 0)
}))

test('a known API is relayed with the session\'s portal cookies only', () => withProxy(async ({ base, seen, cookie }) => {
  const response = await fetch(`${base}/__ent_proxy/api/layoutDoc?tab=2`, {
    headers: {
      ...fetchHeaders,
      cookie,
      'x-ent-cookie': 'JSESSIONID=chosen',
      'x-ent-referer': 'https://evil.example/',
      'x-ent-extra-headers': JSON.stringify({ Accept: 'application/json', host: 'intranet.internal', 'x-forwarded-for': '10.0.0.1' }),
    },
  })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '[]')
  assert.equal(response.headers.get('content-type'), 'application/json;charset=UTF-8')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-portal-internal'), null)
  assertHardened(response)
  // The session cookie is issued again, with the portal's new cookie in it.
  assert.match(response.headers.get('set-cookie') ?? '', /^__Host-lent_session=v1\./)

  assert.equal(seen.length, 1)
  const [asked] = seen
  assert.equal(asked.url, '/api/layoutDoc?tab=2')
  assert.equal(asked.headers.cookie, 'JSESSIONID=portal-session')
  assert.equal(asked.headers.accept, 'application/json')
  assert.match(asked.headers.host ?? '', /^127\.0\.0\.1:/)
  assert.equal(asked.headers['x-forwarded-for'], undefined)
  assert.equal(asked.headers['x-ent-extra-headers'], undefined)
  assert.doesNotMatch(String(asked.headers.referer), /evil/)
}))

test('another host\'s cookies are never picked for the portal', () => withProxy(async ({ base, seen, cookie }) => {
  const response = await fetch(`${base}/__ent_proxy//cas.test/cas/x`, { headers: { ...fetchHeaders, cookie } })
  assert.equal(response.status, 400)
  assert.equal(seen.length, 0)
}))

test('a portal page is never shown under this app\'s address', () => withProxy(async ({ base, seen, cookie }) => {
  // Opened as a page: to the launch relay, which opens it on the portal.
  const page = await fetch(`${base}/__ent_proxy/f/accueil/normal/render.uP?x=1`, {
    headers: { ...pageHeaders, cookie },
    redirect: 'manual',
  })
  assert.equal(page.status, 302)
  const location = new URL(page.headers.get('location') ?? '', base)
  assert.equal(location.pathname, '/__ent_auth/launch')
  assert.match(location.searchParams.get('url') ?? '', /^http:\/\/127\.0\.0\.1:\d+\/f\/accueil\/normal\/render\.uP\?x=1$/)

  // Fetched by the page: only the known APIs.
  const fetched = await fetch(`${base}/__ent_proxy/f/accueil/normal/render.uP`, { headers: { ...fetchHeaders, cookie } })
  assert.equal(fetched.status, 403)

  // As an image: only an image comes back.
  const asImage = await fetch(`${base}/__ent_proxy/f/accueil/normal/render.uP`, { headers: { ...imageHeaders, cookie } })
  assert.equal(asImage.status, 404)
  assert.equal(await asImage.text(), '')
  const svg = await fetch(`${base}/__ent_proxy/photo.svg`, { headers: { ...imageHeaders, cookie } })
  assert.equal(svg.status, 404)

  // A portlet's fragment is HTML the page reads as text: it can't run.
  const fragment = await fetch(`${base}/__ent_proxy/api/v4-3/portlet/notes.html`, { headers: { ...fetchHeaders, cookie } })
  assert.equal(fragment.status, 200)
  assert.match(await fragment.text(), /<script>/)
  assertHardened(fragment)

  assert.deepEqual(seen.map((asked) => asked.url), ['/f/accueil/normal/render.uP', '/photo.svg', '/api/v4-3/portlet/notes.html'])
}))

test('the account\'s photo is relayed as an image', () => withProxy(async ({ base, cookie }) => {
  const response = await fetch(`${base}/__ent_proxy/photo.png?ts=1`, { headers: { ...imageHeaders, cookie } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(response.headers.get('cache-control'), 'private, max-age=600')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG)
  assertHardened(response)
}))

test('a portal redirect is followed on the portal only', () => withProxy(async ({ base, seen, cookie }) => {
  const moved = await fetch(`${base}/__ent_proxy/api/portlet/moved.json`, { headers: { ...fetchHeaders, cookie }, redirect: 'manual' })
  assert.equal(moved.status, 200)
  assert.equal(await moved.text(), '[]')

  // To the CAS login: the portal session lapsed. Not followed, not passed on.
  const lapsed = await fetch(`${base}/__ent_proxy/api/marketplace/entries.json`, { headers: { ...fetchHeaders, cookie }, redirect: 'manual' })
  assert.equal(lapsed.status, 401)
  assert.equal(lapsed.headers.get('location'), null)
  assert.equal(seen.some((asked) => asked.headers.cookie?.includes('TGT-secret')), false)
}))

test('a development server relays any GET path, still as data', () => withProxy(async ({ base, cookie }) => {
  const response = await fetch(`${base}/__ent_proxy/api/v5-1/userinfo`, { headers: { ...fetchHeaders, cookie } })
  assert.equal(response.status, 200)
  assertHardened(response)

  const page = await fetch(`${base}/__ent_proxy/api/v5-1/userinfo`, { headers: { ...pageHeaders, cookie }, redirect: 'manual' })
  assert.equal(page.status, 302)
}, { production: false }))
