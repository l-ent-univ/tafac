// The desktop app's update manifest (latest.json, docs/DESKTOP.md): Tauri's
// static format, with two fields of ours.
//
//   {
//     "version": "0.26.0",
//     "minimum": "0.24.0",           ours: below it, the app can't sign in
//                                     any more and asks to be updated
//     "pub_date": "2026-11-20T09:00:00Z",
//     "notes": "",
//     "platforms": {
//       "darwin-aarch64": {
//         "url": "https://…/Tafac_0.26.0_aarch64.app.tar.gz",
//         "signature": "…",          the .sig file's content
//         "installer": "https://…/Tafac_0.26.0_aarch64.dmg"   ours
//       }
//     }
//   }
//
// What is published is checked first: a manifest the apps couldn't read, or
// one that would lock every install out, is not served at all, and an app
// that gets no answer goes on as it is.

export interface DesktopManifest {
  // The file as published, served as it is.
  text: string
  version: string
  // Each platform's installer, by its name (darwin-aarch64…).
  installers: Map<string, string>
}

const VERSION = /^\d+\.\d+\.\d+$/
const PLATFORM = /^[a-z0-9]+(-[a-z0-9_]+){1,2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

// -1, 0 or 1, for two x.y.z versions.
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

// The manifest, or why it can't be served.
export function parseDesktopManifest(text: string): DesktopManifest | { error: string } {
  let manifest: unknown
  try {
    manifest = JSON.parse(text)
  } catch {
    return { error: 'not JSON' }
  }
  if (!isRecord(manifest)) return { error: 'not an object' }

  const { version, minimum, pub_date: date, platforms } = manifest
  if (typeof version !== 'string' || !VERSION.test(version)) return { error: '"version" is not x.y.z' }
  if (minimum !== undefined) {
    if (typeof minimum !== 'string' || !VERSION.test(minimum)) return { error: '"minimum" is not x.y.z' }
    // Above the version on offer, no update would ever satisfy it.
    if (compareVersions(minimum, version) > 0) return { error: '"minimum" is above "version"' }
  }
  // The updater refuses the whole manifest for a date it can't read.
  if (date !== undefined && (typeof date !== 'string' || Number.isNaN(Date.parse(date)) || !/^\d{4}-\d{2}-\d{2}T/.test(date))) {
    return { error: '"pub_date" is not an RFC 3339 date' }
  }
  if (!isRecord(platforms) || Object.keys(platforms).length === 0) return { error: 'no "platforms"' }

  const installers = new Map<string, string>()
  for (const [name, platform] of Object.entries(platforms)) {
    if (!PLATFORM.test(name)) return { error: `platform "${name}" is not a platform name` }
    if (!isRecord(platform)) return { error: `platform "${name}" is not an object` }
    if (!isHttpsUrl(platform.url)) return { error: `platform "${name}" has no https "url"` }
    if (typeof platform.signature !== 'string' || platform.signature.length === 0) return { error: `platform "${name}" has no "signature"` }
    if (platform.installer !== undefined) {
      if (!isHttpsUrl(platform.installer)) return { error: `platform "${name}" has an "installer" that is not https` }
      installers.set(name, platform.installer)
    }
  }
  return { text, version, installers }
}
