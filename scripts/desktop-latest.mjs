// latest.json, the file the installed desktop apps read on tafac.fr
// (docs/DESKTOP.md): put together from what each architecture's build left
// (latest-<platform>.json, scripts/desktop-updater-archive.mjs).
//
//   node scripts/desktop-latest.mjs <latest-*.json>… [--minimum x.y.z] [--out <file>]
//
// `minimum`, the oldest version that can still sign in (below it the app
// asks to be updated before anything else): --minimum, else DESKTOP_MINIMUM,
// else the one tafac.fr serves now (DESKTOP_LATEST_URL), kept as it is.
// Raise it only when older versions can't work any more.
//
// Publishing the file on tafac.fr is what releases the update.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { parseDesktopManifest } from './desktopManifest.ts'

const LIVE_URL = process.env.DESKTOP_LATEST_URL ?? 'https://tafac.fr/desktop/latest.json'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { minimum: { type: 'string' }, out: { type: 'string' } },
})
if (positionals.length === 0) {
  console.error('Usage: node scripts/desktop-latest.mjs <latest-*.json>… [--minimum x.y.z] [--out <file>]')
  process.exit(1)
}

// The minimum in force, if tafac.fr answers.
async function liveMinimum() {
  try {
    const response = await fetch(LIVE_URL, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    const { minimum } = await response.json()
    return typeof minimum === 'string' ? minimum : null
  } catch {
    return null
  }
}

const fragments = positionals.map((file) => JSON.parse(readFileSync(file, 'utf8')))
const versions = new Set(fragments.map((fragment) => fragment.version))
if (versions.size !== 1) throw new Error(`The builds are not of one version: ${[...versions].join(', ')}`)
const [version] = versions

const minimum = values.minimum ?? (process.env.DESKTOP_MINIMUM || null) ?? await liveMinimum()
const manifest = {
  version,
  ...(minimum ? { minimum } : {}),
  pub_date: new Date().toISOString(),
  // Empty: « Nouveautés » says what changed.
  notes: '',
  platforms: Object.fromEntries(fragments.map(({ platform, url, signature, installer }) => [
    platform,
    { url, signature, ...(installer ? { installer } : {}) },
  ])),
}

const text = `${JSON.stringify(manifest, null, 2)}\n`
// What tafac.fr would refuse to serve is not written.
const checked = parseDesktopManifest(text)
if ('error' in checked) throw new Error(`latest.json would not be served: ${checked.error}`)

if (values.out) {
  writeFileSync(path.resolve(values.out), text)
  console.error(`latest.json for ${version}${minimum ? ` (minimum ${minimum})` : ''}: ${values.out}`)
} else {
  process.stdout.write(text)
}
