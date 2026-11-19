// Remote settings (docs/REMOTE_SETTINGS.md): a way to mend an app in the
// students' hands without a new version of it. The apps run this server on
// the student's device (docs/DESKTOP.md, docs/IOS.md): what breaks there
// (a university moves its sign-in, a service goes) waits for an update, on
// iOS for the App Store's review. So the app also reads a small signed file
// from tafac.fr: patches over its universities' settings, data only.
//
// What a patch can do: switch a feature off, follow an address that moved
// within the university's own domains (guard.ts). What it can't: add code,
// or send anything to a domain the app didn't ship with.
//
// The app says where the file is and whose signature it takes:
//   REMOTE_SETTINGS_URL     the file's address (its signature: + ".sig")
//   REMOTE_SETTINGS_PUBKEY  the public key (minisign.ts), the desktop
//                           updates' own
//   REMOTE_SETTINGS_FILE    where the last file taken is kept
//   TAFAC_APP               ios, desktop: which app this is
//   TAFAC_APP_VERSION       its version
// Without an address or a key, nothing is asked and nothing changes: tafac.fr
// itself and a self-hosted server run their own settings.
//
// It never gets in the way: no answer, a file that doesn't read, a bad
// signature, an older file, and the app goes on with what it has.
//
// tafac.fr's own part is to serve the file (createAppSettingsRouter):
//   GET /app/settings.json, /app/settings.json.sig   from APP_SETTINGS_FILE
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { Router } from 'express'
import { mergeSettings } from '../../src/remoteSettings.js'
import { isFor, parseSettings } from './document.ts'
import type { JsonObject, Patch, SettingsDocument } from './document.ts'
import { refusal, trustedDomains } from './guard.ts'
import { verifySignature } from './minisign.ts'

export { isFor, parseSettings } from './document.ts'
export { isTrustedHost, refusal, trustedDomains } from './guard.ts'
export { verifySignature } from './minisign.ts'
export type { Patch, SettingsDocument } from './document.ts'

export interface RemoteSettingsEnv {
  REMOTE_SETTINGS_URL?: string
  REMOTE_SETTINGS_PUBKEY?: string
  REMOTE_SETTINGS_FILE?: string
  TAFAC_APP?: string
  TAFAC_APP_VERSION?: string
}

type Report = (message: string) => void

interface Options {
  fetch?: typeof fetch
  report?: Report
  now?: () => number
}

// What is kept of the last file taken: its text and its signature, checked
// again when read (the copy is the device's, not ours), and when tafac.fr
// last answered (with a file, or that there is none).
interface Kept {
  text?: string
  signature?: string
  checkedAt: number
}

// A file older than this is asked for again before the app starts.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000
// How long the app's start waits for it.
const START_WAIT_MS = 1500
const REQUEST_TIMEOUT_MS = 5000
const RECHECK_EVERY_MS = 60 * 60 * 1000
// The file is a few lines: anything big isn't it.
const MAX_BYTES = 256 * 1024

// https, or this device itself (development).
function isAllowedAddress(address: string): boolean {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
  } catch {
    return false
  }
}

export interface ResolvedSettings {
  // The university's server settings, patched.
  server: Record<string, unknown>
  // What the page lays over its own settings, or null.
  client: JsonObject | null
  // The patches taken, by id.
  applied: string[]
}

export interface RemoteSettings {
  // Before the universities' settings are read: the file kept, and when it
  // is old, a short wait for a newer one.
  ready(): Promise<void>
  resolve(id: string, serverConfig: Record<string, unknown>): ResolvedSettings
  // Asks tafac.fr now (the app does by itself, as it starts and every hour).
  refresh(): Promise<void>
  // The serial number of the file the settings are read with.
  serial(): number | null
}

// One patch over a university's settings. Refused whole when either side
// names something a patch may not (guard.ts).
function applyPatch(settings: ResolvedSettings, patch: Patch, trusted: string[], report: Report): ResolvedSettings {
  const features = patch.features ? { features: patch.features } : null
  const server = mergeSettings(patch.server ?? {}, features ?? {}) as JsonObject
  const client = mergeSettings(patch.client ?? {}, features ?? {}) as JsonObject
  const reason = refusal(server, trusted) ?? refusal(client, trusted)
  if (reason) {
    report(`Remote settings: patch "${patch.id}" refused: ${reason}`)
    return settings
  }
  return {
    server: mergeSettings(settings.server, server) as Record<string, unknown>,
    client: Object.keys(client).length > 0 ? (mergeSettings(settings.client ?? {}, client) as JsonObject) : settings.client,
    applied: [...settings.applied, patch.id],
  }
}

