// Signed macOS build, after `tauri build` (npm run desktop:build:signed).
//
// The app is signed again with its own entitlements
// (src-tauri/entitlements.signed.plist: the associated domains of the saved
// passwords, src-tauri/src/passwords.rs), the hardened runtime and a
// timestamp, as notarization wants it, then checked. It needs no JIT or
// other exception of the hardened runtime: everything it runs is its own
// compiled code (the page's JavaScript runs in WebKit's own processes).
//
// APPLE_SIGNING_IDENTITY: the "Developer ID Application: …" certificate in
// the keychain, as for `tauri build`.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { APP, ROOT, requireApp } from './desktopBundle.mjs'

const identity = process.env.APPLE_SIGNING_IDENTITY

if (!identity) {
  console.error('APPLE_SIGNING_IDENTITY is not set (the "Developer ID Application: …" certificate)')
  process.exit(1)
}

requireApp()

execFileSync('codesign', [
  '--force',
  '--options', 'runtime',
  '--timestamp',
  '--entitlements', path.join(ROOT, 'src-tauri', 'entitlements.signed.plist'),
  '--sign', identity,
  APP,
], { stdio: 'inherit' })
execFileSync('codesign', ['--verify', '--deep', '--strict', APP], { stdio: 'inherit' })
console.log(`Signed: ${path.relative(ROOT, APP)}`)
