// The Iconify icons the app names in its code ('carbon:home', 'ph:…'):
// the client's, the server's (the app tiles' icons it picks) and the
// universities' configs, with the Phosphor weights their icon styles use. Read by scripts/build-icon-bundle.mjs (which
// bundles them) and tests/iconBundle.test.js (which checks none is missing).

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

// The icon sets in use.
export const ICON_PREFIXES = ['carbon', 'ph', 'tabler', 'mdi', 'devicon-plain']
const SCANNED_DIRS = ['src', 'server', 'universities']
const SCANNED_FILE = /\.(js|jsx|mjs|json)$/
// A university's app icon style (appIcons.style) may be a Phosphor weight,
// drawn as the regular names plus a suffix (server/appIcons.js,
// src/subjectIcons.js): those variants are named nowhere in the code.
const PHOSPHOR_STYLE = /style:\s*'phosphor-(fill|duotone)'/g
const PHOSPHOR_WEIGHT_SUFFIX = /-(fill|duotone|bold|light|thin)$/
// Where those styles' icons are named (the tiles', the subjects').
const STYLED_ICON_FILES = new Set(['server/appIcons.js', 'src/subjectIcons.js'])
const ICON_NAME = new RegExp(`['"\`](${ICON_PREFIXES.join('|')}):([a-z0-9]+(?:-[a-z0-9]+)*)['"\`]`, 'g')

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const full = path.join(dir, entry.name)
    // src/dev: dev-only pages (the design gallery), never built: their
    // icons load from Iconify in dev rather than weigh on the bundle.
    if (entry.isDirectory()) return entry.name === 'dev' && path.basename(dir) === 'src' ? [] : listFiles(full)
    return SCANNED_FILE.test(entry.name) && entry.name !== 'iconBundle.json' ? [full] : []
  }))
  return files.flat()
}

// { prefix: [name, …] }, sorted, from the files under `root`.
export async function collectIconNames(root) {
  const byPrefix = Object.fromEntries(ICON_PREFIXES.map((prefix) => [prefix, new Set()]))
  const phosphorWeights = new Set()
  const styledPhosphor = new Set()
  for (const dir of SCANNED_DIRS) {
    for (const file of await listFiles(path.join(root, dir))) {
      const text = await readFile(file, 'utf8')
      const styled = STYLED_ICON_FILES.has(path.relative(root, file).split(path.sep).join('/'))
      for (const [, prefix, name] of text.matchAll(ICON_NAME)) {
        byPrefix[prefix].add(name)
        if (styled && prefix === 'ph') styledPhosphor.add(name)
      }
      if (dir === 'universities') for (const [, weight] of text.matchAll(PHOSPHOR_STYLE)) phosphorWeights.add(weight)
    }
  }
  for (const name of styledPhosphor) {
    if (PHOSPHOR_WEIGHT_SUFFIX.test(name)) continue
    for (const weight of phosphorWeights) byPrefix.ph.add(`${name}-${weight}`)
  }
  return Object.fromEntries(Object.entries(byPrefix).map(([prefix, names]) => [prefix, [...names].sort()]))
}
