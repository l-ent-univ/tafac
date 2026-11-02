// npm run icons: writes src/iconBundle.json, the data of every Iconify
// icon the code names (scripts/iconNames.mjs), fetched once from the
// Iconify API. src/iconBundle.js registers it when the app starts, so no
// icon waits on the API to show. Run it again after using a new icon
// (tests/iconBundle.test.js fails until then).

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectIconNames } from './iconNames.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const API = 'https://api.iconify.design'
// Names per request, to keep the URLs short.
const CHUNK = 60

async function fetchIcons(prefix, names) {
  const merged = { prefix, icons: {}, aliases: {} }
  for (let index = 0; index < names.length; index += CHUNK) {
    const chunk = names.slice(index, index + CHUNK)
    const response = await fetch(`${API}/${prefix}.json?icons=${chunk.join(',')}`)
    if (!response.ok) throw new Error(`${prefix}: HTTP ${response.status}`)
    const data = await response.json()
    if (data.not_found?.length) console.warn(`${prefix}: not found ${data.not_found.join(', ')}`)
    Object.assign(merged.icons, data.icons)
    Object.assign(merged.aliases, data.aliases ?? {})
    for (const key of ['width', 'height', 'left', 'top']) if (data[key] !== undefined) merged[key] = data[key]
  }
  if (!Object.keys(merged.aliases).length) delete merged.aliases
  return merged
}

const names = await collectIconNames(ROOT)
const collections = []
for (const [prefix, list] of Object.entries(names)) {
  if (list.length) collections.push(await fetchIcons(prefix, list))
}
const file = path.join(ROOT, 'src/iconBundle.json')
await writeFile(file, `${JSON.stringify(collections)}\n`)
const count = collections.reduce((total, collection) => total + Object.keys(collection.icons).length + Object.keys(collection.aliases ?? {}).length, 0)
console.log(`${count} icons in ${path.relative(ROOT, file)}`)
