// tafac.fr publishes the desktop app's updates by itself: it reads the
// manifest of the newest GitHub release every few minutes and, when it
// changed and checks, puts it where it serves it from (DESKTOP_LATEST_FILE,
// index.ts). CI uploads latest.json to the release only once the signed,
// notarized build is done (.github/workflows/desktop.yml), so a release
// whose desktop build failed, or is still running, has none: what is served
// stays as it is. tafac.fr can't be reached from GitHub (it is on a home
// network), hence tafac.fr asking, not CI pushing.
//
//   DESKTOP_LATEST_FILE  where the manifest is served from; following is on
//                        when it is set
//   DESKTOP_LATEST_FROM  where to read it (default: the newest release's
//                        latest.json on GitHub)
//   DESKTOP_LATEST_PIN   set (1): the file stays as it is, by hand (hold an
//                        update back, raise `minimum`)
//
// Withdrawing an update: delete its GitHub release (the previous one is the
// newest again, its manifest comes back; apps never go back a version, the
// ones that hadn't installed it drop it), or pin and edit the file.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseDesktopManifest } from './manifest.ts'

export const DEFAULT_RELEASE_MANIFEST = 'https://github.com/l-ent-univ/tafac/releases/latest/download/latest.json'
const EVERY_MS = 10 * 60 * 1000
const FIRST_AFTER_MS = 10 * 1000
const TIMEOUT_MS = 20 * 1000

export interface FollowEnv {
  DESKTOP_LATEST_FILE?: string
  DESKTOP_LATEST_FROM?: string
  DESKTOP_LATEST_PIN?: string
}

type Report = (message: string) => void

export type FollowOutcome =
  // A new manifest is served from now on.
  | 'published'
  // The release's is the one already served.
  | 'unchanged'
  // No manifest there (no desktop build for that release yet, or none at
  // all), or no answer: what is served stays.
  | 'none'
  // One that doesn't check: not served, what is served stays.
  | 'refused'

function readServed(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

// One look at the release's manifest.
export async function followOnce(
  { from, file }: { from: string, file: string },
  { fetchManifest = fetch, report = console.error }: { fetchManifest?: typeof fetch, report?: Report } = {},
): Promise<FollowOutcome> {
  let text: string
  try {
    const response = await fetchManifest(from, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return 'none'
    text = await response.text()
  } catch {
    return 'none'
  }

  const manifest = parseDesktopManifest(text)
  if ('error' in manifest) {
    report(`Desktop update manifest from ${from} not published: ${manifest.error}`)
    return 'refused'
  }
  if (readServed(file) === text) return 'unchanged'

  // Whole or not at all: written beside it, then moved over it.
  mkdirSync(path.dirname(file), { recursive: true })
  const next = `${file}.next`
  writeFileSync(next, text)
  renameSync(next, file)
  report(`Desktop update manifest: ${manifest.version} published`)
  return 'published'
}

// Follows the releases while the server runs; returns how to stop. Nothing
// without DESKTOP_LATEST_FILE, or with DESKTOP_LATEST_PIN.
export function followReleases(
  env: FollowEnv = process.env,
  { fetchManifest, report = console.error, every = EVERY_MS, firstAfter = FIRST_AFTER_MS }: { fetchManifest?: typeof fetch, report?: Report, every?: number, firstAfter?: number } = {},
): () => void {
  const file = env.DESKTOP_LATEST_FILE?.trim()
  const pinned = Boolean(env.DESKTOP_LATEST_PIN?.trim())
  if (!file || pinned) {
    if (file && pinned) report('Desktop update manifest pinned (DESKTOP_LATEST_PIN): not following the releases')
    return () => {}
  }
  const from = env.DESKTOP_LATEST_FROM?.trim() || DEFAULT_RELEASE_MANIFEST

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const look = async () => {
    try {
      await followOnce({ from, file }, { fetchManifest, report })
    } catch (error) {
      // The file couldn't be written: tried again next time.
      report(`Desktop update manifest not published: ${error instanceof Error ? error.message : error}`)
    }
    if (!stopped) {
      timer = setTimeout(look, every)
      timer.unref?.()
    }
  }
  timer = setTimeout(look, firstAfter)
  timer.unref?.()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