export function createRemoteSettings(env: RemoteSettingsEnv = process.env, options: Options = {}): RemoteSettings {
  const report = options.report ?? console.error
  const now = options.now ?? Date.now
  const address = env.REMOTE_SETTINGS_URL?.trim() ?? ''
  const publicKey = env.REMOTE_SETTINGS_PUBKEY?.trim() ?? ''
  const file = env.REMOTE_SETTINGS_FILE?.trim() ?? ''
  const app = env.TAFAC_APP?.trim() ?? ''
  const version = env.TAFAC_APP_VERSION?.trim() ?? ''
  const enabled = Boolean(publicKey) && isAllowedAddress(address)

  // The file the universities' settings are read with: the one there as
  // the app starts.
  let document: SettingsDocument | null = null
  // The last file taken, kept for the next start.
  let kept: Kept = { checkedAt: 0 }
  let newestSerial = 0
  // Once the universities' settings are read, what is applied stays.
  let started = false

  // The file when it is ours (the signature) and reads.
  function check(text: string, signature: string, origin: string): SettingsDocument | null {
    if (!verifySignature(Buffer.from(text, 'utf8'), signature, publicKey)) {
      report(`Remote settings (${origin}) not taken: bad signature`)
      return null
    }
    const parsed = parseSettings(text)
    if ('error' in parsed) {
      report(`Remote settings (${origin}) not taken: ${parsed.error}`)
      return null
    }
    return parsed
  }

  function readKept(): void {
    if (!file) return
    let read: Kept
    try {
      read = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return
    }
    const answeredAt = Number.isFinite(read?.checkedAt) ? read.checkedAt : 0
    if (typeof read?.text !== 'string' || typeof read?.signature !== 'string') {
      kept = { checkedAt: answeredAt }
      return
    }
    const checked = check(read.text, read.signature, 'kept')
    if (!checked) return
    document = checked
    newestSerial = checked.serial
    kept = { text: read.text, signature: read.signature, checkedAt: answeredAt }
  }

  function keep(): void {
    if (!file) return
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(kept), { mode: 0o600 })
    } catch (error) {
      report(`Remote settings not kept: ${error instanceof Error ? error.message : error}`)
    }
  }

  // The text there, 'none' when tafac.fr says there is no such file, null
  // for anything else (an error, too big).
  async function ask(url: string): Promise<string | 'none' | null> {
    const response = await (options.fetch ?? fetch)(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (response.status === 404) return 'none'
    if (!response.ok) return null
    const text = await response.text()
    return text.length <= MAX_BYTES ? text : null
  }

  // Asks tafac.fr. A newer file than the one kept takes its place: now when
  // the app is still starting, else for the next start (the universities'
  // settings are read once).
  async function refresh(): Promise<void> {
    try {
      const [text, signature] = await Promise.all([ask(address), ask(`${address}.sig`)])
      if (text === null || signature === null) return
      // No file there: nothing new to patch. What is kept stays: only a
      // newer file takes patches away (an empty one does).
      if (text === 'none' || signature === 'none') {
        kept = { ...kept, checkedAt: now() }
        keep()
        return
      }
      const checked = check(text, signature, 'tafac.fr')
      if (!checked) return
      if (checked.serial < newestSerial) {
        report(`Remote settings not taken: serial ${checked.serial} is older than ${newestSerial}`)
        return
      }
      newestSerial = checked.serial
      if (!started) document = checked
      kept = { text, signature, checkedAt: now() }
      keep()
    } catch {
      // Offline, tafac.fr down: asked again later.
    }
  }

  return {
    async ready() {
      if (!enabled) return
      readKept()
      const first = refresh()
      if (now() - kept.checkedAt >= STALE_AFTER_MS) {
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([first, new Promise((resolve) => {
          timer = setTimeout(resolve, START_WAIT_MS)
        })])
        clearTimeout(timer)
      }
      started = true
      setInterval(() => void refresh(), RECHECK_EVERY_MS).unref()
    },

    resolve(id, serverConfig) {
      started = true
      const settings: ResolvedSettings = { server: serverConfig, client: null, applied: [] }
      if (!document) return settings
      // The university's own domains, from its settings as shipped: a patch
      // can't widen what the next one is checked against.
      const trusted = trustedDomains(serverConfig)
      const resolved = document.patches
        .filter((patch) => patch.university === id && isFor(patch, app, version))
        .reduce((current, patch) => applyPatch(current, patch, trusted, report), settings)
      if (resolved.applied.length > 0) {
        report(`Remote settings: ${id}: ${resolved.applied.join(', ')} (serial ${document.serial})`)
      }
      return resolved
    },

    refresh: async () => {
      if (enabled) await refresh()
    },

    serial: () => document?.serial ?? null,
  }
}

export interface AppSettingsEnv {
  APP_SETTINGS_FILE?: string
}

// tafac.fr serves the file and its signature as they are: it holds no key,
// and can't make a file the apps would take.
export function createAppSettingsRouter(env: AppSettingsEnv = process.env): Router {
  const router = express.Router()
  const file = env.APP_SETTINGS_FILE?.trim()
  const send = (source: string, type: string) => (_req: express.Request, res: express.Response) => {
    let text: string
    try {
      text = readFileSync(source, 'utf8')
    } catch {
      res.status(404).end()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.type(type).send(text)
  }
  if (file) {
    router.get('/app/settings.json', send(file, 'application/json'))
    router.get('/app/settings.json.sig', send(`${file}.sig`, 'text/plain'))
  }
  return router
}
