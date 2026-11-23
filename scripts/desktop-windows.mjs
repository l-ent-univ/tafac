// The desktop app's release build on Windows (x64): what CI's Windows job
// runs (.github/workflows/desktop.yml), and what to run to try it.
//
//   node scripts/desktop-windows.mjs <version>        (or VERSION=x.y.z)
//
//   <bundle>/nsis/Tafac_<v>_x64-setup.exe        Tauri's NSIS setup: what the
//                                                installed apps download to
//                                                update (url in latest.json)
//   <bundle>/nsis/Tafac_<v>_x64-setup.exe.sig    its signature, bound to the
//                                                version like the Mac's
//   <bundle>/nsis/Tafac_<v>_x64.exe              the first install: the Fluent
//                                                window (installer/) with the
//                                                NSIS setup inside, run
//                                                silently
//   <bundle>/nsis/Tafac_x64.exe                  the same, under a name that
//                                                stays (…/releases/latest/…)
//   <bundle>/latest-windows-x86_64.json          { version, platform, url,
//                                                signature, installer },
//                                                merged into latest.json by
//                                                scripts/desktop-latest.mjs
//
// Not signed with a certificate: Windows SmartScreen warns at the first
// launch (docs/DESKTOP.md, « Not done yet »). The updater's own signature is
// the one that matters to the installed apps:
//   TAURI_SIGNING_PRIVATE_KEY           the key itself (CI's secret), or
//   TAURI_SIGNING_PRIVATE_KEY_PATH      its file
//   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password, if it has one
// DESKTOP_DOWNLOAD_BASE: where the files will be downloaded from, without the
// file name (https://github.com/<owner>/<repo>/releases/download/v<version>).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BUNDLE, ROOT } from './desktopBundle.mjs'

const PLATFORM = 'windows-x86_64'
const TAURI_CLI = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

const version = process.argv[2] ?? process.env.VERSION
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/desktop-windows.mjs <x.y.z>')
  process.exit(1)
}
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error(`Built on Windows x64 (the Node binary and the server's packages are per platform), not ${process.platform}-${process.arch}`)
  process.exit(1)
}
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
  console.error('TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is not set (the updater\'s private key)')
  process.exit(1)
}

// Tauri's CLI through Node itself: no shell to quote the JSON config for.
function tauri(args, cwd) {
  execFileSync(process.execPath, [TAURI_CLI, ...args], { cwd, stdio: 'inherit' })
}

const config = JSON.stringify({ version })
const nsisFolder = path.join(BUNDLE, 'nsis')
const setup = path.join(nsisFolder, `Tafac_${version}_x64-setup.exe`)
const signatureFile = `${setup}.sig`

// The app and its NSIS setup (tauri.bundle.conf.json runs
// `npm run desktop:prepare` first; tauri.windows.conf.json merges by itself).
rmSync(nsisFolder, { recursive: true, force: true })
tauri(['build', '--config', 'src-tauri/tauri.bundle.conf.json', '--config', config, '--bundles', 'nsis'], ROOT)
if (!existsSync(setup)) throw new Error(`The NSIS setup was not built: ${path.relative(ROOT, setup)}`)

// Bound to the version: the updater refuses this file under another
// version number (requireSignedVersion, tauri.conf.json).
rmSync(signatureFile, { force: true })
tauri(['signer', 'sign', '--app-version', version, '--password', process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '', setup], ROOT)
if (!existsSync(signatureFile)) throw new Error('The updater signature was not written')

// The first install: the Fluent window with the setup inside (the crate
// reads it from TAFAC_SETUP, installer/build.rs). `tauri build` embeds the
// window's page; `--no-bundle` leaves the exe in the crate's target folder.
const installerFolder = path.join(ROOT, 'installer')
tauri(['build', '--no-bundle', '--config', config], installerFolder)
// mainBinaryName's name when Tauri applied it, else the crate's.
const releaseFolder = path.join(installerFolder, 'target', 'release')
const built = ['Tafac-setup.exe', 'tafac-installer.exe'].map((name) => path.join(releaseFolder, name)).find(existsSync)
if (!built) throw new Error(`No installer exe in ${path.relative(ROOT, releaseFolder)}: ${readdirSync(releaseFolder).join(', ')}`)
const installer = path.join(nsisFolder, `Tafac_${version}_x64.exe`)
copyFileSync(built, installer)
copyFileSync(built, path.join(nsisFolder, 'Tafac_x64.exe'))

const base = (process.env.DESKTOP_DOWNLOAD_BASE ?? '').replace(/\/+$/, '')
const fragment = {
  version,
  platform: PLATFORM,
  url: base ? `${base}/${path.basename(setup)}` : null,
  signature: readFileSync(signatureFile, 'utf8').trim(),
  installer: base ? `${base}/${path.basename(installer)}` : null,
}
const fragmentFile = path.join(BUNDLE, `latest-${PLATFORM}.json`)
writeFileSync(fragmentFile, `${JSON.stringify(fragment, null, 2)}\n`)

const megabytes = (file) => Math.round(statSync(file).size / (1024 * 1024))
console.log(`Windows: ${path.relative(ROOT, setup)} (${megabytes(setup)} Mo), its .sig, ${path.relative(ROOT, installer)} (${megabytes(installer)} Mo), ${path.relative(ROOT, fragmentFile)}`)
