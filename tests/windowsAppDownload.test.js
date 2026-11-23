import assert from 'node:assert/strict'
import test from 'node:test'
import { isWindowsBrowser, readWindowsInstaller, shouldOfferWindowsApp } from '../src/windowsAppDownload.js'

const EDGE_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const SETUP = 'https://github.com/l-ent-univ/tafac/releases/download/v0.30.0/Tafac_0.30.0_x64.exe'
const answer = (body, ok = true) => async () => ({ ok, json: async () => body })

test('a Windows browser is offered the app, the other systems are not', () => {
  assert.equal(isWindowsBrowser({ userAgent: EDGE_WINDOWS }), true)
  assert.equal(isWindowsBrowser({ userAgent: SAFARI_MAC }), false)
  assert.equal(isWindowsBrowser({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), false)
  assert.equal(isWindowsBrowser(undefined), false)
  assert.equal(shouldOfferWindowsApp({ userAgent: EDGE_WINDOWS }), true)
  assert.equal(shouldOfferWindowsApp({ userAgent: SAFARI_MAC }), false)
})

test('the installer in the newest release, nothing before there is one', async () => {
  assert.equal(await readWindowsInstaller(answer({ platforms: { 'windows-x86_64': { installer: SETUP } } })), SETUP)
  // A release with only the Mac builds, a manifest not served, no network.
  assert.equal(await readWindowsInstaller(answer({ platforms: { 'darwin-aarch64': { installer: SETUP } } })), null)
  assert.equal(await readWindowsInstaller(answer(null, false)), null)
  assert.equal(await readWindowsInstaller(async () => { throw new Error('offline') }), null)
  assert.equal(await readWindowsInstaller(answer({ platforms: { 'windows-x86_64': { installer: 'http://example.com/a.exe' } } })), null)
})
