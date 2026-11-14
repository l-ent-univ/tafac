// Signed macOS build, after `tauri build` (npm run desktop:build:signed).
//
// Tauri signs the bundled Node with the app's entitlements, and macOS kills
// it at launch: the associated-domains entitlement (saved passwords,
// src-tauri/src/passwords.rs) is restricted, and only the app has the
// provisioning profile that allows it. So Node is signed again with its own
// entitlements (src-tauri/entitlements.node.plist: JIT only), then the app
// again with its own, which seals the new Node signature into the bundle.
//
// APPLE_SIGNING_IDENTITY: the "Developer ID Application: …" certificate in
// the keychain, as for `tauri build`.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Tafac.app')
const NODE = path.join(APP, 'Contents', 'MacOS', 'node')
const identity = process.env.APPLE_SIGNING_IDENTITY

if (!identity) {
  console.error('APPLE_SIGNING_IDENTITY is not set (the "Developer ID Application: …" certificate)')
  process.exit(1)
}

function sign(target, entitlements) {
  execFileSync('codesign', [
    '--force',
    '--options', 'runtime',
    '--timestamp',
    '--entitlements', path.join(ROOT, 'src-tauri', entitlements),
    '--sign', identity,
    target,
  ], { stdio: 'inherit' })
}

sign(NODE, 'entitlements.node.plist')
sign(APP, 'entitlements.signed.plist')
execFileSync('codesign', ['--verify', '--deep', '--strict', APP], { stdio: 'inherit' })

// The check that matters: macOS lets the signed Node run.
const answer = execFileSync(NODE, ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8' })
if (answer !== 'ok') throw new Error('The signed Node did not run')
console.log(`Signed: ${path.relative(ROOT, APP)} (Node runs)`)
