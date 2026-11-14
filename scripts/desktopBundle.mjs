// What the desktop release scripts share (macOS): where the built app is,
// its version and its architecture.
//
// TAFAC_BUNDLE_DIR: Tauri's bundle folder, when it isn't the release
// build's (src-tauri/target/release/bundle): a debug build's, a --target
// build's.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const TAURI = path.join(ROOT, 'src-tauri')
export const BUNDLE = process.env.TAFAC_BUNDLE_DIR
  ? path.resolve(process.env.TAFAC_BUNDLE_DIR)
  : path.join(TAURI, 'target', 'release', 'bundle')
export const APP = path.join(BUNDLE, 'macos', 'Tafac.app')
export const MAIN_BINARY = path.join(APP, 'Contents', 'MacOS', 'tafac-desktop')

export function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', ...options })
}

export function read(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim()
}

export function requireApp() {
  if (!existsSync(MAIN_BINARY)) {
    console.error(`No built app at ${path.relative(ROOT, APP)} (npm run desktop:build:signed first)`)
    process.exit(1)
  }
}

// The version the app was built as (Info.plist).
export function appVersion() {
  return read('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(APP, 'Contents', 'Info.plist')])
}

// The architecture it was built for, under its three names: in Tauri's file
// names (Tafac_0.26.0_aarch64.dmg), in the update manifest's platforms
// (darwin-aarch64), and as macOS says it.
export function appArchitecture() {
  const machine = read('lipo', ['-archs', MAIN_BINARY])
  const names = {
    arm64: { machine, file: 'aarch64', platform: 'darwin-aarch64' },
    x86_64: { machine, file: 'x64', platform: 'darwin-x86_64' },
  }[machine]
  if (!names) throw new Error(`Unexpected architecture: ${machine}`)
  return names
}

// Whether it is signed with a Developer ID (not ad hoc, not unsigned).
// codesign writes what it knows to stderr.
export function isDeveloperIdSigned(target = APP) {
  const { stderr } = spawnSync('codesign', ['-dvv', target], { encoding: 'utf8' })
  return /^Authority=Developer ID Application/m.test(stderr ?? '')
}

// The disk image's background (src-tauri/dmg): background.png (660×400) and
// background@2x.png (1320×800) joined into one picture with both
// resolutions, background.tiff, the file tauri.conf.json names. Finder takes
// one file, and shows a plain PNG blurred on a Retina screen. Not committed:
// made by scripts/desktop-prepare.mjs and scripts/desktop-dmg.mjs.
export function buildDmgBackground() {
  const folder = path.join(TAURI, 'dmg')
  const output = path.join(folder, 'background.tiff')
  // tiffutil says what it wrote on stderr: kept for a failure only.
  run('tiffutil', ['-cathidpicheck', path.join(folder, 'background.png'), path.join(folder, 'background@2x.png'), '-out', output], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  return output
}
