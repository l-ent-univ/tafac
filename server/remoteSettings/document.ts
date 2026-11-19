// The remote settings' file: a serial number and a list of patches, each
// for one university.
//
//   {
//     "serial": 3,
//     "patches": [{
//       "id": "rennes-cas-moved",        its name, for the log
//       "university": "univ-rennes",
//       "apps": ["ios"],                 optional: the apps it is for
//                                        (ios, desktop); all without it
//       "minVersion": "0.27.0",          optional: the app's versions it is
//       "maxVersion": "0.27.2",          for, both ends included
//       "features": { "mail": false },   switches, for the server and the page
//       "server": { … },                 over universities/<id>/server.js
//       "client": { … }                  over universities/<id>/client.js
//     }]
//   }
//
// `serial` only grows: an app never goes back to a file older than the one
// it has. Anything this doesn't read makes the whole file refused: a typo
// never half-applies.
import { compareVersions } from '../desktopUpdate/manifest.ts'
import { hasForbiddenKey, isPlainObject } from '../../src/remoteSettings.js'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export interface Patch {
  id: string
  university: string
  apps?: string[]
  minVersion?: string
  maxVersion?: string
  features?: Record<string, boolean>
  server?: JsonObject
  client?: JsonObject
}

export interface SettingsDocument {
  serial: number
  patches: Patch[]
}

// src/remoteSettings.js' isPlainObject, with what it says of the value.
export function isObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value)
}

const PATCH_KEYS = new Set(['id', 'university', 'apps', 'minVersion', 'maxVersion', 'features', 'server', 'client'])
const VERSION = /^\d+\.\d+\.\d+$/
const UNIVERSITY = /^[a-z0-9-]+$/
const MAX_PATCHES = 100

function patchError(patch: unknown): string | null {
  if (!isObject(patch)) return 'a patch is not an object'
  const unknown = Object.keys(patch).find((key) => !PATCH_KEYS.has(key))
  if (unknown) return `unknown key "${unknown}"`
  if (typeof patch.id !== 'string' || !patch.id) return 'no id'
  if (typeof patch.university !== 'string' || !UNIVERSITY.test(patch.university)) return 'no university'
  if (patch.apps !== undefined && !(Array.isArray(patch.apps) && patch.apps.every((app: unknown) => typeof app === 'string' && app))) return '"apps" is not a list of names'
  for (const key of ['minVersion', 'maxVersion']) {
    const value = patch[key]
    if (value !== undefined && !(typeof value === 'string' && VERSION.test(value))) return `"${key}" is not a version`
  }
  if (patch.features !== undefined && !(isObject(patch.features) && Object.values(patch.features).every((value) => typeof value === 'boolean'))) return '"features" is not a set of switches'
  for (const key of ['server', 'client']) {
    if (patch[key] !== undefined && !isObject(patch[key])) return `"${key}" is not an object`
  }
  if (hasForbiddenKey(patch)) return 'a key that is never taken'
  return null
}

// The file, or why it isn't one.
export function parseSettings(text: string): SettingsDocument | { error: string } {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    return { error: 'not JSON' }
  }
  if (!isObject(document)) return { error: 'not an object' }
  if (typeof document.serial !== 'number' || !Number.isSafeInteger(document.serial) || document.serial < 1) return { error: 'no serial number' }
  if (!Array.isArray(document.patches) || document.patches.length > MAX_PATCHES) return { error: 'no list of patches' }
  for (const patch of document.patches) {
    const error = patchError(patch)
    if (error) return { error: `patch ${isObject(patch) && typeof patch.id === 'string' ? `"${patch.id}"` : '?'}: ${error}` }
  }
  return { serial: document.serial as number, patches: document.patches as Patch[] }
}

// Whether a patch is for this app, at this version. An app that doesn't say
// what it is (a server, not an app) takes the patches for every app.
export function isFor(patch: Patch, app: string, version: string): boolean {
  if (patch.apps && !patch.apps.includes(app)) return false
  if (!VERSION.test(version)) return patch.minVersion === undefined && patch.maxVersion === undefined
  if (patch.minVersion && compareVersions(version, patch.minVersion) < 0) return false
  if (patch.maxVersion && compareVersions(version, patch.maxVersion) > 0) return false
  return true
}
