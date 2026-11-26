// GET /__ent_auth/apps as this server answers it: the demo account's list,
// and the list of a portal it reads itself (Drupal: the catalogue page).
// The gateway answers it for the portals tonAPI reads
// (back/crates/tafac-gateway/src/tests/apps.rs).
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { Express } from 'express'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { createSessionCookieCodec } from '../server/sessionCookie.js'
import { loadServerConfig } from '../universities/index.js'

// Not typed yet: their options as their own comments give them.
const createApp = createEntAuthApp as (config: unknown, options: unknown) => Express
const createCodec = createSessionCookieCodec as (options: { secret: string }) => { encode: (data: unknown) => string }

const SECRET = 'a'.repeat(44)
const APP_KEYS = ['id', 'title', 'description', 'url', 'iconUrl', 'category', 'favorite']

const CATALOGUE_PAGE = `<body class="user-logged-in"><main>
<div class="view view-outils view-id-outils view-display-id-page_par_categorie">
  <div class="view-content">
  <div class="col-xs-12 section">
    <h3>Bureau</h3>
    <ul role="list">
      <li role="listitem"><div about="/outil/tempo" class="outil group-toolbox clearfix">
        <a href="https://tempo.example.fr" title="Emplois du temps"><span>TEMPO</span></a>
      </a></div></li>
      <li role="listitem"><div about="/outil/imprimer" class="outil group-toolbox clearfix">
        <a href="/numerique/impression" title=""><span>Imprimer</span></a>
      </a></div></li>
    </ul>
  </div>
  </div>
</div>
</main></body>`

interface Served { base: string; cookie: (data: Record<string, unknown>) => string; asked: string[] }

// The server for one university, in front of a stand-in portal that knows
// one session and records the paths it is asked.
async function withServer(university: string, run: (served: Served) => Promise<void>) {
  const asked: string[] = []
  const portal = http.createServer((req, res) => {
    asked.push((req.url ?? '').split('?')[0])
    if ((req.headers.cookie ?? '').includes('SESS=portal-session')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(CATALOGUE_PAGE)
    } else {
      res.writeHead(302, { Location: 'http://cas.test/cas/login?service=x' })
      res.end()
    }
  })
  await new Promise<void>((resolve) => portal.listen(0, '127.0.0.1', resolve))
  const entOrigin = `http://127.0.0.1:${(portal.address() as AddressInfo).port}`

  const config = await loadServerConfig(university)
  const app = createApp(
    { ...config, origins: { ...config.origins, ent: entOrigin, cas: 'http://cas.test' } },
    { analytics: {}, session: { secret: SECRET, production: true } },
  )
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const codec = createCodec({ secret: SECRET })
  const cookie = (data: Record<string, unknown>) => `__Host-lent_session=${codec.encode({
    uni: config.id, user: 'student', demoState: null, createdAt: Date.now(), mode: null, jar: [], ...data,
  })}`

  try {
    await run({ base, cookie, asked })
  } finally {
    server.close()
    portal.close()
  }
}

test('nobody signed in gets no list, and no university is asked', () => withServer('univ-rennes-2', async ({ base, asked }) => {
  const response = await fetch(`${base}/__ent_auth/apps`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { authenticated: false, apps: null })
  assert.equal(asked.length, 0)
}))

test('the demo account has its own applications, some starred from the start', () => withServer('univ-rennes-2', async ({ base, cookie, asked }) => {
  const response = await fetch(`${base}/__ent_auth/apps`, { headers: { cookie: cookie({ id: 'session-demo', mode: 'demo' }) } })
  assert.equal(response.status, 200)
  const answer = await response.json() as { authenticated: boolean; sessionMode: string; apps: Record<string, unknown>[] }
  assert.equal(answer.authenticated, true)
  assert.equal(answer.sessionMode, 'demo')
  assert.equal(answer.apps.length, 8)
  for (const app of answer.apps) {
    assert.deepEqual(Object.keys(app), APP_KEYS)
    assert.match(String(app.url), /^https:\/\//)
  }
  // The keys the page opens the mail and the planning pages by.
  assert.deepEqual(answer.apps.slice(0, 2).map((app) => [app.id, app.favorite]), [['demo-messagerie', true], ['demo-emploi-du-temps', true]])
  assert.deepEqual(answer.apps.filter((app) => app.favorite).map((app) => app.title), ['Messagerie', 'Emplois du temps', 'Moodle', 'Annuaire'])
  // The demo account never reaches a university.
  assert.equal(asked.length, 0)
}))

test('a portal this server reads gives its catalogue as the list', () => withServer('univ-rennes-2', async ({ base, cookie, asked }) => {
  const signedIn = cookie({ id: 'session-1', jar: [['SESS', 'portal-session', '127.0.0.1', '/', 1, 0, null], ['TGC', 'TGT-secret', 'cas.test', '/cas', 1, 0, null]] })
  const response = await fetch(`${base}/__ent_auth/apps`, { headers: { cookie: signedIn } })
  assert.equal(response.status, 200)
  const answer = await response.json() as { authenticated: boolean; sessionMode: null; apps: Record<string, unknown>[] }
  assert.deepEqual([answer.authenticated, answer.sessionMode], [true, null])
  const [tempo, print] = answer.apps
  assert.equal(answer.apps.length, 2)
  assert.deepEqual(tempo, { id: 'portal-tool-tempo', title: 'TEMPO', description: 'Emplois du temps', url: 'https://tempo.example.fr/', iconUrl: null, category: 'Bureau', favorite: false })
  // A link of the portal's own is an address on the portal; no description
  // is none.
  assert.deepEqual(Object.keys(print), APP_KEYS)
  assert.deepEqual([print.id, print.description, print.favorite], ['portal-tool-imprimer', null, false])
  assert.match(String(print.url), /^http:\/\/127\.0\.0\.1:\d+\/numerique\/impression$/)
  assert.deepEqual(asked, ['/tous-outils'])
}))
