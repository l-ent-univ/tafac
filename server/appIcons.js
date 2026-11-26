// ============================================================================
// Automatic icons for application tiles (see docs/ADDING_A_UNIVERSITY.md).
//
// Portal services rarely come with a usable icon. For every service a
// university lists, the server picks a concept from its title (French or
// English keywords: "mail", "calendar", "library"…) and a hue from a curated
// list (src/appIconPicks.js: the picking itself, and how a pick looks in
// each university's icon style and colour mode). The first pick is written
// to a small JSON file per university, so every student of that university
// sees the same tile and a later change to the keyword list never
// reshuffles existing tiles: only services seen for the first time get a
// fresh pick.
//
// Stored per service: its id, the picked concept and hue, the portal title
// (to make the file readable) and the day it was first seen. Nothing about
// students: service ids and titles are the same for everyone.
// ============================================================================
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  MAX_TITLE_LENGTH,
  SERVICE_ID_PATTERN,
  assignAppIcon,
  isPinnedAppIcon,
  isValidAppIconEntry,
  matchAppIconBrand,
} from '../src/appIconPicks.js'

export {
  APP_ICON_COLOR_MODES,
  APP_ICON_CONCEPTS,
  APP_ICON_HUES,
  APP_ICON_RULES,
  APP_ICON_STYLES,
  DEFAULT_APP_ICON_COLOR_MODE,
  DEFAULT_APP_ICON_STYLE,
  GENERIC_CONCEPT,
  MAX_REQUEST_SERVICES,
  assignAppIcon,
  hashString,
  isValidAppIconEntry,
  matchAppIcon,
  normalizeText,
  pickAppColor,
  resolveAppIconTheme,
  sanitizeAppIconRequest,
  toIconifyName,
} from '../src/appIconPicks.js'

export const APP_ICONS_FILE_VERSION = 1
// Per university file: past it, new services are still answered but no
// longer written down.
export const MAX_STORED_SERVICES = 500

// Assignments of one university, kept in <dataDir>/app-icons/<id>.json.
//
// - The file is read on first use and re-read whenever its mtime changes, so
//   an admin can edit or delete entries without restarting the server.
// - Writes go to a temporary file renamed over the real one (atomic on the
//   same filesystem), one at a time.
// - If the directory can't be written (read-only volume, permissions) or the
//   file can't be parsed, assignments carry on in memory only: tiles still
//   get icons, they just aren't remembered across restarts. A broken file is
//   left untouched for the admin to fix.
export function createAppIconStore({ universityId, dataDir, logger = console, now = () => new Date() }) {
  const filePath = path.join(dataDir, 'app-icons', `${universityId}.json`)
  const entries = new Map()
  let loaded = false
  let fileMtimeMs = null
  let persistent = true
  let queue = Promise.resolve()

  function disablePersistence(reason, error) {
    if (persistent) {
      logger.warn?.(`[app-icons] ${reason} (${filePath}): ${error?.code ?? error?.message ?? error}. Icons are kept in memory only.`)
    }
    persistent = false
  }

  async function readMtime() {
    try {
      return (await stat(filePath)).mtimeMs
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function loadIfChanged() {
    if (!persistent && loaded) {
      return
    }

    let mtimeMs
    try {
      mtimeMs = await readMtime()
    } catch (error) {
      disablePersistence('cannot read the icon file', error)
      loaded = true
      return
    }

    if (loaded && mtimeMs === fileMtimeMs) {
      return
    }

    // Deleting the file resets everything; editing it replaces what we had.
    entries.clear()
    fileMtimeMs = mtimeMs
    loaded = true
    if (mtimeMs === null) {
      return
    }

    try {
      const data = JSON.parse(await readFile(filePath, 'utf8'))
      for (const [id, entry] of Object.entries(data?.services ?? {})) {
        if (SERVICE_ID_PATTERN.test(id) && isValidAppIconEntry(entry)) {
          entries.set(id, {
            icon: entry.icon,
            color: entry.color,
            title: typeof entry.title === 'string' ? entry.title.slice(0, MAX_TITLE_LENGTH) : '',
            assignedAt: typeof entry.assignedAt === 'string' ? entry.assignedAt.slice(0, 10) : '',
          })
        }
      }
    } catch (error) {
      disablePersistence('cannot parse the icon file', error)
    }
  }

  async function save() {
    const services = Object.fromEntries(
      [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)),
    )
    const content = `${JSON.stringify({ version: APP_ICONS_FILE_VERSION, university: universityId, services }, null, 2)}\n`
    const tempPath = `${filePath}.${randomUUID()}.tmp`

    try {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(tempPath, content, 'utf8')
      await rename(tempPath, filePath)
      fileMtimeMs = await readMtime()
    } catch (error) {
      await unlink(tempPath).catch(() => {})
      disablePersistence('cannot write the icon file', error)
    }
  }

  function getUsage() {
    const usage = new Map()
    for (const { color } of entries.values()) {
      usage.set(color, (usage.get(color) ?? 0) + 1)
    }
    return usage
  }

  // services: sanitized ({ id, title, description, category }).
  // remember: false answers without writing anything down (used for ids the
  // server can't vouch for, see the route in entAuthApp.js).
  // Returns { [id]: { icon, color } }.
  async function resolve(services, { remember = true } = {}) {
    await loadIfChanged()

    const result = {}
    const usage = getUsage()
    let changed = false
    // Sorted, so the same new services get the same colours whatever order
    // the portal lists them in.
    const sorted = [...services].sort((a, b) => a.id.localeCompare(b.id))

    for (const service of sorted) {
      const existing = entries.get(service.id)
      if (existing) {
        // A brand logo replaces a stored concept (not an icon an admin
        // pinned by name); the colour stays.
        const brand = matchAppIconBrand(service.title)
        result[service.id] = { icon: brand && !isPinnedAppIcon(existing.icon) ? brand : existing.icon, color: existing.color }
        continue
      }

      const canRemember = remember && entries.size < MAX_STORED_SERVICES
      const assignment = assignAppIcon(service, canRemember ? usage : null)
      result[service.id] = assignment

      if (canRemember) {
        entries.set(service.id, {
          ...assignment,
          title: service.title,
          assignedAt: now().toISOString().slice(0, 10),
        })
        usage.set(assignment.color, (usage.get(assignment.color) ?? 0) + 1)
        changed = true
      }
    }

    if (changed && persistent) {
      await save()
    }

    return result
  }

  return {
    filePath,
    get persistent() {
      return persistent
    },
    // One resolve at a time: two first visits racing each other must not pick
    // different tiles for the same new service.
    resolve(services, options) {
      const run = queue.then(() => resolve(services, options))
      queue = run.catch(() => {})
      return run
    },
  }
}

// Data directory for the files above. DATA_DIR in production (the Docker
// image points it at a volume), ./data next to the code otherwise.
export function resolveDataDir(env = process.env) {
  const configured = String(env.DATA_DIR ?? '').trim()
  return configured ? path.resolve(configured) : path.resolve('data')
}
