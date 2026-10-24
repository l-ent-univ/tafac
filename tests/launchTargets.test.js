import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { createLaunchTargetPolicy } from '../server/launchTargets.js'
import { loadServerConfig } from '../universities/index.js'

test('Rennes: its own services pass, subdomains of its domains too', async () => {
  const { isAllowed } = createLaunchTargetPolicy(await loadServerConfig('univ-rennes'))

  for (const url of [
    'https://services-numeriques.univ-rennes.fr/f/services/normal/render.uP',
    'https://sso-cas.univ-rennes.fr/login?service=x',
    'https://foad.univ-rennes.fr/mod/assign/view.php?id=1',
    'https://planning.univ-rennes.fr/portal/planning/calendar',
    'https://notes9.iutlan.univ-rennes1.fr/services/doAuth.php?href=x',
    'https://partage.univ-rennes.fr/',
    'https://mdw.univ-rennes.fr/',
    'https://esup-signature.univ-rennes.fr/',
    'https://iut-lannion.loxya.app/external/login',
    'https://partage.renater.fr/',
    'HTTPS://FOAD.UNIV-RENNES.FR/',
  ]) {
    assert.equal(isAllowed(url), true, url)
  }
})

test('Rennes: anything else is refused', async () => {
  const { isAllowed } = createLaunchTargetPolicy(await loadServerConfig('univ-rennes'))

  for (const url of [
    'https://evil.example/',
    'https://univ-rennes.fr.evil.example/',
    'https://evil-univ-rennes.fr/',
    'https://evil.example/?next=https://foad.univ-rennes.fr/',
    'https://foad.univ-rennes.fr@evil.example/',
    'https://user:pass@foad.univ-rennes.fr/',
    '//evil.example/',
    '/relative',
    'javascript:alert(1)',
    'ftp://foad.univ-rennes.fr/',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'https://www.office.com/',
    '',
    null,
    ['https://foad.univ-rennes.fr/'],
  ]) {
    assert.equal(isAllowed(url), false, String(url))
  }
})

test('a university without extra domains only allows its configured hosts', async () => {
  const { isAllowed } = createLaunchTargetPolicy(await loadServerConfig('univ-exemple'))

  assert.equal(isAllowed('https://ent.univ-exemple.example/x'), true)
  assert.equal(isAllowed('https://planning.univ-exemple.example/direct/myplanning.jsp'), true)
  assert.equal(isAllowed('https://other.univ-exemple.example/'), false)
  assert.equal(isAllowed('https://services-numeriques.univ-rennes.fr/'), false)
})

async function withAuthApp(run) {
  const config = await loadServerConfig('univ-exemple')
  const app = createEntAuthApp(config, {
    analytics: {},
    session: { secret: 'b'.repeat(44), production: false },
  })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await run(base)
  } finally {
    server.close()
  }
}

async function loginDemo(base) {
  const response = await fetch(`${base}/__ent_auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
  })
  assert.equal(response.status, 200)
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
}

const launch = (base, url, cookie = '') => fetch(`${base}/__ent_auth/launch?url=${encodeURIComponent(url)}`, {
  redirect: 'manual',
  headers: cookie ? { cookie } : {},
})

test('the relay sends an unknown target back to the app, signed in or not', () => withAuthApp(async (base) => {
  const cookie = await loginDemo(base)

  for (const sessionCookie of ['', cookie]) {
    for (const url of ['https://evil.example/', 'https://ent.univ-exemple.example@evil.example/', 'http://127.0.0.1:1/']) {
      const response = await launch(base, url, sessionCookie)
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('location'), '/')
    }
  }
}))

test('the relay still opens the university services', () => withAuthApp(async (base) => {
  const cookie = await loginDemo(base)
  const target = 'https://planning.univ-exemple.example/direct/myplanning.jsp'

  for (const sessionCookie of ['', cookie]) {
    const response = await launch(base, target, sessionCookie)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), target)
  }
}))

test('launch-preview tells the app to open unknown targets directly', () => withAuthApp(async (base) => {
  const cookie = await loginDemo(base)
  const response = await fetch(`${base}/__ent_auth/launch-preview?url=${encodeURIComponent('https://evil.example/')}`, {
    headers: { cookie },
  })
  const payload = await response.json()

  assert.equal(payload.useServerLaunch, false)
  assert.equal(payload.reason, 'target-not-allowed')
}))
