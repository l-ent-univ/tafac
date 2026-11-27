// The update the installed apps download (macOS): the built app as a
// .tar.gz, with the signature the app's updater checks before it installs
// (src-tauri/src/updater.rs, the public key in tauri.conf.json), and what
// goes in latest.json for it.
//
// After the signed build (scripts/desktop-sign.mjs) and its notarization
// (scripts/desktop-notarize.mjs): Tauri's own updater archive would be made
// before both, unnotarized.
//
//   <bundle>/macos/Tafac_<version>_<arch>.app.tar.gz
//   <bundle>/macos/Tafac_<version>_<arch>.app.tar.gz.sig
//   <bundle>/latest-<platform>.json   { version, platform, url, signature,
//                                       installer }, merged into latest.json
//                                       by scripts/desktop-latest.mjs
//
// The updater's private key, never in the repository:
//   TAURI_SIGNING_PRIVATE_KEY           the key itself (CI's secret), or
//   TAURI_SIGNING_PRIVATE_KEY_PATH      its file (~/.tauri/tafac-updater.key)
//   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password, if it has one
// DESKTOP_DOWNLOAD_BASE: where the files will be downloaded from, without the
// file name (https://github.com/<owner>/<repo>/releases/download/v<version>).
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { APP, BUNDLE, ROOT, appArchitecture, appVersion, isDeveloperIdSigned, read, requireApp, run } from './desktopBundle.mjs'

requireApp()

const version = appVersion()
const architecture = appArchitecture()
const name = `Tafac_${version}_${architecture.file}`
const archive = path.join(BUNDLE, 'macos', `${name}.app.tar.gz`)
const signatureFile = `${archive}.sig`

if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
  console.error('TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is not set (the updater\'s private key)')
  process.exit(1)
}

// Tafac.app at the archive's root, as the updater expects. No extended
// attributes nor macOS' ._ files: unpacked as plain files inside the app,
// they would break its signature.
rmSync(archive, { force: true })
rmSync(signatureFile, { force: true })
run('tar', ['--no-xattrs', '--no-mac-metadata', '-czf', archive, '-C', path.dirname(APP), path.basename(APP)], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
})

const entries = read('tar', ['-tzf', archive], { maxBuffer: 256 * 1024 * 1024 }).split('\n')
const stray = entries.filter((entry) => path.basename(entry).startsWith('._'))
if (stray.length > 0) throw new Error(`The archive holds macOS metadata files: ${stray.slice(0, 3).join(', ')}`)

// What the updater will put in place: unpacked, it is still the signed app.
if (isDeveloperIdSigned()) {
  const folder = mkdtempSync(path.join(tmpdir(), 'tafac-update-'))
  try {
    run('tar', ['-xzf', archive, '-C', folder])
    run('codesign', ['--verify', '--deep', '--strict', path.join(folder, path.basename(APP))])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

// Bound to the version: the updater refuses this file under another
// version number (requireSignedVersion, tauri.conf.json).
run('npx', ['tauri', 'signer', 'sign', '--app-version', version, '--password', process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '', archive], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'inherit'],
})
if (!existsSync(signatureFile)) throw new Error('The updater signature was not written')

const base = (process.env.DESKTOP_DOWNLOAD_BASE ?? '').replace(/\/+$/, '')
const fragment = {
  version,
  platform: architecture.platform,
  url: base ? `${base}/${path.basename(archive)}` : null,
  signature: readFileSync(signatureFile, 'utf8').trim(),
  installer: base ? `${base}/${name}.dmg` : null,
}
const fragmentFile = path.join(BUNDLE, `latest-${architecture.platform}.json`)
writeFileSync(fragmentFile, `${JSON.stringify(fragment, null, 2)}\n`)

const megabytes = Math.round(statSync(archive).size / (1024 * 1024))
console.log(`Update: ${path.relative(ROOT, archive)} (${megabytes} Mo), its .sig, ${path.relative(ROOT, fragmentFile)}`)
