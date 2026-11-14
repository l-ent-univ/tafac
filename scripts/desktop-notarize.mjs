// Notarization (macOS): Apple checks the signed app or disk image and its
// ticket is stapled to it, so Gatekeeper lets it open on a Mac that has
// never seen it, offline too.
//
//   node scripts/desktop-notarize.mjs          the built app (after
//                                              scripts/desktop-sign.mjs)
//   node scripts/desktop-notarize.mjs <file>   a disk image (.dmg)
//
// An App Store Connect API key (Users and Access › Integrations › Team keys,
// role Developer), as Tauri names them:
//   APPLE_API_KEY_PATH  the AuthKey_<id>.p8 file
//   APPLE_API_KEY       the key's ID
//   APPLE_API_ISSUER    the issuer's ID
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP, ROOT, read, requireApp, run } from './desktopBundle.mjs'

export function notaryCredentials() {
  const { APPLE_API_KEY_PATH: keyPath, APPLE_API_KEY: keyId, APPLE_API_ISSUER: issuer } = process.env
  if (!keyPath || !keyId || !issuer) return null
  return ['--key', keyPath, '--key-id', keyId, '--issuer', issuer]
}

// Submits `file` (a .zip of the app, or a .dmg) and waits for Apple's answer.
// notarytool exits with 0 whatever the answer: it is read.
function submit(file, credentials) {
  const answer = JSON.parse(read('xcrun', ['notarytool', 'submit', file, ...credentials, '--wait', '--output-format', 'json']))
  if (answer.status === 'Accepted') return
  console.error(`Notarization of ${path.basename(file)}: ${answer.status}`)
  if (answer.id) {
    // What Apple found, file by file.
    try {
      run('xcrun', ['notarytool', 'log', answer.id, ...credentials])
    } catch {
      // The answer above is what matters.
    }
  }
  process.exit(1)
}

export function notarize(target) {
  const credentials = notaryCredentials()
  if (!credentials) {
    console.error('APPLE_API_KEY_PATH, APPLE_API_KEY and APPLE_API_ISSUER are not all set (an App Store Connect API key)')
    process.exit(1)
  }

  if (target.endsWith('.app')) {
    // An app goes up as a zip; the ticket is stapled to the app itself.
    const folder = mkdtempSync(path.join(tmpdir(), 'tafac-notarize-'))
    const archive = path.join(folder, `${path.basename(target, '.app')}.zip`)
    try {
      run('ditto', ['-c', '-k', '--keepParent', target, archive])
      submit(archive, credentials)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  } else {
    submit(target, credentials)
  }

  run('xcrun', ['stapler', 'staple', target])
  run('xcrun', ['stapler', 'validate', target])
  console.log(`Notarized: ${path.relative(ROOT, target)}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : APP
  if (target === APP) requireApp()
  else if (!existsSync(target)) {
    console.error(`No file at ${target}`)
    process.exit(1)
  }
  notarize(target)
}
