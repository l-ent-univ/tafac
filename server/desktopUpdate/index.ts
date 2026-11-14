// tafac.fr's part in the desktop app's updates (docs/DESKTOP.md): the one
// file the installed apps read, and a lasting address for its installers.
//
//   GET /desktop/latest.json           the update manifest (manifest.ts)
//   GET /desktop/download/<platform>   to that platform's installer
//                                      (darwin-aarch64, darwin-x86_64…)
//
// The manifest comes from the environment:
//   DESKTOP_LATEST_FILE  a path to it, read again whenever the file changes
//                        (no restart). tafac.fr fills it by itself from the
//                        newest GitHub release (follow.ts), or
//   DESKTOP_LATEST_JSON  the JSON itself.
// Neither set, a file that isn't there, a manifest that doesn't check: 404.
// The apps take it as no answer and go on as they are; nothing here can
// tell them they are too old by accident.
import { readFileSync, statSync } from 'node:fs'
import express from 'express'
import type { Router } from 'express'
import { parseDesktopManifest } from './manifest.ts'
import type { DesktopManifest } from './manifest.ts'

export { compareVersions, parseDesktopManifest } from './manifest.ts'
export { followOnce, followReleases } from './follow.ts'
export type { DesktopManifest } from './manifest.ts'

export interface DesktopUpdateEnv {
  DESKTOP_LATEST_FILE?: string
  DESKTOP_LATEST_JSON?: string
}

type Report = (message: string) => void

function check(text: string, origin: string, report: Report): DesktopManifest | null {
  const manifest = parseDesktopManifest(text)
  if ('error' in manifest) {
    report(`Desktop update manifest (${origin}) not served: ${manifest.error}`)
    return null
  }
  return manifest
}

// The manifest as it is now: the file's, read again when it changed, else
// the environment's.
export function createManifestSource(env: DesktopUpdateEnv, report: Report = console.error): () => DesktopManifest | null {
  const file = env.DESKTOP_LATEST_FILE?.trim()
  if (file) {
    let readAt: number | null = null
    let manifest: DesktopManifest | null = null
    return () => {
      let changedAt: number
      try {
        changedAt = statSync(file).mtimeMs
      } catch {
        // Not there (yet): asked again at the next request.
        readAt = null
        manifest = null
        return null
      }
      if (changedAt !== readAt) {
        readAt = changedAt
        try {
          manifest = check(readFileSync(file, 'utf8'), file, report)
        } catch {
          manifest = null
        }
      }
      return manifest
    }
  }

  const json = env.DESKTOP_LATEST_JSON?.trim()
  const manifest = json ? check(json, 'DESKTOP_LATEST_JSON', report) : null
  return () => manifest
}

export function createDesktopUpdateRouter(env: DesktopUpdateEnv = process.env, report: Report = console.error): Router {
  const currentManifest = createManifestSource(env, report)
  const router = express.Router()

  router.get('/desktop/latest.json', (_req, res) => {
    const manifest = currentManifest()
    if (!manifest) {
      res.status(404).end()
      return
    }
    // Asked again each time: an update is out as soon as it is published.
    res.setHeader('Cache-Control', 'no-cache')
    res.type('application/json').send(manifest.text)
  })

  router.get('/desktop/download/:platform', (req, res) => {
    const installer = currentManifest()?.installers.get(req.params.platform)
    if (!installer) {
      res.status(404).end()
      return
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.redirect(302, installer)
  })

  return router
}
