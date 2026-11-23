import assert from 'node:assert/strict'
import test from 'node:test'
import {
  installerFromManifest,
  isMacBrowser,
  macDownloadUrl,
  macPlatform,
  readMacArchitecture,
  readMacInstallers,
  resolveMacDownloads,
} from '../src/macAppDownload.js'

const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const DMG = 'https://github.com/l-ent-univ/tafac/releases/download/v0.28.2/Tafac_0.28.2_aarch64.dmg'
const INTEL_DMG = 'https://github.com/l-ent-univ/tafac/releases/download/v0.28.2/Tafac_0.28.2_x64.dmg'
const MANIFEST = { platforms: { 'darwin-aarch64': { installer: DMG }, 'darwin-x86_64': { installer: INTEL_DMG } } }
const answer = (body, ok = true) => async () => ({ ok, json: async () => body })
const telling = (architecture) => ({ userAgentData: { getHighEntropyValues: async () => ({ architecture }) } })

test('a Mac browser is offered the app, an iPad saying it is a Mac is not', () => {
  assert.equal(isMacBrowser({ userAgent: SAFARI_MAC, maxTouchPoints: 0 }), true)
  assert.equal(isMacBrowser({ userAgent: SAFARI_MAC, maxTouchPoints: 5 }), false)
  assert.equal(isMacBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 }), false)
  assert.equal(isMacBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', maxTouchPoints: 5 }), false)
  assert.equal(isMacBrowser(undefined), false)
})

test('the platform only when the browser tells the processor', () => {
  assert.equal(macPlatform('arm'), 'darwin-aarch64')
  assert.equal(macPlatform('x86'), 'darwin-x86_64')
  assert.equal(macPlatform(null), null)
  assert.equal(macPlatform(''), null)
  assert.equal(macDownloadUrl('darwin-x86_64'), '/desktop/download/darwin-x86_64')
})

test('the architecture, where the browser tells it', async () => {
  assert.equal(await readMacArchitecture({}), null)
  assert.equal(await readMacArchitecture(telling('x86')), 'x86')
  assert.equal(await readMacArchitecture({ userAgentData: { getHighEntropyValues: async () => { throw new Error('denied') } } }), null)
})

test('the installer in the manifest, https only', () => {
  assert.equal(installerFromManifest(MANIFEST, 'darwin-aarch64'), DMG)
  assert.equal(installerFromManifest(MANIFEST, 'linux-x86_64'), null)
  assert.equal(installerFromManifest({ platforms: { 'darwin-aarch64': { installer: 'http://example.com/a.dmg' } } }, 'darwin-aarch64'), null)
  assert.equal(installerFromManifest(null, 'darwin-aarch64'), null)
})

test('each disk image itself, else the lasting address', async () => {
  assert.deepEqual(await readMacInstallers(answer(MANIFEST)), { 'darwin-aarch64': DMG, 'darwin-x86_64': INTEL_DMG })
  const lasting = { 'darwin-aarch64': '/desktop/download/darwin-aarch64', 'darwin-x86_64': '/desktop/download/darwin-x86_64' }
  assert.deepEqual(await readMacInstallers(answer(null, false)), lasting)
  assert.deepEqual(await readMacInstallers(async () => { throw new Error('offline') }), lasting)
  assert.deepEqual(await readMacInstallers(answer({ platforms: { 'darwin-aarch64': { installer: DMG } } })), { ...lasting, 'darwin-aarch64': DMG })
})

test('Chromium goes straight to its disk image, the others choose', async () => {
  assert.deepEqual(await resolveMacDownloads({ nav: telling('x86'), fetchImpl: answer(MANIFEST) }), { platform: 'darwin-x86_64', installers: { 'darwin-aarch64': DMG, 'darwin-x86_64': INTEL_DMG } })
  assert.equal((await resolveMacDownloads({ nav: {}, fetchImpl: answer(MANIFEST) })).platform, null)
})
