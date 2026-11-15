import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntAuthApp } from '../server/entAuthApp.js'
import { createLaunchTargetPolicy } from '../server/launchTargets.js'
import { buildMoodleViewPolicy } from '../server/moodleView/policy.ts'
import { listUniversityIds, loadServerConfig } from '../universities/index.js'

async function policyOf(id: string) {
  const config = await loadServerConfig(id)
  return buildMoodleViewPolicy(config, createLaunchTargetPolicy(config))
}

test('Rennes (Shibboleth): Moodle, the CAS and the federation hosts are the university’s', async () => {
  const policy = await policyOf('univ-rennes')
  assert.ok(policy)
  assert.equal(policy.home, 'https://foad.univ-rennes.fr/my/')
  assert.ok(policy.hosts.includes('foad.univ-rennes.fr'))
  assert.ok(policy.hosts.includes('sso-cas.univ-rennes.fr'))
  // The IdP is on another registrable domain than Moodle.
  assert.ok(policy.domains.includes('ident-shib.univ-rennes1.fr'))
  assert.ok(policy.domains.includes('wayf.univ-rennes.fr'))
  assert.deepEqual(policy.signIn, ['ident-shib.univ-rennes1.fr', 'sso-cas.univ-rennes.fr', 'wayf.univ-rennes.fr'])
})

test('Rennes 2 (CAS login): Moodle and its CAS', async () => {
  const policy = await policyOf('univ-rennes-2')
  assert.ok(policy)
  assert.equal(policy.home, 'https://cursus.univ-rennes2.fr/my/')
  assert.ok(policy.hosts.includes('cursus.univ-rennes2.fr'))
  assert.ok(policy.domains.includes('univ-rennes2.fr'))
  assert.equal(policy.signIn.includes('cursus.univ-rennes2.fr'), false)
  assert.equal(policy.signIn.length, 1)
})

test('a university without Moodle has no view', async () => {
  for (const id of listUniversityIds()) {
    const config = await loadServerConfig(id)
    const policy = buildMoodleViewPolicy(config, createLaunchTargetPolicy(config))
    const hasMoodle = Boolean(config.features?.moodle && config.origins?.moodle)
    assert.equal(Boolean(policy), hasMoodle, id)
  }
})

test('never a Moodle over plain http, nor one a feature flag turned off', () => {
  const targets = { hosts: ['moodle.example.fr'], domains: [] }
  assert.equal(buildMoodleViewPolicy({ features: { moodle: true }, origins: { moodle: 'http://moodle.example.fr' } }, targets), null)
  assert.equal(buildMoodleViewPolicy({ features: { moodle: false }, origins: { moodle: 'https://moodle.example.fr' } }, targets), null)
  assert.equal(buildMoodleViewPolicy({ features: { moodle: true }, origins: { moodle: null } }, targets), null)
  assert.deepEqual(buildMoodleViewPolicy({ features: { moodle: true }, origins: { moodle: 'https://moodle.example.fr/' } }, targets), {
    home: 'https://moodle.example.fr/my/',
    hosts: ['moodle.example.fr'],
    domains: [],
    signIn: [],
  })
})

async function withAuthApp(id: string, run: (base: string) => Promise<void>) {
  const app = createEntAuthApp(await loadServerConfig(id), {
    analytics: {},
    session: { secret: 'b'.repeat(44), production: false },
  })
  const server = app.listen(0)
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

async function loginDemo(base: string) {
  const response = await fetch(`${base}/__ent_auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo@tafac.fr', password: 'tafac-demo' }),
  })
  assert.equal(response.status, 200)
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
}

test('the route answers a signed-in student only', () => withAuthApp('univ-rennes', async (base) => {
  const signedOut = await fetch(`${base}/__ent_auth/moodle/view`)
  assert.equal(signedOut.status, 404)

  const cookie = await loginDemo(base)
  const response = await fetch(`${base}/__ent_auth/moodle/view`, { headers: { cookie } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const policy = await response.json() as { home: string }
  assert.equal(policy.home, 'https://foad.univ-rennes.fr/my/')
}))

test('the route has nothing for a university without Moodle', () => withAuthApp('univ-exemple', async (base) => {
  const cookie = await loginDemo(base)
  const response = await fetch(`${base}/__ent_auth/moodle/view`, { headers: { cookie } })
  assert.equal(response.status, 404)
}))
