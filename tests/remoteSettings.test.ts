import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRemoteSettings, isFor, parseSettings, refusal, trustedDomains, verifySignature } from '../server/remoteSettings/index.ts'
import type { Patch } from '../server/remoteSettings/index.ts'
import { mergeSettings } from '../src/remoteSettings.js'
import { NEWER, OLDER, PUBLIC_KEY, TAKEN } from './fixtures/remoteSettings.js'

// A university's server settings, as an app ships them.
const SHIPPED = {
  id: 'univ-rennes',
  features: { planning: true, mail: true },
  origins: { cas: 'https://sso-cas.univ-rennes.fr', ent: 'https://ent.univ-rennes.fr' },
  mail: { origin: 'https://partage.univ-rennes.fr', signInDomains: ['partage.renater.fr'], signature: { logo: { file: '/app/logo.png' } } },
  launch: { allowedDomains: ['univ-rennes.fr'] },
}

const ADDRESS = 'https://tafac.example/app/settings.json'

function scratch(): { file: string, cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tafac-remote-settings-'))
  return { file: path.join(dir, 'kept.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// tafac.fr, answering with `files` (by address) or 404.
function server(files: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const text = files[String(input)]
    return text === undefined ? new Response('', { status: 404 }) : new Response(text, { status: 200 })
  }) as typeof fetch
}

const published = (document: { text: string, signature: string }) => ({ [ADDRESS]: document.text, [`${ADDRESS}.sig`]: document.signature })

// `later`: the app starts that many hours from now.
function settings(file: string, answers: typeof fetch, extra: Record<string, string> = {}, later = 0) {
  const reports: string[] = []
  const remote = createRemoteSettings(
    { REMOTE_SETTINGS_URL: ADDRESS, REMOTE_SETTINGS_PUBKEY: PUBLIC_KEY, REMOTE_SETTINGS_FILE: file, TAFAC_APP: 'ios', TAFAC_APP_VERSION: '0.27.0', ...extra },
    { fetch: answers, report: (message) => reports.push(message), now: () => Date.now() + later * 60 * 60 * 1000 },
  )
  return { remote, reports }
}

test('a signature is the key’s over that very file', () => {
  const data = Buffer.from(TAKEN.text, 'utf8')
  assert.equal(verifySignature(data, TAKEN.signature, PUBLIC_KEY), true)
  // Another file, one byte changed, another file's signature.
  assert.equal(verifySignature(Buffer.from(NEWER.text, 'utf8'), TAKEN.signature, PUBLIC_KEY), false)
  assert.equal(verifySignature(Buffer.from(TAKEN.text.replace('"serial":2', '"serial":9'), 'utf8'), TAKEN.signature, PUBLIC_KEY), false)
  assert.equal(verifySignature(data, NEWER.signature, PUBLIC_KEY), false)
  // What isn't a key or a signature.
  assert.equal(verifySignature(data, '', PUBLIC_KEY), false)
  assert.equal(verifySignature(data, TAKEN.signature, ''), false)
  assert.equal(verifySignature(data, 'bm90IGEgc2lnbmF0dXJl', PUBLIC_KEY), false)
})

test('the trusted comment is signed too', () => {
  const text = Buffer.from(TAKEN.signature, 'base64').toString('utf8')
  const forged = Buffer.from(text.replace(/file:\S+/, 'file:another.json'), 'utf8').toString('base64')
  assert.notEqual(forged, TAKEN.signature)
  assert.equal(verifySignature(Buffer.from(TAKEN.text, 'utf8'), forged, PUBLIC_KEY), false)
})

test('a file that doesn’t read is refused whole', () => {
  assert.deepEqual(parseSettings('{'), { error: 'not JSON' })
  assert.deepEqual(parseSettings('[]'), { error: 'not an object' })
  assert.deepEqual(parseSettings('{"patches":[]}'), { error: 'no serial number' })
  assert.deepEqual(parseSettings('{"serial":1}'), { error: 'no list of patches' })
  const one = (patch: object) => parseSettings(JSON.stringify({ serial: 1, patches: [patch] }))
  assert.deepEqual(one({ id: 'a', university: 'univ-rennes', feature: { mail: false } }), { error: 'patch "a": unknown key "feature"' })
  assert.deepEqual(one({ id: 'a', university: 'Univ Rennes' }), { error: 'patch "a": no university' })
  assert.deepEqual(one({ id: 'a', university: 'univ-rennes', features: { mail: 'off' } }), { error: 'patch "a": "features" is not a set of switches' })
  assert.deepEqual(one({ id: 'a', university: 'univ-rennes', maxVersion: '1.2' }), { error: 'patch "a": "maxVersion" is not a version' })
  assert.deepEqual(parseSettings('{"serial":1,"patches":[{"id":"a","university":"univ-rennes","server":{"__proto__":{"x":1}}}]}'), { error: 'patch "a": a key that is never taken' })
  assert.deepEqual(one({ id: 'a', university: 'univ-rennes', features: { mail: false } }), { serial: 1, patches: [{ id: 'a', university: 'univ-rennes', features: { mail: false } }] })
})

test('a patch is for the apps and the versions it names', () => {
  const patch: Patch = { id: 'a', university: 'univ-rennes' }
  assert.equal(isFor(patch, 'ios', '0.27.0'), true)
  assert.equal(isFor({ ...patch, apps: ['desktop'] }, 'ios', '0.27.0'), false)
  assert.equal(isFor({ ...patch, apps: ['ios', 'desktop'] }, 'ios', '0.27.0'), true)
  assert.equal(isFor({ ...patch, minVersion: '0.27.0', maxVersion: '0.27.2' }, 'ios', '0.27.0'), true)
  assert.equal(isFor({ ...patch, minVersion: '0.27.0', maxVersion: '0.27.2' }, 'ios', '0.27.2'), true)
  assert.equal(isFor({ ...patch, maxVersion: '0.27.2' }, 'ios', '0.28.0'), false)
  assert.equal(isFor({ ...patch, minVersion: '0.27.0' }, 'ios', '0.26.9'), false)
  // An app that doesn't say its version takes no patch made for some.
  assert.equal(isFor({ ...patch, maxVersion: '0.27.2' }, 'ios', ''), false)
  assert.equal(isFor(patch, '', ''), true)
})

test('settings are merged key by key, lists and values replaced', () => {
  const merged = mergeSettings(SHIPPED, { features: { mail: false }, mail: { signInDomains: ['univ-rennes.fr'] }, origins: { cas: null } })
  assert.deepEqual(merged.features, { planning: true, mail: false })
  assert.deepEqual(merged.mail.signInDomains, ['univ-rennes.fr'])
  assert.equal(merged.mail.origin, 'https://partage.univ-rennes.fr')
  assert.equal(merged.origins.cas, null)
  // What was shipped is left as it was.
  assert.equal(SHIPPED.features.mail, true)
  assert.equal(SHIPPED.origins.cas, 'https://sso-cas.univ-rennes.fr')
})

test('the university’s own domains are the ones the app ships with', () => {
  assert.deepEqual(trustedDomains(SHIPPED).sort(), ['ent.univ-rennes.fr', 'partage.renater.fr', 'partage.univ-rennes.fr', 'sso-cas.univ-rennes.fr', 'univ-rennes.fr'])
})

test('a patch never sends anything to a new domain', () => {
  const trusted = trustedDomains(SHIPPED)
  assert.equal(refusal({ origins: { cas: 'https://sso2.univ-rennes.fr/cas' } }, trusted), null)
  assert.equal(refusal({ features: { mail: false }, mail: { maxMessages: 10 } }, trusted), null)
  assert.match(refusal({ origins: { cas: 'https://sso.example.org' } }, trusted) ?? '', /outside the university's domains \(sso\.example\.org\)/)
  // A look-alike, an address in a sentence, one without https, a bare host.
  assert.match(refusal({ origins: { cas: 'https://univ-rennes.fr.example.org' } }, trusted) ?? '', /outside/)
  assert.match(refusal({ origins: { cas: 'https://evil-univ-rennes.fr' } }, trusted) ?? '', /outside/)
  assert.match(refusal({ note: 'see https://example.org/page for more' }, trusted) ?? '', /outside/)
  assert.match(refusal({ origins: { cas: 'http://sso-cas.univ-rennes.fr' } }, trusted) ?? '', /not https/)
  assert.match(refusal({ mail: { signInDomains: ['example.org'] } }, trusted) ?? '', /a host outside/)
  assert.equal(refusal({ mail: { signInDomains: ['idp.univ-rennes.fr'] } }, trusted), null)
  // Nor name a file of the device, nor change the university.
  assert.match(refusal({ mail: { signature: { logo: { file: '/private/cookies.json' } } } }, trusted) ?? '', /a file of the device/)
  assert.match(refusal({ id: 'univ-rennes-2' }, trusted) ?? '', /which university/)
})

test('without an address or a key nothing is asked and nothing changes', async () => {
  let asked = 0
  const counting = (async () => {
    asked += 1
    return new Response('', { status: 404 })
  }) as typeof fetch
  for (const env of [{}, { REMOTE_SETTINGS_URL: ADDRESS }, { REMOTE_SETTINGS_PUBKEY: PUBLIC_KEY }, { REMOTE_SETTINGS_URL: 'http://tafac.example/settings.json', REMOTE_SETTINGS_PUBKEY: PUBLIC_KEY }]) {
    const remote = createRemoteSettings(env, { fetch: counting })
    await remote.ready()
    assert.deepEqual(remote.resolve('univ-rennes', SHIPPED), { server: SHIPPED, client: null, applied: [] })
  }
  assert.equal(asked, 0)
})

test('the file on tafac.fr patches the university’s settings', async () => {
  const { file, cleanup } = scratch()
  try {
    const { remote, reports } = settings(file, server(published(TAKEN)))
    await remote.ready()
    assert.equal(remote.serial(), 2)
    const resolved = remote.resolve('univ-rennes', SHIPPED)
    // The switch reaches the server and the page; the address moved within
    // the university's domains; the one to another domain is refused.
    assert.deepEqual(resolved.applied, ['planning-off', 'cas-moved'])
    assert.deepEqual(resolved.server.features, { planning: false, mail: true })
    assert.deepEqual(resolved.server.origins, { cas: 'https://sso2.univ-rennes.fr', ent: 'https://ent.univ-rennes.fr' })
    assert.deepEqual(resolved.client, { features: { planning: false }, note: 'moved' })
    assert.ok(reports.some((message) => message.includes('patch "cas-stolen" refused')))
    assert.equal(SHIPPED.origins.cas, 'https://sso-cas.univ-rennes.fr')
    // Another university's patch is not this one's.
    assert.deepEqual(remote.resolve('univ-sorbonne-nouvelle', SHIPPED).applied, [])
  } finally {
    cleanup()
  }
})

test('a patch for other versions of the app is left out', async () => {
  const { file, cleanup } = scratch()
  try {
    const { remote } = settings(file, server(published(TAKEN)), { TAFAC_APP_VERSION: '0.28.0' })
    await remote.ready()
    assert.deepEqual(remote.resolve('univ-rennes', SHIPPED).applied, ['planning-off'])
    const desktop = settings(file, server(published(TAKEN)), { TAFAC_APP: 'desktop' })
    await desktop.remote.ready()
    assert.deepEqual(desktop.remote.resolve('univ-rennes', SHIPPED).applied, ['planning-off'])
  } finally {
    cleanup()
  }
})

test('the file taken is kept, and read again offline', async () => {
  const { file, cleanup } = scratch()
  try {
    await settings(file, server(published(TAKEN))).remote.ready()
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const { remote } = settings(file, offline)
    await remote.ready()
    assert.deepEqual(remote.resolve('univ-rennes', SHIPPED).applied, ['planning-off', 'cas-moved'])
  } finally {
    cleanup()
  }
})

test('a kept file that was tampered with is not read', async () => {
  const { file, cleanup } = scratch()
  try {
    await settings(file, server(published(TAKEN))).remote.ready()
    const kept = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, JSON.stringify({ ...kept, text: kept.text.replace('sso2.univ-rennes.fr', 'sso9.univ-rennes.fr') }))
    const { remote, reports } = settings(file, server({}))
    await remote.ready()
    assert.deepEqual(remote.resolve('univ-rennes', SHIPPED).applied, [])
    assert.ok(reports.some((message) => message.includes('(kept) not taken: bad signature')))
  } finally {
    cleanup()
  }
})

test('a bad signature, or a file that isn’t there, changes nothing', async () => {
  const { file, cleanup } = scratch()
  try {
    const forged = settings(file, server({ [ADDRESS]: TAKEN.text, [`${ADDRESS}.sig`]: NEWER.signature }))
    await forged.remote.ready()
    assert.equal(forged.remote.serial(), null)
    assert.ok(forged.reports.some((message) => message.includes('bad signature')))

    await settings(file, server(published(TAKEN))).remote.ready()
    // tafac.fr has no file any more: what was taken stays.
    const gone = settings(file, server({}))
    await gone.remote.ready()
    assert.equal(gone.remote.serial(), 2)
  } finally {
    cleanup()
  }
})

test('a file last asked for hours ago is asked for before the app starts', async () => {
  const { file, cleanup } = scratch()
  try {
    await settings(file, server(published(TAKEN))).remote.ready()
    const { remote } = settings(file, server(published(NEWER)), {}, 7)
    await remote.ready()
    assert.equal(remote.serial(), 3)
  } finally {
    cleanup()
  }
})

test('an older file never takes the place of a newer one', async () => {
  const { file, cleanup } = scratch()
  try {
    await settings(file, server(published(TAKEN))).remote.ready()
    const back = settings(file, server(published(OLDER)))
    await back.remote.ready()
    await back.remote.refresh()
    assert.equal(back.remote.serial(), 2)
    assert.ok(back.reports.some((message) => message.includes('serial 1 is older than 2')))

    // A newer one does, and an empty one takes the patches away. Asked for
    // a moment ago, the file is not waited for: the newer one is kept for
    // the next start.
    const soon = settings(file, server(published(NEWER)))
    await soon.remote.ready()
    assert.equal(soon.remote.serial(), 2)
    await soon.remote.refresh()
    assert.equal(soon.remote.serial(), 2)
    const next = settings(file, server({}))
    await next.remote.ready()
    assert.equal(next.remote.serial(), 3)
    assert.deepEqual(next.remote.resolve('univ-rennes', SHIPPED).applied, [])
  } finally {
    cleanup()
  }
})
